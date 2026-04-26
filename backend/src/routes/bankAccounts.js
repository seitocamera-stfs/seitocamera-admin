const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('bank'));

// ===========================================
// Schemas de validació
// ===========================================

const bankAccountSchema = z.object({
  name: z.string().min(1, 'Nom requerit'),
  iban: z.string().optional().nullable(),
  bankEntity: z.string().optional().nullable(),
  syncType: z.enum(['MANUAL', 'CSV', 'QONTO', 'OPEN_BANKING']).optional().default('MANUAL'),
  color: z.string().optional().default('#2390A0'),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

// ===========================================
// GET /api/bank-accounts — Llistar comptes bancaris
// ===========================================
router.get('/', async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { movements: true } },
      },
    });
    res.json(accounts);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/summary — Resum amb saldo per compte
// ===========================================
router.get('/summary', async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    // Rang de dates: últims 30 dies per defecte per al resum
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    const summaries = await Promise.all(accounts.map(async (acc) => {
      const [incomeMonth, expenseMonth, totalCount, lastMovement] = await Promise.all([
        prisma.bankMovement.aggregate({
          where: { bankAccountId: acc.id, type: 'INCOME', date: { gte: thirtyDaysAgo } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.bankMovement.aggregate({
          where: { bankAccountId: acc.id, type: 'EXPENSE', date: { gte: thirtyDaysAgo } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.bankMovement.count({ where: { bankAccountId: acc.id } }),
        prisma.bankMovement.findFirst({
          where: { bankAccountId: acc.id, balance: { not: null } },
          orderBy: { date: 'desc' },
          select: { balance: true, date: true },
        }),
      ]);

      const monthIncome = parseFloat(incomeMonth._sum.amount || 0);
      const monthExpense = parseFloat(expenseMonth._sum.amount || 0);
      const lastBalance = lastMovement ? parseFloat(lastMovement.balance) : null;

      return {
        id: acc.id,
        name: acc.name,
        bankEntity: acc.bankEntity,
        color: acc.color,
        syncType: acc.syncType,
        isDefault: acc.isDefault,
        balance: lastBalance,
        balanceDate: lastMovement?.date || null,
        currentBalance: acc.currentBalance ? parseFloat(acc.currentBalance) : null,
        lastSyncAt: acc.lastSyncAt,
        incomeMonth: monthIncome,
        expenseMonth: monthExpense,
        movementCount: totalCount,
      };
    }));

    // Total global
    const totals = summaries.reduce((acc, s) => ({
      balance: acc.balance + (s.balance || 0),
      incomeMonth: acc.incomeMonth + s.incomeMonth,
      expenseMonth: acc.expenseMonth + s.expenseMonth,
      movementCount: acc.movementCount + s.movementCount,
    }), { balance: 0, incomeMonth: 0, expenseMonth: 0, movementCount: 0 });
    totals.hasBalance = summaries.some(s => s.balance !== null);

    res.json({ accounts: summaries, totals });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/all — Tots (inclús inactius)
// ===========================================
router.get('/all', authorize('ADMIN'), async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { movements: true } },
      },
    });
    res.json(accounts);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/:id — Detall compte
// ===========================================
router.get('/:id', async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { movements: true } },
      },
    });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });
    res.json(account);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts — Crear compte
// ===========================================
router.post('/', authorize('ADMIN'), validate(bankAccountSchema), async (req, res, next) => {
  try {
    const data = { ...req.body };

    // Si és el primer o es marca com a default, treure default dels altres
    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const account = await prisma.bankAccount.create({ data });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// PUT /api/bank-accounts/:id — Actualitzar compte
// ===========================================
router.put('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const data = { ...req.body };
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const account = await prisma.bankAccount.update({
      where: { id: req.params.id },
      data,
    });
    res.json(account);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Compte no trobat' });
    next(error);
  }
});

// ===========================================
// DELETE /api/bank-accounts/:id — Desactivar compte (soft delete)
// ===========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { movements: true } } },
    });

    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    if (account.isDefault) {
      return res.status(400).json({ error: 'No es pot eliminar el compte per defecte' });
    }

    // Soft delete: desactivar
    await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: 'Compte desactivat', movementsCount: account._count.movements });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/import-csv — Importar CSV per un compte
// ===========================================
router.post('/:id/import-csv', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    const { movements, format } = req.body;

    if (!Array.isArray(movements) || movements.length === 0) {
      return res.status(400).json({ error: 'Cal enviar un array de moviments' });
    }

    // Parsejar segons format (genèric o Sabadell)
    const data = movements.map((m) => {
      const amount = parseFloat(m.amount);
      return {
        date: new Date(m.date),
        valueDate: m.valueDate ? new Date(m.valueDate) : null,
        description: m.description || m.concept || '',
        amount,
        balance: m.balance ? parseFloat(m.balance) : null,
        type: m.type || (amount >= 0 ? 'INCOME' : 'EXPENSE'),
        reference: m.reference || null,
        bankAccountId: req.params.id,
        counterparty: m.counterparty || null,
        rawData: m,
      };
    });

    const result = await prisma.bankMovement.createMany({
      data,
      skipDuplicates: true,
    });

    res.status(201).json({
      message: `${result.count} moviments importats al compte ${account.name}`,
      count: result.count,
      accountName: account.name,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/connect — Configurar connexió API
// ===========================================
router.post('/:id/connect', authorize('ADMIN'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    const { syncType, config } = req.body;

    if (syncType === 'QONTO') {
      // Guardar credencials Qonto
      if (!config?.orgSlug || !config?.secretKey) {
        return res.status(400).json({ error: 'Cal orgSlug i secretKey per Qonto' });
      }

      // Testar connexió primer
      const qontoApi = require('../services/qontoApiService');
      await prisma.bankAccount.update({
        where: { id: req.params.id },
        data: {
          syncType: 'QONTO',
          syncConfig: { orgSlug: config.orgSlug, secretKey: config.secretKey },
        },
      });

      const test = await qontoApi.testConnection(req.params.id);
      if (!test.connected) {
        // Revertir
        await prisma.bankAccount.update({
          where: { id: req.params.id },
          data: { syncType: 'MANUAL', syncConfig: null },
        });
        return res.status(400).json({ error: `Error connectant Qonto: ${test.error}` });
      }

      res.json({ success: true, message: `Connectat a Qonto: ${test.orgName}`, accounts: test.accounts });

    } else if (syncType === 'OPEN_BANKING') {
      // Iniciar flux Yapily Open Banking
      if (!config?.institutionId) {
        return res.status(400).json({ error: 'Cal institutionId per Open Banking' });
      }

      // Guardar credencials Yapily
      const currentConfig = typeof account.syncConfig === 'object' && account.syncConfig ? account.syncConfig : {};
      if (config.appId && config.appSecret) {
        await prisma.bankAccount.update({
          where: { id: req.params.id },
          data: {
            syncType: 'OPEN_BANKING',
            syncConfig: { ...currentConfig, appId: config.appId, appSecret: config.appSecret },
          },
        });
      } else {
        await prisma.bankAccount.update({
          where: { id: req.params.id },
          data: { syncType: 'OPEN_BANKING' },
        });
      }

      const openBanking = require('../services/openBankingService');
      const redirectUrl = config.redirectUrl || `${process.env.APP_BASE_URL || 'https://admin.seitocamera.com'}/bank?callback=openbanking&accountId=${req.params.id}`;

      const authRequest = await openBanking.createAuthRequest(
        req.params.id,
        config.institutionId,
        redirectUrl
      );

      res.json({
        success: true,
        message: 'Redirigeix l\'usuari al banc per autoritzar',
        link: authRequest.authorisationUrl,
        consentId: authRequest.consentId,
      });

    } else {
      return res.status(400).json({ error: 'syncType ha de ser QONTO o OPEN_BANKING' });
    }
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/check-connection — Comprovar estat connexió OB
// ===========================================
router.post('/:id/check-connection', authorize('ADMIN'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    if (account.syncType === 'OPEN_BANKING') {
      const openBanking = require('../services/openBankingService');
      const status = await openBanking.checkConsentStatus(req.params.id);
      res.json(status);
    } else if (account.syncType === 'QONTO') {
      const qontoApi = require('../services/qontoApiService');
      const test = await qontoApi.testConnection(req.params.id);
      res.json(test);
    } else {
      res.json({ connected: false, status: 'manual', message: 'Compte manual, sense connexió API' });
    }
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/sync — Sincronitzar transaccions
// ===========================================
router.post('/:id/sync', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    const { fullSync = false } = req.body;
    let result;

    if (account.syncType === 'QONTO') {
      const qontoApi = require('../services/qontoApiService');
      result = await qontoApi.syncTransactions({ bankAccountId: req.params.id, fullSync });
    } else if (account.syncType === 'OPEN_BANKING') {
      const openBanking = require('../services/openBankingService');
      result = await openBanking.syncTransactions({ bankAccountId: req.params.id, fullSync });
    } else {
      return res.status(400).json({ error: 'Aquest compte no té sincronització automàtica configurada' });
    }

    // Actualitzar lastSyncAt
    await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: result.errors > 0 ? `${result.errors} errors durant la sync` : null,
      },
    });

    res.json({
      success: true,
      ...result,
      message: `Sincronització completada: ${result.created} nous, ${result.skipped} omesos, ${result.updated} actualitzats`,
    });
  } catch (error) {
    // Guardar l'error al compte
    try {
      await prisma.bankAccount.update({
        where: { id: req.params.id },
        data: { lastSyncError: error.message },
      });
    } catch (e) { /* ignore */ }
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/:id/connection-status — Estat de la connexió
// ===========================================
router.get('/:id/connection-status', async (req, res, next) => {
  try {
    const account = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: 'Compte no trobat' });

    const config = typeof account.syncConfig === 'object' ? account.syncConfig : {};

    res.json({
      syncType: account.syncType,
      currentBalance: account.currentBalance ? parseFloat(account.currentBalance) : null,
      lastSyncAt: account.lastSyncAt,
      lastSyncError: account.lastSyncError,
      isConnected: account.syncType === 'QONTO'
        ? !!(config.orgSlug && config.secretKey)
        : account.syncType === 'OPEN_BANKING'
          ? !!(config.consentToken)
          : false,
      hasCredentials: account.syncType === 'QONTO'
        ? !!(config.orgSlug)
        : account.syncType === 'OPEN_BANKING'
          ? !!(config.appId)
          : false,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// POST /api/bank-accounts/:id/disconnect — Desconnectar API
// ===========================================
router.post('/:id/disconnect', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: {
        syncType: 'MANUAL',
        syncConfig: null,
        lastSyncError: null,
      },
    });
    res.json({ success: true, message: 'Connexió desactivada' });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// GET /api/bank-accounts/institutions/:country — Llistar bancs disponibles (Open Banking)
// ===========================================
router.get('/institutions/:country', authorize('ADMIN'), async (req, res, next) => {
  try {
    const openBanking = require('../services/openBankingService');
    const institutions = await openBanking.listInstitutions(null, req.params.country);
    res.json(institutions);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
