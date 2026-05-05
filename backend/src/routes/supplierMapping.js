/**
 * Supplier Mapping — Pantalla d'assignació de comptes per defecte als
 * proveïdors. Permet veure l'historial d'ús de comptes per cada proveïdor
 * i fixar el `defaultExpenseAccountId`, així `invoicePostingService` el
 * fa servir directament sense haver de passar per l'agent IA.
 */
const express = require('express');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();
router.use(authenticate);
router.use(requireSection('accounting'));

/**
 * GET /api/supplier-mapping
 * Retorna proveïdors amb estadístiques d'ús de comptes (per assignar default)
 *
 * Query: ?onlyMissing=true → només proveïdors sense default assignat
 */
router.get('/', async (req, res, next) => {
  try {
    const onlyMissing = req.query.onlyMissing === 'true';

    // Estadístiques: comptes utilitzats per proveïdor (només factures comptabilitzades)
    const usageRaw = await prisma.$queryRawUnsafe(`
      SELECT
        ri."supplierId",
        ri."accountId",
        coa.code AS account_code,
        coa.name AS account_name,
        COUNT(*)::int AS count,
        SUM(ri."totalAmount")::float AS total
      FROM received_invoices ri
      JOIN chart_of_accounts coa ON coa.id = ri."accountId"
      WHERE ri."deletedAt" IS NULL
        AND ri."journalEntryId" IS NOT NULL
        AND ri."supplierId" IS NOT NULL
        AND ri."accountId" IS NOT NULL
      GROUP BY ri."supplierId", ri."accountId", coa.code, coa.name
    `);

    // Indexar per supplierId
    const usageBySupplier = {};
    for (const r of usageRaw) {
      if (!usageBySupplier[r.supplierId]) usageBySupplier[r.supplierId] = [];
      usageBySupplier[r.supplierId].push({
        accountId: r.accountId,
        code: r.account_code,
        name: r.account_name,
        count: r.count,
        total: Number(r.total) || 0,
      });
    }

    // Llistar tots els proveïdors actius amb almenys 1 factura
    const suppliers = await prisma.supplier.findMany({
      where: {
        isActive: true,
        receivedInvoices: { some: { deletedAt: null } },
      },
      select: {
        id: true, name: true, nif: true, isPublicAdmin: true,
        defaultExpenseAccountId: true,
        defaultExpenseAccount: { select: { id: true, code: true, name: true } },
        _count: { select: { receivedInvoices: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });

    const result = suppliers.map((s) => {
      const usage = (usageBySupplier[s.id] || []).sort((a, b) => b.count - a.count);
      const top = usage[0] || null;
      return {
        id: s.id,
        name: s.name,
        nif: s.nif,
        isPublicAdmin: s.isPublicAdmin,
        defaultAccount: s.defaultExpenseAccount,
        invoiceCount: s._count.receivedInvoices,
        totalAmount: usage.reduce((s, u) => s + u.total, 0),
        topAccount: top,
        usage: usage.slice(0, 5),
        needsAttention: !s.defaultExpenseAccountId && top !== null,
      };
    }).filter((s) => onlyMissing ? !s.defaultAccount : true);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

const setDefaultSchema = z.object({
  accountId: z.string().nullable(),
});

/**
 * PATCH /api/supplier-mapping/:supplierId
 * Body: { accountId: string|null }
 * Assigna (o esborra amb null) el defaultExpenseAccountId d'un proveïdor
 */
router.patch('/:supplierId', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const parse = setDefaultSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
    const { accountId } = parse.data;

    if (accountId) {
      // Validar que sigui leaf
      const acc = await prisma.chartOfAccount.findUnique({ where: { id: accountId } });
      if (!acc) return res.status(404).json({ error: 'Compte no trobat' });
      if (!acc.isLeaf) return res.status(400).json({ error: 'El compte ha de ser de detall (leaf)' });
    }

    const updated = await prisma.supplier.update({
      where: { id: req.params.supplierId },
      data: { defaultExpenseAccountId: accountId },
      include: { defaultExpenseAccount: { select: { id: true, code: true, name: true } } },
    });

    res.json({ id: updated.id, defaultAccount: updated.defaultExpenseAccount });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Proveïdor no trobat' });
    next(err);
  }
});

/**
 * POST /api/supplier-mapping/:supplierId/suggest-reclassify
 * Body: { accountId }
 * Crea AgentSuggestion PENDING per cada factura del proveïdor que tingui un
 * compte diferent del nou (per revisar i aplicar al supervisor IA).
 */
router.post('/:supplierId/suggest-reclassify', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const parse = setDefaultSchema.safeParse(req.body);
    if (!parse.success || !parse.data.accountId) {
      return res.status(400).json({ error: 'accountId requerit' });
    }
    const { accountId } = parse.data;

    const acc = await prisma.chartOfAccount.findUnique({ where: { id: accountId } });
    if (!acc?.isLeaf) return res.status(400).json({ error: 'Compte invàlid o no leaf' });

    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        supplierId: req.params.supplierId,
        deletedAt: null,
        journalEntryId: { not: null },
        accountId: { not: accountId },
      },
      include: { account: { select: { id: true, code: true, name: true } } },
    });

    let created = 0, skipped = 0;
    for (const inv of invoices) {
      const existing = await prisma.agentSuggestion.findFirst({
        where: { receivedInvoiceId: inv.id, type: 'PGC_ACCOUNT', status: 'PENDING' },
      });
      if (existing) { skipped++; continue; }

      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: inv.id,
          type: 'PGC_ACCOUNT',
          status: 'PENDING',
          title: `Reclassificar ${inv.account.code} → ${acc.code} ${acc.name}`,
          description: `Aplicat des de mapatge de proveïdor: el default del proveïdor s'ha fixat a ${acc.code} ${acc.name}.`,
          suggestedValue: {
            accountId: acc.id,
            accountCode: acc.code,
            accountName: acc.name,
            previousAccountId: inv.accountId,
            previousAccountCode: inv.account.code,
          },
          confidence: 1.0,
          reasoning: `Proveïdor configurat amb default ${acc.code} ${acc.name}. Factura actualment a ${inv.account.code}.`,
        },
      });
      created++;
    }

    res.json({ created, skipped, total: invoices.length });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/supplier-mapping/auto-fill
 * Per cada proveïdor SENSE default que tingui historial d'ús, fixar el
 * defaultExpenseAccountId al compte més usat. Pensat per executar una sola
 * vegada per inicialitzar.
 */
router.post('/auto-fill', authorize('ADMIN'), async (req, res, next) => {
  try {
    const usageRaw = await prisma.$queryRawUnsafe(`
      SELECT
        ri."supplierId",
        ri."accountId",
        COUNT(*)::int AS count
      FROM received_invoices ri
      WHERE ri."deletedAt" IS NULL
        AND ri."journalEntryId" IS NOT NULL
        AND ri."supplierId" IS NOT NULL
        AND ri."accountId" IS NOT NULL
      GROUP BY ri."supplierId", ri."accountId"
    `);

    // Most-used per supplier
    const topBySupplier = {};
    for (const r of usageRaw) {
      const cur = topBySupplier[r.supplierId];
      if (!cur || r.count > cur.count) topBySupplier[r.supplierId] = { accountId: r.accountId, count: r.count };
    }

    const supplierIds = Object.keys(topBySupplier);
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds }, defaultExpenseAccountId: null },
      select: { id: true },
    });

    let updated = 0;
    for (const s of suppliers) {
      await prisma.supplier.update({
        where: { id: s.id },
        data: { defaultExpenseAccountId: topBySupplier[s.id].accountId },
      });
      updated++;
    }

    res.json({ updated, totalCandidates: suppliers.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
