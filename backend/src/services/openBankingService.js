const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei GoCardless Bank Account Data (ex-Nordigen)
// ===========================================
// Connexió Open Banking per Banc Sabadell i altres bancs.
// Documentació: https://bankaccountdata.gocardless.com/api/v2/
//
// Env vars necessàries:
//   GOCARDLESS_SECRET_ID   — secret_id de GoCardless
//   GOCARDLESS_SECRET_KEY  — secret_key de GoCardless
//   APP_BASE_URL           — URL base de l'app (per redirect)
// ===========================================

const GC_BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2';

// Institucions bancàries conegudes (Espanya)
const KNOWN_INSTITUTIONS = {
  SABADELL: 'BSABESBBXXX',
  CAIXA: 'CAIXESBBXXX',
  BBVA: 'BBVAESMMXXX',
  SANTANDER: 'BSCHESMMXXX',
  BANKINTER: 'BKBKESMMXXX',
  ING: 'INGDESMMXXX',
};

/**
 * Obté un token JWT d'accés a GoCardless
 */
async function getAccessToken(bankAccountId) {
  const creds = await getCredentials(bankAccountId);

  const response = await fetch(`${GC_BASE_URL}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret_id: creds.secretId,
      secret_key: creds.secretKey,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GoCardless auth error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.access; // JWT token
}

/**
 * Obté les credencials GoCardless des del BankAccount o env vars
 */
async function getCredentials(bankAccountId) {
  if (bankAccountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (account?.syncConfig) {
      const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
      if (config.secretId && config.secretKey) {
        return config;
      }
    }
  }
  // Fallback a env vars
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('Credencials GoCardless no configurades (GOCARDLESS_SECRET_ID + GOCARDLESS_SECRET_KEY)');
  }
  return { secretId, secretKey };
}

/**
 * Fa una petició autenticada a GoCardless
 */
async function gcFetch(path, token, options = {}) {
  const url = `${GC_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GoCardless API error ${response.status} (${path}): ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Llista institucions bancàries disponibles per un país
 */
async function listInstitutions(bankAccountId, country = 'ES') {
  const token = await getAccessToken(bankAccountId);
  const data = await gcFetch(`/institutions/?country=${country}`, token);
  return data.map(inst => ({
    id: inst.id,
    name: inst.name,
    bic: inst.bic,
    logo: inst.logo,
    countries: inst.countries,
    transactionTotalDays: inst.transaction_total_days,
  }));
}

/**
 * Crea un "end user agreement" (EUA) per consentiment
 */
async function createAgreement(bankAccountId, institutionId) {
  const token = await getAccessToken(bankAccountId);
  const data = await gcFetch('/agreements/enduser/', token, {
    method: 'POST',
    body: {
      institution_id: institutionId,
      max_historical_days: 90,    // Màxim gratis
      access_valid_for_days: 90,  // Validesa del consentiment
      access_scope: ['balances', 'details', 'transactions'],
    },
  });
  return {
    agreementId: data.id,
    institutionId: data.institution_id,
    maxHistoricalDays: data.max_historical_days,
    accessValidForDays: data.access_valid_for_days,
    accepted: data.accepted,
  };
}

/**
 * Crea una requisition (flux d'autenticació bancària)
 * L'usuari serà redirigit al banc per autoritzar l'accés
 */
async function createRequisition(bankAccountId, institutionId, redirectUrl) {
  const token = await getAccessToken(bankAccountId);

  // Primer crear l'agreement
  const agreement = await createAgreement(bankAccountId, institutionId);

  // Crear la requisition amb el redirect
  const data = await gcFetch('/requisitions/', token, {
    method: 'POST',
    body: {
      redirect: redirectUrl,
      institution_id: institutionId,
      agreement: agreement.agreementId,
      reference: `seitocamera_${bankAccountId}_${Date.now()}`,
      user_language: 'CA', // Català
    },
  });

  // Guardar el requisition ID a syncConfig
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      syncConfig: {
        ...(typeof (await prisma.bankAccount.findUnique({ where: { id: bankAccountId } }))?.syncConfig === 'object'
          ? (await prisma.bankAccount.findUnique({ where: { id: bankAccountId } }))?.syncConfig
          : {}),
        requisitionId: data.id,
        agreementId: agreement.agreementId,
        institutionId,
      },
    },
  });

  return {
    requisitionId: data.id,
    link: data.link, // URL on redirigir l'usuari
    status: data.status,
  };
}

/**
 * Comprova l'estat d'una requisition i obté els comptes si autoritzada
 */
async function checkRequisitionStatus(bankAccountId) {
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account?.syncConfig) throw new Error('Compte sense configuració de sync');

  const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
  if (!config.requisitionId) throw new Error('No hi ha requisition pendent');

  const token = await getAccessToken(bankAccountId);
  const data = await gcFetch(`/requisitions/${config.requisitionId}/`, token);

  if (data.status === 'LN' && data.accounts && data.accounts.length > 0) {
    // Linked! Guardar el primer account ID
    const gcAccountId = data.accounts[0];

    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        syncConfig: {
          ...config,
          gcAccountId,
          gcAccountIds: data.accounts,
          status: 'linked',
          linkedAt: new Date().toISOString(),
        },
      },
    });

    return {
      status: 'linked',
      accounts: data.accounts,
      selectedAccountId: gcAccountId,
    };
  }

  return {
    status: data.status, // CR=created, GC=giving_consent, UA=undergoing_authentication, RJ=rejected, SA=suspended, LN=linked
    statusDescription: getStatusDescription(data.status),
  };
}

function getStatusDescription(status) {
  const descriptions = {
    CR: 'Creada, pendent d\'autorització',
    GC: 'Donant consentiment al banc',
    UA: 'Autenticant-se al banc',
    RJ: 'Rebutjada pel banc',
    SA: 'Suspesa',
    GA: 'Consentiment donat, processant',
    LN: 'Connectada correctament',
    EX: 'Expirada',
  };
  return descriptions[status] || `Estat desconegut: ${status}`;
}

/**
 * Obté els detalls d'un compte GoCardless (IBAN, nom, etc.)
 */
async function getAccountDetails(bankAccountId) {
  const config = await getLinkedConfig(bankAccountId);
  const token = await getAccessToken(bankAccountId);

  const [details, balances] = await Promise.all([
    gcFetch(`/accounts/${config.gcAccountId}/details/`, token),
    gcFetch(`/accounts/${config.gcAccountId}/balances/`, token),
  ]);

  return {
    iban: details.account?.iban,
    name: details.account?.name || details.account?.ownerName,
    currency: details.account?.currency || 'EUR',
    balances: (balances.balances || []).map(b => ({
      amount: parseFloat(b.balanceAmount?.amount || 0),
      currency: b.balanceAmount?.currency || 'EUR',
      type: b.balanceType, // closingBooked, expected, etc.
      date: b.referenceDate,
    })),
  };
}

/**
 * Obté el saldo del compte via Open Banking
 */
async function getBalance(bankAccountId) {
  const config = await getLinkedConfig(bankAccountId);
  const token = await getAccessToken(bankAccountId);

  const data = await gcFetch(`/accounts/${config.gcAccountId}/balances/`, token);
  const balances = data.balances || [];

  // Preferir closingBooked, sinó expected
  const booked = balances.find(b => b.balanceType === 'closingBooked');
  const expected = balances.find(b => b.balanceType === 'expected');
  const best = booked || expected || balances[0];

  if (!best) return null;

  return {
    balance: parseFloat(best.balanceAmount?.amount || 0),
    currency: best.balanceAmount?.currency || 'EUR',
    type: best.balanceType,
    date: best.referenceDate,
  };
}

/**
 * Obté transaccions del compte via Open Banking
 */
async function fetchTransactions(options = {}) {
  const { bankAccountId, dateFrom, dateTo } = options;
  const config = await getLinkedConfig(bankAccountId);
  const token = await getAccessToken(bankAccountId);

  let path = `/accounts/${config.gcAccountId}/transactions/`;
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await gcFetch(path, token);

  const transactions = [];

  // GoCardless retorna transaccions en "booked" i "pending"
  for (const tx of (data.transactions?.booked || [])) {
    transactions.push(mapTransaction(tx, 'booked'));
  }
  // Incloure pending també
  for (const tx of (data.transactions?.pending || [])) {
    transactions.push(mapTransaction(tx, 'pending'));
  }

  return transactions;
}

/**
 * Mapeja una transacció GoCardless al format intern
 */
function mapTransaction(tx, bookingStatus) {
  const amount = parseFloat(tx.transactionAmount?.amount || 0);
  return {
    transactionId: tx.transactionId || tx.internalTransactionId || `gc_${tx.entryReference || Date.now()}`,
    date: new Date(tx.bookingDate || tx.valueDate || new Date()),
    settledAt: tx.bookingDate ? new Date(tx.bookingDate) : null,
    amount,
    currency: tx.transactionAmount?.currency || 'EUR',
    side: amount >= 0 ? 'credit' : 'debit',
    counterparty: tx.creditorName || tx.debtorName || '',
    reference: tx.remittanceInformationUnstructured || tx.remittanceInformationStructured || '',
    iban: tx.creditorAccount?.iban || tx.debtorAccount?.iban || null,
    category: null,
    note: tx.additionalInformation || null,
    status: bookingStatus,
    rawData: tx,
  };
}

/**
 * Sincronitza transaccions Open Banking amb la BD
 */
async function syncTransactions(options = {}) {
  const { bankAccountId, fullSync = false } = options;

  // Determinar data d'inici per sync incremental
  let dateFrom = null;
  if (!fullSync) {
    const lastMovement = await prisma.bankMovement.findFirst({
      where: { bankAccountId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (lastMovement) {
      const d = new Date(lastMovement.date);
      d.setDate(d.getDate() - 5); // 5 dies enrere per seguretat
      dateFrom = d.toISOString().split('T')[0];
    }
  }

  const transactions = await fetchTransactions({ bankAccountId, dateFrom });
  logger.info(`Open Banking sync: ${transactions.length} transaccions obtingudes`);

  let created = 0, skipped = 0, updated = 0, errors = 0;

  for (const tx of transactions) {
    try {
      // Només sincronitzar "booked" (confirmades)
      if (tx.status === 'pending') { skipped++; continue; }

      const slug = tx.transactionId;
      if (!slug) { skipped++; continue; }

      // Buscar per qontoSlug (reutilitzem el camp per qualsevol ID extern)
      const existing = await prisma.bankMovement.findFirst({
        where: { qontoSlug: slug },
      });

      if (existing) {
        if (fullSync) {
          await prisma.bankMovement.update({
            where: { id: existing.id },
            data: {
              counterparty: tx.counterparty || null,
              reference: tx.reference || existing.reference,
              bankAccountId,
            },
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      const description = tx.counterparty
        ? (tx.reference ? `${tx.counterparty} — ${tx.reference}` : tx.counterparty)
        : tx.reference || 'Transacció bancària';

      await prisma.bankMovement.create({
        data: {
          date: tx.date,
          valueDate: tx.settledAt && !isNaN(tx.settledAt.getTime()) ? tx.settledAt : null,
          description,
          amount: tx.amount,
          type: tx.amount >= 0 ? 'INCOME' : 'EXPENSE',
          reference: tx.reference || null,
          bankAccount: 'Sabadell',
          bankAccountId,
          counterparty: tx.counterparty || null,
          qontoSlug: slug, // Reutilitzem per dedup
          rawData: tx.rawData,
        },
      });
      created++;
    } catch (err) {
      logger.error(`Open Banking sync error: ${err.message}`);
      errors++;
    }
  }

  // Obtenir saldo real i guardar-lo
  let balance = null;
  try {
    const balanceData = await getBalance(bankAccountId);
    if (balanceData) {
      balance = balanceData.balance;
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          currentBalance: balanceData.balance,
          lastSyncAt: new Date(),
          lastSyncError: null,
        },
      });
    }
  } catch (balErr) {
    logger.warn(`Open Banking: No s'ha pogut obtenir saldo: ${balErr.message}`);
  }

  logger.info(`Open Banking sync: ${created} creats, ${skipped} omesos, ${updated} actualitzats, ${errors} errors`);

  return { total: transactions.length, created, skipped, updated, errors, balance };
}

/**
 * Testa la connexió Open Banking
 */
async function testConnection(bankAccountId) {
  try {
    const config = await getLinkedConfig(bankAccountId);
    const token = await getAccessToken(bankAccountId);
    const details = await gcFetch(`/accounts/${config.gcAccountId}/`, token);

    return {
      connected: true,
      status: details.status, // READY, PROCESSING, ERROR, EXPIRED, SUSPENDED
      institutionId: details.institution_id,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/**
 * Helper: obté la config d'un compte linked
 */
async function getLinkedConfig(bankAccountId) {
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account?.syncConfig) throw new Error('Compte sense configuració de sync');

  const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
  if (!config.gcAccountId) throw new Error('Compte no connectat via Open Banking (falta gcAccountId)');

  return config;
}

module.exports = {
  getAccessToken,
  listInstitutions,
  createRequisition,
  checkRequisitionStatus,
  getAccountDetails,
  getBalance,
  fetchTransactions,
  syncTransactions,
  testConnection,
  KNOWN_INSTITUTIONS,
};
