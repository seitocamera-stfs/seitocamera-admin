const express = require('express');
const https = require('https');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../config/logger');

const router = express.Router();

// ===========================================
// GET /api/connections/zoho/callback — OAuth callback (PÚBLIC, Zoho hi redirigeix)
// ===========================================
router.get('/zoho/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      logger.error(`Zoho OAuth callback error: ${oauthError}`);
      return res.redirect(`/settings/connections?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code) {
      return res.redirect('/settings/connections?error=no_code');
    }

    // Buscar connexió existent
    let conn = await prisma.serviceConnection.findUnique({
      where: { provider: 'ZOHO_MAIL' },
    });

    const clientId = conn?.clientId || process.env.ZOHO_CLIENT_ID;
    const clientSecret = conn?.clientSecret || process.env.ZOHO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.redirect('/settings/connections?error=missing_credentials');
    }

    const baseUrl = process.env.APP_URL || `https://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/connections/zoho/callback`;

    // Intercanviar code per tokens
    const tokenData = await exchangeZohoCode(code, clientId, clientSecret, redirectUri);

    if (tokenData.error) {
      logger.error(`Zoho OAuth token exchange error: ${tokenData.error}`);
      return res.redirect(`/settings/connections?error=${encodeURIComponent(tokenData.error)}`);
    }

    // Obtenir account ID
    let accountId = conn?.config?.accountId || process.env.ZOHO_ACCOUNT_ID;
    try {
      const accounts = await getZohoAccounts(tokenData.access_token);
      if (accounts.length > 0) {
        accountId = accounts[0].accountId;
        logger.info(`Zoho OAuth: account ID obtingut automàticament: ${accountId}`);
      }
    } catch (err) {
      logger.warn(`No s'ha pogut obtenir account ID automàticament: ${err.message}`);
    }

    // Guardar/actualitzar connexió
    const fromAddress = conn?.config?.fromAddress || process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com';

    const data = {
      provider: 'ZOHO_MAIL',
      status: 'ACTIVE',
      displayName: `Zoho Mail — ${fromAddress}`,
      clientId,
      clientSecret,
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token,
      tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
      scopes: tokenData.scope || '',
      connectedAt: new Date(),
      lastError: null,
      config: {
        accountId,
        fromAddress,
      },
    };

    if (conn) {
      await prisma.serviceConnection.update({ where: { id: conn.id }, data });
    } else {
      await prisma.serviceConnection.create({ data });
    }

    logger.info(`Zoho OAuth: connexió completada amb èxit. Scopes: ${tokenData.scope}`);
    res.redirect('/settings/connections?success=zoho');
  } catch (error) {
    logger.error(`Zoho OAuth callback error: ${error.message}`);
    res.redirect(`/settings/connections?error=${encodeURIComponent(error.message)}`);
  }
});

// Totes les altres rutes requereixen autenticació + ADMIN
router.use(authenticate);
router.use(authorize('ADMIN'));

// ===========================================
// GET /api/connections — Llistar totes les connexions
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const connections = await prisma.serviceConnection.findMany({
      orderBy: { provider: 'asc' },
    });

    // Mai retornar secrets al frontend
    const safe = connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      status: c.status,
      displayName: c.displayName,
      scopes: c.scopes,
      connectedAt: c.connectedAt,
      lastUsedAt: c.lastUsedAt,
      lastError: c.lastError,
      hasCredentials: !!(c.refreshToken || c.apiKey || c.clientId),
      config: c.config ? sanitizeConfig(c.config) : null,
    }));

    // Afegir proveïdors no connectats com a DISCONNECTED
    const allProviders = ['ZOHO_MAIL', 'GOOGLE_DRIVE', 'QONTO', 'GOCARDLESS', 'RENTMAN', 'SMTP'];
    const connected = new Set(safe.map((c) => c.provider));
    for (const provider of allProviders) {
      if (!connected.has(provider)) {
        safe.push({
          id: null,
          provider,
          status: 'DISCONNECTED',
          displayName: null,
          scopes: null,
          connectedAt: null,
          lastUsedAt: null,
          lastError: null,
          hasCredentials: false,
          config: null,
        });
      }
    }

    safe.sort((a, b) => a.provider.localeCompare(b.provider));
    res.json(safe);
  } catch (error) {
    next(error);
  }
});

/**
 * Sanitiza config per no exposar secrets
 */
function sanitizeConfig(config) {
  if (!config || typeof config !== 'object') return config;
  const safe = { ...config };
  // Amagar secrets però mostrar que existeixen
  for (const key of ['secretKey', 'password', 'apiSecret']) {
    if (safe[key]) safe[key] = '••••••••';
  }
  return safe;
}

// ===========================================
// GET /api/connections/zoho/auth-url — Generar URL d'autorització OAuth Zoho
// ===========================================
router.get('/zoho/auth-url', async (req, res, next) => {
  try {
    // Buscar connexió existent o crear-ne una nova
    let conn = await prisma.serviceConnection.findUnique({
      where: { provider: 'ZOHO_MAIL' },
    });

    // Agafar clientId de la connexió guardada o del .env (fallback)
    const clientId = conn?.clientId || process.env.ZOHO_CLIENT_ID;
    if (!clientId) {
      return res.status(400).json({
        error: 'Cal configurar primer el Client ID de Zoho. Ves a api-console.zoho.eu i crea una app.',
      });
    }

    // La redirect_uri apunta a l'app (callback del backend)
    const baseUrl = process.env.APP_URL || `https://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/connections/zoho/callback`;

    const scopes = [
      'ZohoMail.accounts.READ',
      'ZohoMail.messages.READ',
      'ZohoMail.messages.UPDATE',
      'ZohoMail.messages.CREATE',
      'ZohoMail.folders.READ',
      'ZohoMail.attachments.READ',
    ].join(',');

    const authUrl =
      `https://accounts.zoho.eu/oauth/v2/auth?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `access_type=offline&` +
      `prompt=consent`;

    logger.info(`Zoho OAuth: URL generada amb redirect_uri=${redirectUri}`);

    res.json({
      authUrl,
      redirectUri,
      scopes,
      note: 'IMPORTANT: La redirect_uri ha de coincidir exactament amb la configurada a api-console.zoho.eu',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Intercanvia un authorization code per tokens OAuth
 */
function exchangeZohoCode(code, clientId, clientSecret, redirectUri) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const options = {
      hostname: 'accounts.zoho.eu',
      path: '/oauth/v2/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Resposta no JSON de Zoho')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(params.toString());
    req.end();
  });
}

/**
 * Obté els comptes de Zoho Mail usant un access token
 */
function getZohoAccounts(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mail.zoho.eu',
      path: '/api/accounts',
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data || []);
        } catch { reject(new Error('Resposta no JSON')); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ===========================================
// PUT /api/connections/zoho/credentials — Guardar clientId/clientSecret manualment
// ===========================================
router.put('/zoho/credentials', async (req, res, next) => {
  try {
    const { clientId, clientSecret, accountId, fromAddress } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Cal indicar clientId i clientSecret' });
    }

    const data = {
      provider: 'ZOHO_MAIL',
      clientId,
      clientSecret,
      config: {
        accountId: accountId || process.env.ZOHO_ACCOUNT_ID || null,
        fromAddress: fromAddress || process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com',
      },
      updatedAt: new Date(),
    };

    const conn = await prisma.serviceConnection.upsert({
      where: { provider: 'ZOHO_MAIL' },
      update: data,
      create: { ...data, status: 'DISCONNECTED' },
    });

    res.json({ success: true, message: 'Credencials guardades. Ara pots autoritzar la connexió.' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/connections/qonto/credentials — Guardar credencials Qonto
// ===========================================
router.put('/qonto/credentials', async (req, res, next) => {
  try {
    const { orgSlug, secretKey } = req.body;
    if (!orgSlug || !secretKey) {
      return res.status(400).json({ error: 'Cal indicar Organization Slug i Secret Key' });
    }

    await prisma.serviceConnection.upsert({
      where: { provider: 'QONTO' },
      update: {
        apiKey: orgSlug,
        apiSecret: secretKey,
        displayName: `Qonto — ${orgSlug}`,
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
        lastError: null,
      },
      create: {
        provider: 'QONTO',
        apiKey: orgSlug,
        apiSecret: secretKey,
        displayName: `Qonto — ${orgSlug}`,
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'Credencials Qonto guardades.' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/connections/gocardless/credentials — Guardar credencials Plaid (usa provider GOCARDLESS)
// ===========================================
router.put('/gocardless/credentials', async (req, res, next) => {
  try {
    const { clientId, secret } = req.body;
    if (!clientId || !secret) {
      return res.status(400).json({ error: 'Cal indicar Client ID i Secret' });
    }

    await prisma.serviceConnection.upsert({
      where: { provider: 'GOCARDLESS' },
      update: {
        apiKey: clientId,
        apiSecret: secret,
        displayName: 'Plaid Open Banking',
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
        lastError: null,
      },
      create: {
        provider: 'GOCARDLESS',
        apiKey: clientId,
        apiSecret: secret,
        displayName: 'Plaid Open Banking',
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'Credencials Plaid guardades.' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/connections/plaid/link-token — Crear Link Token per Plaid Link
// ===========================================
router.post('/plaid/link-token', async (req, res, next) => {
  try {
    const openBanking = require('../services/openBankingService');
    const userId = req.user?.id || 'seitocamera_admin';
    const result = await openBanking.createLinkToken(userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/connections/plaid/exchange — Intercanviar public_token per access_token
// ===========================================
router.post('/plaid/exchange', async (req, res, next) => {
  try {
    const { publicToken, bankAccountId } = req.body;
    if (!publicToken) {
      return res.status(400).json({ error: 'Cal indicar el public_token' });
    }

    const openBanking = require('../services/openBankingService');
    const { accessToken, itemId } = await openBanking.exchangePublicToken(publicToken);

    // Si tenim un bankAccountId, guardar l'access_token al syncConfig
    if (bankAccountId) {
      const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      const currentConfig = typeof account?.syncConfig === 'object' && account.syncConfig ? account.syncConfig : {};

      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          syncConfig: {
            ...currentConfig,
            plaidAccessToken: accessToken,
            plaidItemId: itemId,
            provider: 'plaid',
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Obtenir els comptes vinculats per info
      try {
        const accounts = await openBanking.getAccounts(bankAccountId);
        if (accounts.length > 0) {
          await prisma.bankAccount.update({
            where: { id: bankAccountId },
            data: {
              syncConfig: {
                ...currentConfig,
                plaidAccessToken: accessToken,
                plaidItemId: itemId,
                plaidAccountId: accounts[0].id,
                provider: 'plaid',
                linkedAt: new Date().toISOString(),
              },
            },
          });
        }
      } catch (accErr) {
        logger.warn(`No s'han pogut obtenir comptes Plaid: ${accErr.message}`);
      }
    }

    res.json({
      success: true,
      itemId,
      message: 'Compte bancari vinculat via Plaid correctament.',
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/connections/rentman/credentials — Guardar credencials Rentman
// ===========================================
router.put('/rentman/credentials', async (req, res, next) => {
  try {
    const { apiToken } = req.body;
    if (!apiToken) {
      return res.status(400).json({ error: 'Cal indicar el token API' });
    }

    await prisma.serviceConnection.upsert({
      where: { provider: 'RENTMAN' },
      update: {
        apiKey: apiToken,
        displayName: 'Rentman API',
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
        lastError: null,
      },
      create: {
        provider: 'RENTMAN',
        apiKey: apiToken,
        displayName: 'Rentman API',
        status: 'ACTIVE',
        connectedBy: req.user?.id || null,
        connectedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'Credencials Rentman guardades.' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/connections/:provider/disconnect — Desconnectar servei
// ===========================================
router.post('/:provider/disconnect', async (req, res, next) => {
  try {
    const { provider } = req.params;

    const conn = await prisma.serviceConnection.findUnique({
      where: { provider: provider.toUpperCase() },
    });

    if (!conn) {
      return res.status(404).json({ error: 'Connexió no trobada' });
    }

    await prisma.serviceConnection.update({
      where: { id: conn.id },
      data: {
        status: 'DISCONNECTED',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        lastError: null,
      },
    });

    res.json({ success: true, message: `${provider} desconnectat` });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/connections/:provider/test — Testejar connexió
// ===========================================
router.post('/:provider/test', async (req, res, next) => {
  try {
    const { provider } = req.params;

    if (provider.toUpperCase() === 'ZOHO_MAIL') {
      const zohoMail = require('../services/zohoMailService');
      const result = await zohoMail.testConnection();

      // Actualitzar estat a la BD
      const conn = await prisma.serviceConnection.findUnique({
        where: { provider: 'ZOHO_MAIL' },
      });
      if (conn) {
        await prisma.serviceConnection.update({
          where: { id: conn.id },
          data: {
            status: result.connected ? 'ACTIVE' : 'ERROR',
            lastUsedAt: result.connected ? new Date() : undefined,
            lastError: result.connected ? null : result.error,
          },
        });
      }

      return res.json(result);
    }

    // Test Qonto
    if (provider.toUpperCase() === 'QONTO') {
      const conn = await prisma.serviceConnection.findUnique({ where: { provider: 'QONTO' } });
      if (!conn?.apiKey || !conn?.apiSecret) {
        return res.json({ connected: false, error: 'Credencials Qonto no configurades' });
      }
      try {
        const https = require('https');
        const testResult = await new Promise((resolve, reject) => {
          const options = {
            hostname: 'thirdparty.qonto.com',
            path: '/v2/organization',
            method: 'GET',
            headers: { Authorization: `${conn.apiKey}:${conn.apiSecret}` },
          };
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Resposta no JSON')); } });
          });
          req.on('error', reject);
          req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
          req.end();
        });
        const orgName = testResult.organization?.slug || testResult.organization?.legal_name || 'OK';
        await prisma.serviceConnection.update({
          where: { provider: 'QONTO' },
          data: { status: 'ACTIVE', lastUsedAt: new Date(), lastError: null, displayName: `Qonto — ${orgName}` },
        });
        return res.json({ connected: true, organization: orgName });
      } catch (err) {
        await prisma.serviceConnection.update({
          where: { provider: 'QONTO' },
          data: { status: 'ERROR', lastError: err.message },
        });
        return res.json({ connected: false, error: err.message });
      }
    }

    // Test Plaid (usa provider GOCARDLESS)
    if (provider.toUpperCase() === 'GOCARDLESS') {
      const openBanking = require('../services/openBankingService');
      const result = await openBanking.testConnection();
      const conn = await prisma.serviceConnection.findUnique({ where: { provider: 'GOCARDLESS' } });
      if (conn) {
        await prisma.serviceConnection.update({
          where: { provider: 'GOCARDLESS' },
          data: {
            status: result.connected ? 'ACTIVE' : 'ERROR',
            lastUsedAt: result.connected ? new Date() : undefined,
            lastError: result.connected ? null : result.error,
          },
        });
      }
      return res.json(result);
    }

    res.status(400).json({ error: `Test no implementat per ${provider}` });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/connections/zoho/migrate-env — Migrar credencials del .env a la BD
// ===========================================
router.post('/zoho/migrate-env', async (req, res, next) => {
  try {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
    const accountId = process.env.ZOHO_ACCOUNT_ID;

    if (!clientId || !refreshToken) {
      return res.status(400).json({ error: 'No hi ha credencials Zoho al .env per migrar' });
    }

    const data = {
      provider: 'ZOHO_MAIL',
      status: 'ACTIVE',
      displayName: `Zoho Mail — ${process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com'}`,
      clientId,
      clientSecret,
      refreshToken,
      scopes: 'ZohoMail.accounts.READ,ZohoMail.messages.UPDATE', // scopes actuals
      connectedBy: req.user?.id || null,
      connectedAt: new Date(),
      config: {
        accountId,
        fromAddress: process.env.ZOHO_REMINDER_FROM || 'rental@seitocamera.com',
      },
    };

    await prisma.serviceConnection.upsert({
      where: { provider: 'ZOHO_MAIL' },
      update: data,
      create: data,
    });

    res.json({
      success: true,
      message: 'Credencials Zoho migrades del .env a la base de dades. Ara pots re-autoritzar per obtenir el scope CREATE.',
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
