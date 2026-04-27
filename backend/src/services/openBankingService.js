const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei Yapily Open Banking
// ===========================================
// Connexió Open Banking per Banc Sabadell i altres bancs espanyols.
// Documentació: https://docs.yapily.com/api/reference/
//
// Env vars necessàries:
//   YAPILY_APP_ID       — Application ID (username per Basic Auth)
//   YAPILY_APP_SECRET   — Application Secret (password per Basic Auth)
//   APP_BASE_URL        — URL base de l'app (per redirect)
// ===========================================

const YAPILY_BASE_URL = 'https://api.yapily.com';

/**
 * Obté les credencials Yapily: ServiceConnection → BankAccount.syncConfig → .env
 */
async function getCredentials(bankAccountId) {
  // 1. Mirar ServiceConnection (centralitzat)
  try {
    const conn = await prisma.serviceConnection.findUnique({ where: { provider: 'GOCARDLESS' } });
    if (conn?.apiKey && conn?.apiSecret) {
      return { appId: conn.apiKey, appSecret: conn.apiSecret, source: 'database' };
    }
  } catch (err) {
    logger.debug(`ServiceConnection GOCARDLESS lookup failed: ${err.message}`);
  }

  // 2. Fallback: BankAccount.syncConfig (legacy)
  if (bankAccountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (account?.syncConfig) {
      const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
      if (config.appId && config.appSecret) {
        return { ...config, source: 'bankAccount' };
      }
    }
  }

  // 3. Fallback: env vars
  const appId = process.env.YAPILY_APP_ID;
  const appSecret = process.env.YAPILY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Credencials GoCardless/Yapily no configurades. Configura-les a Connexions o al .env');
  }
  return { appId, appSecret, source: 'env' };
}

/**
 * Genera el header d'autenticació Basic Auth per Yapily
 */
function getAuthHeader(creds) {
  const encoded = Buffer.from(`${creds.appId}:${creds.appSecret}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Fa una petició autenticada a Yapily
 */
async function yapFetch(path, creds, options = {}) {
  const url = `${YAPILY_BASE_URL}${path}`;
  const headers = {
    'Authorization': getAuthHeader(creds),
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Yapily API error ${response.status} (${path}): ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Llista institucions bancàries disponibles per un país
 */
async function listInstitutions(bankAccountId, country = 'ES') {
  const creds = await getCredentials(bankAccountId);
  const data = await yapFetch(`/institutions?country=${country}`, creds);
  return (data.data || []).map(inst => ({
    id: inst.id,
    name: inst.name,
    countries: inst.countries,
    logo: inst.media?.find(m => m.type === 'logo')?.source || null,
    features: inst.features,
  }));
}

/**
 * Crea una sol·licitud d'autorització (redirigeix l'usuari al banc)
 * Retorna la URL on l'usuari ha d'anar per autoritzar
 */
async function createAuthRequest(bankAccountId, institutionId, redirectUrl) {
  const creds = await getCredentials(bankAccountId);

  const data = await yapFetch('/account-auth-requests', creds, {
    method: 'POST',
    body: {
      applicationUserId: `seitocamera_${bankAccountId}`,
      institutionId,
      callback: redirectUrl,
    },
  });

  // Guardar consent info a syncConfig
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  const currentConfig = typeof account?.syncConfig === 'object' && account.syncConfig ? account.syncConfig : {};

  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      syncConfig: {
        ...currentConfig,
        institutionId,
        consentId: data.data?.id,
        consentStatus: data.data?.status,
        applicationUserId: `seitocamera_${bankAccountId}`,
      },
    },
  });

  return {
    consentId: data.data?.id,
    authorisationUrl: data.data?.authorisationUrl,
    status: data.data?.status,
  };
}

/**
 * Comprova l'estat del consentiment i obté el consentToken
 */
async function checkConsentStatus(bankAccountId) {
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account?.syncConfig) throw new Error('Compte sense configuració de sync');

  const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
  if (!config.consentId) throw new Error('No hi ha consentiment pendent');

  const creds = await getCredentials(bankAccountId);
  const data = await yapFetch(`/consents/${config.consentId}`, creds);

  const consent = data.data || data;

  if (consent.status === 'AUTHORIZED' && consent.consentToken) {
    // Guardar el consentToken
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        syncConfig: {
          ...config,
          consentToken: consent.consentToken,
          consentStatus: 'AUTHORIZED',
          authorizedAt: new Date().toISOString(),
        },
      },
    });

    return {
      status: 'AUTHORIZED',
      consentToken: consent.consentToken,
    };
  }

  return {
    status: consent.status,
    statusDescription: getStatusDescription(consent.status),
  };
}

function getStatusDescription(status) {
  const descriptions = {
    AWAITING_AUTHORIZATION: 'Esperant autorització de l\'usuari al banc',
    AUTHORIZED: 'Autoritzat correctament',
    REJECTED: 'Rebutjat per l\'usuari o el banc',
    REVOKED: 'Revocat',
    EXPIRED: 'Expirat — cal reautoritzar',
    FAILED: 'Error durant l\'autorització',
    CONSUMED: 'Consumit — cal crear un nou consentiment',
    UNKNOWN: 'Estat desconegut',
  };
  return descriptions[status] || `Estat: ${status}`;
}

/**
 * Obté el consentToken guardat (necessari per totes les operacions de dades)
 */
async function getConsentToken(bankAccountId) {
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account?.syncConfig) throw new Error('Compte sense configuració de sync');

  const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
  if (!config.consentToken) {
    throw new Error('Compte no autoritzat — cal completar el flux Open Banking primer');
  }

  return config.consentToken;
}

/**
 * Obté la llista de comptes bancaris de l'usuari
 */
async function getAccounts(bankAccountId) {
  const creds = await getCredentials(bankAccountId);
  const consentToken = await getConsentToken(bankAccountId);

  const data = await yapFetch('/accounts', creds, {
    headers: { 'Consent': consentToken },
  });

  return (data.data || []).map(acc => ({
    id: acc.id,
    type: acc.type,
    iban: acc.identification?.find(i => i.type === 'IBAN')?.identification || acc.iban,
    name: acc.accountNames?.[0]?.name || acc.nickname || 'Compte',
    currency: acc.currency || 'EUR',
    balance: acc.balance,
  }));
}

/**
 * Obté el saldo d'un compte via Yapily
 */
async function getBalance(bankAccountId) {
  const creds = await getCredentials(bankAccountId);
  const consentToken = await getConsentToken(bankAccountId);

  const config = await getLinkedConfig(bankAccountId);
  const yapilyAccountId = config.yapilyAccountId;

  if (!yapilyAccountId) {
    // Si no tenim account ID guardat, obtenir el primer compte
    const accounts = await getAccounts(bankAccountId);
    if (!accounts.length) return null;

    // Guardar el primer account ID
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        syncConfig: { ...config, yapilyAccountId: accounts[0].id },
      },
    });

    return {
      balance: accounts[0].balance || 0,
      currency: accounts[0].currency || 'EUR',
      iban: accounts[0].iban,
    };
  }

  const data = await yapFetch(`/accounts/${yapilyAccountId}/balances`, creds, {
    headers: { 'Consent': consentToken },
  });

  const balances = data.data || [];
  const best = balances.find(b => b.type === 'CLOSING_BOOKED') ||
               balances.find(b => b.type === 'EXPECTED') ||
               balances[0];

  if (!best) return null;

  return {
    balance: best.balanceAmount?.amount || 0,
    currency: best.balanceAmount?.currency || 'EUR',
    type: best.type,
    date: best.dateTime,
  };
}

/**
 * Obté transaccions del compte via Yapily
 */
async function fetchTransactions(options = {}) {
  const { bankAccountId, dateFrom, dateTo } = options;
  const creds = await getCredentials(bankAccountId);
  const consentToken = await getConsentToken(bankAccountId);
  const config = await getLinkedConfig(bankAccountId);

  let yapilyAccountId = config.yapilyAccountId;

  // Si no tenim account ID, obtenir-lo
  if (!yapilyAccountId) {
    const accounts = await getAccounts(bankAccountId);
    if (!accounts.length) throw new Error('Cap compte bancari trobat via Open Banking');
    yapilyAccountId = accounts[0].id;
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { syncConfig: { ...config, yapilyAccountId } },
    });
  }

  let path = `/accounts/${yapilyAccountId}/transactions`;
  const params = new URLSearchParams();
  if (dateFrom) params.set('from', dateFrom);
  if (dateTo) params.set('before', dateTo);
  if (params.toString()) path += `?${params.toString()}`;

  const data = await yapFetch(path, creds, {
    headers: { 'Consent': consentToken },
  });

  const transactions = [];

  for (const tx of (data.data || [])) {
    const amount = tx.amount || 0;
    transactions.push({
      transactionId: tx.id || tx.reference || `yap_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      date: new Date(tx.bookingDateTime || tx.date || new Date()),
      settledAt: tx.bookingDateTime ? new Date(tx.bookingDateTime) : null,
      amount,
      currency: tx.currency || 'EUR',
      side: amount >= 0 ? 'credit' : 'debit',
      counterparty: tx.payeeDetails?.name || tx.payerDetails?.name || tx.description || '',
      reference: tx.reference || '',
      category: null,
      note: tx.supplementaryData?.internalRef || null,
      status: tx.status || 'booked',
      rawData: tx,
    });
  }

  return transactions;
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
      d.setDate(d.getDate() - 5);
      dateFrom = d.toISOString().split('T')[0];
    }
  }

  const transactions = await fetchTransactions({ bankAccountId, dateFrom });
  logger.info(`Open Banking sync: ${transactions.length} transaccions obtingudes`);

  let created = 0, skipped = 0, updated = 0, errors = 0;

  for (const tx of transactions) {
    try {
      if (tx.status === 'pending') { skipped++; continue; }

      const slug = tx.transactionId;
      if (!slug) { skipped++; continue; }

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
          qontoSlug: slug,
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
    const consentToken = await getConsentToken(bankAccountId);
    const accounts = await getAccounts(bankAccountId);
    return {
      connected: true,
      accounts: accounts.map(a => ({ name: a.name, iban: a.iban, currency: a.currency })),
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/**
 * Helper: obté la config d'un compte
 */
async function getLinkedConfig(bankAccountId) {
  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!account?.syncConfig) throw new Error('Compte sense configuració de sync');
  return typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
}

module.exports = {
  listInstitutions,
  createAuthRequest,
  checkConsentStatus,
  getAccounts,
  getBalance,
  fetchTransactions,
  syncTransactions,
  testConnection,
};
