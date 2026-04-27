const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei Plaid Open Banking
// ===========================================
// Connexió Open Banking per Banc Sabadell i altres bancs espanyols.
// Documentació: https://plaid.com/docs/api/
//
// Env vars necessàries:
//   PLAID_CLIENT_ID    — Client ID (dashboard.plaid.com)
//   PLAID_SECRET       — Secret Key
//   PLAID_ENV          — sandbox | development | production
//   APP_URL            — URL base de l'app (per redirect)
// ===========================================

const PLAID_ENVS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

function getPlaidBaseUrl() {
  const env = process.env.PLAID_ENV || 'sandbox';
  return PLAID_ENVS[env] || PLAID_ENVS.sandbox;
}

/**
 * Obté les credencials Plaid: ServiceConnection → .env
 */
async function getCredentials() {
  // 1. Mirar ServiceConnection (centralitzat)
  try {
    const conn = await prisma.serviceConnection.findUnique({ where: { provider: 'GOCARDLESS' } });
    if (conn?.apiKey && conn?.apiSecret) {
      return { clientId: conn.apiKey, secret: conn.apiSecret, source: 'database' };
    }
  } catch (err) {
    logger.debug(`ServiceConnection GOCARDLESS lookup failed: ${err.message}`);
  }

  // 2. Fallback: env vars
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error('Credencials Plaid no configurades. Configura-les a Connexions o al .env');
  }
  return { clientId, secret, source: 'env' };
}

/**
 * Fa una petició a l'API de Plaid (tots els endpoints són POST)
 */
async function plaidFetch(path, body = {}) {
  const creds = await getCredentials();
  const url = `${getPlaidBaseUrl()}${path}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...body,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error_code) {
    const errMsg = data.error_message || data.error_code || `HTTP ${response.status}`;
    throw new Error(`Plaid API error (${path}): ${errMsg}`);
  }

  return data;
}

/**
 * Crea un Link Token per iniciar el flux d'autorització Plaid Link
 * El frontend usarà aquest token per obrir el widget Plaid Link
 */
async function createLinkToken(userId) {
  const data = await plaidFetch('/link/token/create', {
    user: { client_user_id: userId || 'seitocamera_default' },
    client_name: 'SeitoCamera Admin',
    products: ['transactions'],
    country_codes: ['ES'],
    language: 'es',
    redirect_uri: undefined, // no necessari per Link modal
  });

  return {
    linkToken: data.link_token,
    expiration: data.expiration,
  };
}

/**
 * Intercanvia un public_token (del frontend) per un access_token permanent
 */
async function exchangePublicToken(publicToken) {
  const data = await plaidFetch('/item/public_token/exchange', {
    public_token: publicToken,
  });

  return {
    accessToken: data.access_token,
    itemId: data.item_id,
  };
}

/**
 * Obté la llista de comptes bancaris vinculats a un item Plaid
 */
async function getAccounts(bankAccountId) {
  const config = await getLinkedConfig(bankAccountId);
  if (!config.plaidAccessToken) {
    throw new Error('Compte no vinculat a Plaid — cal completar el flux Open Banking primer');
  }

  const data = await plaidFetch('/accounts/get', {
    access_token: config.plaidAccessToken,
  });

  return (data.accounts || []).map(acc => ({
    id: acc.account_id,
    type: acc.type,
    subtype: acc.subtype,
    iban: acc.iban || null,
    name: acc.official_name || acc.name || 'Compte',
    currency: acc.balances?.iso_currency_code || 'EUR',
    balance: acc.balances?.current || 0,
    availableBalance: acc.balances?.available || null,
  }));
}

/**
 * Obté el saldo d'un compte via Plaid
 */
async function getBalance(bankAccountId) {
  const config = await getLinkedConfig(bankAccountId);
  if (!config.plaidAccessToken) return null;

  try {
    const data = await plaidFetch('/accounts/balance/get', {
      access_token: config.plaidAccessToken,
    });

    const accounts = data.accounts || [];
    // Si tenim un account ID específic, filtrar
    const acc = config.plaidAccountId
      ? accounts.find(a => a.account_id === config.plaidAccountId)
      : accounts[0];

    if (!acc) return null;

    return {
      balance: acc.balances?.current || 0,
      availableBalance: acc.balances?.available || null,
      currency: acc.balances?.iso_currency_code || 'EUR',
      name: acc.official_name || acc.name,
    };
  } catch (err) {
    logger.warn(`Plaid getBalance error: ${err.message}`);
    return null;
  }
}

/**
 * Obté transaccions del compte via Plaid
 */
async function fetchTransactions(options = {}) {
  const { bankAccountId, dateFrom, dateTo } = options;
  const config = await getLinkedConfig(bankAccountId);
  if (!config.plaidAccessToken) {
    throw new Error('Compte no vinculat a Plaid — cal completar el flux Open Banking primer');
  }

  const startDate = dateFrom || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = dateTo || new Date().toISOString().split('T')[0];

  const body = {
    access_token: config.plaidAccessToken,
    start_date: startDate,
    end_date: endDate,
    options: {
      count: 500,
      offset: 0,
    },
  };

  // Si tenim un account ID específic, filtrar
  if (config.plaidAccountId) {
    body.options.account_ids = [config.plaidAccountId];
  }

  const allTransactions = [];
  let totalAvailable = Infinity;

  while (allTransactions.length < totalAvailable) {
    body.options.offset = allTransactions.length;
    const data = await plaidFetch('/transactions/get', body);
    totalAvailable = data.total_transactions || 0;
    const txs = data.transactions || [];
    if (!txs.length) break;
    allTransactions.push(...txs);
  }

  return allTransactions.map(tx => {
    // Plaid: amount positiu = despesa, negatiu = ingrés (invers al que esperem)
    const amount = -(tx.amount || 0);
    return {
      transactionId: tx.transaction_id,
      date: new Date(tx.date),
      settledAt: tx.authorized_date ? new Date(tx.authorized_date) : null,
      amount,
      currency: tx.iso_currency_code || 'EUR',
      side: amount >= 0 ? 'credit' : 'debit',
      counterparty: tx.merchant_name || tx.name || '',
      reference: tx.payment_channel || '',
      category: tx.personal_finance_category?.primary || (tx.category || []).join(' > ') || null,
      note: tx.name || null,
      status: tx.pending ? 'pending' : 'booked',
      rawData: tx,
    };
  });
}

/**
 * Sincronitza transaccions Plaid amb la BD
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
  logger.info(`Plaid sync: ${transactions.length} transaccions obtingudes`);

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
              category: tx.category || null,
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
        ? (tx.note && tx.note !== tx.counterparty ? `${tx.counterparty} — ${tx.note}` : tx.counterparty)
        : tx.note || 'Transacció bancària';

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
          category: tx.category || null,
          qontoSlug: slug,
          rawData: tx.rawData,
        },
      });
      created++;
    } catch (err) {
      logger.error(`Plaid sync error: ${err.message}`);
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
    logger.warn(`Plaid: No s'ha pogut obtenir saldo: ${balErr.message}`);
  }

  logger.info(`Plaid sync: ${created} creats, ${skipped} omesos, ${updated} actualitzats, ${errors} errors`);

  return { total: transactions.length, created, skipped, updated, errors, balance };
}

/**
 * Testa la connexió Plaid (comprova que les credencials API són vàlides)
 */
async function testConnection(bankAccountId) {
  try {
    // Testejar creant un link token (operació lleugera)
    const result = await createLinkToken('test_connection');
    return {
      connected: true,
      message: 'Credencials Plaid vàlides',
      environment: process.env.PLAID_ENV || 'sandbox',
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/**
 * Testa la connexió d'un compte bancari específic (access_token)
 */
async function testBankConnection(bankAccountId) {
  try {
    const accounts = await getAccounts(bankAccountId);
    return {
      connected: true,
      accounts: accounts.map(a => ({ name: a.name, currency: a.currency, balance: a.balance })),
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
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  getBalance,
  fetchTransactions,
  syncTransactions,
  testConnection,
  testBankConnection,
};
