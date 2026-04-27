const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei Qonto API v2 — connexió directa
// ===========================================
// Substitueix el Google Sheets sync per API REST directa.
// Documentació: https://api-doc.qonto.com/
//
// Env vars necessàries:
//   QONTO_ORG_SLUG     — slug de l'organització (Settings → API)
//   QONTO_SECRET_KEY   — clau secreta
// ===========================================

const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

/**
 * Obté les credencials de Qonto: ServiceConnection → BankAccount.syncConfig → .env
 */
async function getCredentials(bankAccountId) {
  // 1. Mirar ServiceConnection (centralitzat)
  try {
    const conn = await prisma.serviceConnection.findUnique({ where: { provider: 'QONTO' } });
    if (conn?.apiKey && conn?.apiSecret) {
      return { orgSlug: conn.apiKey, secretKey: conn.apiSecret, source: 'database' };
    }
  } catch (err) {
    logger.debug(`ServiceConnection QONTO lookup failed: ${err.message}`);
  }

  // 2. Fallback: BankAccount.syncConfig (legacy)
  if (bankAccountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (account?.syncConfig) {
      const config = typeof account.syncConfig === 'string' ? JSON.parse(account.syncConfig) : account.syncConfig;
      if (config.orgSlug && config.secretKey) {
        return { orgSlug: config.orgSlug, secretKey: config.secretKey, source: 'bankAccount' };
      }
    }
  }

  // 3. Fallback: env vars
  const orgSlug = process.env.QONTO_ORG_SLUG;
  const secretKey = process.env.QONTO_SECRET_KEY;
  if (!orgSlug || !secretKey) {
    throw new Error('Credencials Qonto no configurades. Configura-les a Connexions o al .env');
  }
  return { orgSlug, secretKey, source: 'env' };
}

/**
 * Fa una petició a l'API de Qonto
 */
async function qontoFetch(path, credentials, params = {}) {
  const url = new URL(`${QONTO_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `${credentials.orgSlug}:${credentials.secretKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Qonto API error ${response.status}: ${body}`);
  }

  return response.json();
}

/**
 * Obté informació de l'organització (comptes bancaris + saldos)
 */
async function getOrganization(bankAccountId) {
  const creds = await getCredentials(bankAccountId);
  const data = await qontoFetch('/organization', creds);
  return data.organization;
}

/**
 * Obté tots els comptes bancaris de Qonto amb saldos
 */
async function getBankAccounts(bankAccountId) {
  const org = await getOrganization(bankAccountId);
  return (org.bank_accounts || []).map(acc => ({
    slug: acc.slug,
    name: acc.name,
    iban: acc.iban,
    bic: acc.bic,
    currency: acc.currency,
    balance: acc.balance,
    balanceCents: acc.balance_cents,
    authorizedBalance: acc.authorized_balance,
    status: acc.status,
  }));
}

/**
 * Obté el saldo real del compte Qonto (total + desglossament per sub-compte)
 */
async function getBalance(bankAccountId) {
  const accounts = await getBankAccounts(bankAccountId);
  if (!accounts.length) return null;

  const activeAccounts = accounts.filter(a => a.status === 'active');
  const totalBalance = activeAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  return {
    balance: Math.round(totalBalance * 100) / 100,
    currency: activeAccounts[0]?.currency || 'EUR',
    accounts: activeAccounts.map(a => ({
      name: a.name,
      slug: a.slug,
      balance: a.balance,
      iban: a.iban,
    })),
  };
}

/**
 * Mapeja el "side" de Qonto al MovementType
 */
function mapMovementType(side, operationType) {
  if (operationType === 'income') return 'INCOME';
  if (side === 'credit') return 'INCOME';
  if (operationType === 'transfer') return 'TRANSFER';
  return 'EXPENSE';
}

/**
 * Llista transaccions de Qonto amb paginació
 * @param {Object} options - { bankAccountId, dateFrom, dateTo, fullSync }
 */
async function fetchTransactions(options = {}) {
  const { bankAccountId, dateFrom, dateTo } = options;
  const creds = await getCredentials(bankAccountId);

  // Primer obtenir el slug del compte bancari de Qonto
  const accounts = await getBankAccounts(bankAccountId);
  if (!accounts.length) throw new Error('Cap compte bancari trobat a Qonto');

  const allTransactions = [];

  for (const qontoAcc of accounts) {
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const params = {
        slug: qontoAcc.slug,
        per_page: 100,
      };
      if (dateFrom) params.settled_at_from = dateFrom;
      if (dateTo) params.settled_at_to = dateTo;
      if (cursor) params.current_page = cursor;

      const data = await qontoFetch('/transactions', creds, params);

      for (const tx of (data.transactions || [])) {
        if (tx.status === 'declined') continue;

        allTransactions.push({
          transactionId: tx.transaction_id,
          date: new Date(tx.emitted_at),
          settledAt: tx.settled_at ? new Date(tx.settled_at) : null,
          amount: tx.side === 'debit' ? -Math.abs(tx.amount) : Math.abs(tx.amount),
          currency: tx.currency,
          side: tx.side,
          operationType: tx.operation_type,
          counterparty: tx.label || '',
          reference: tx.reference || '',
          category: tx.category || null,
          note: tx.note || null,
          status: tx.status,
          accountSlug: qontoAcc.slug,
          accountName: qontoAcc.name,
          vatAmount: tx.vat_amount,
          vatRate: tx.vat_rate,
          attachmentIds: tx.attachment_ids || [],
          rawData: tx,
        });
      }

      // Paginació cursor
      cursor = data.meta?.next_cursor || null;
      hasMore = !!cursor;
    }
  }

  return allTransactions;
}

/**
 * Sincronitza transaccions de l'API Qonto amb la BD
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
      // Agafar 5 dies enrere per seguretat (transaccions pending que es liquiden)
      const d = new Date(lastMovement.date);
      d.setDate(d.getDate() - 5);
      dateFrom = d.toISOString().split('T')[0];
    }
  }

  const transactions = await fetchTransactions({ bankAccountId, dateFrom });
  logger.info(`Qonto API sync: ${transactions.length} transaccions obtingudes`);

  let created = 0, skipped = 0, updated = 0, errors = 0;

  for (const tx of transactions) {
    try {
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
              category: tx.category || null,
              accountName: tx.accountName || null,
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
        : tx.reference || tx.category || 'Transacció Qonto';

      await prisma.bankMovement.create({
        data: {
          date: tx.date,
          valueDate: tx.settledAt && !isNaN(tx.settledAt.getTime()) ? tx.settledAt : null,
          description,
          amount: tx.amount,
          type: mapMovementType(tx.side, tx.operationType),
          reference: tx.reference || null,
          bankAccount: 'Qonto',
          bankAccountId,
          counterparty: tx.counterparty || null,
          accountName: tx.accountName || null,
          category: tx.category || null,
          operationType: tx.operationType || null,
          qontoSlug: slug,
          rawData: tx.rawData,
        },
      });
      created++;
    } catch (err) {
      logger.error(`Qonto API sync error: ${err.message}`);
      errors++;
    }
  }

  // Obtenir saldo real (total + desglossament) i guardar-lo
  let balance = null;
  let subAccounts = null;
  try {
    const balanceData = await getBalance(bankAccountId);
    if (balanceData) {
      balance = balanceData.balance;
      subAccounts = balanceData.accounts;

      // Guardar saldo total + desglossament al syncConfig
      const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      const currentConfig = typeof account?.syncConfig === 'object' && account.syncConfig ? account.syncConfig : {};

      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          currentBalance: balanceData.balance,
          lastSyncAt: new Date(),
          lastSyncError: null,
          syncConfig: {
            ...currentConfig,
            subAccounts: balanceData.accounts,
          },
        },
      });
    }
  } catch (balErr) {
    logger.warn(`Qonto API: No s'ha pogut obtenir saldo: ${balErr.message}`);
  }

  logger.info(`Qonto API sync: ${created} creats, ${skipped} omesos, ${updated} actualitzats, ${errors} errors`);

  return { total: transactions.length, created, skipped, updated, errors, balance, subAccounts };
}

/**
 * Testa la connexió a l'API de Qonto
 */
async function testConnection(bankAccountId) {
  try {
    const org = await getOrganization(bankAccountId);
    const accounts = (org.bank_accounts || []).map(a => ({
      name: a.name,
      iban: a.iban,
      balance: a.balance,
      status: a.status,
    }));
    return { connected: true, orgName: org.name, accounts };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  getOrganization,
  getBankAccounts,
  getBalance,
  fetchTransactions,
  syncTransactions,
  testConnection,
};
