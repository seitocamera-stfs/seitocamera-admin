/**
 * Company Context — knowledge endpoint per als agents IA (comptables i marketing).
 *
 * Tots els agents (CEO IA, Gestor IA, Investigator, Strategist...) consulten aquí
 * per obtenir context unificat de l'empresa, sense duplicar dades a cada lloc.
 *
 * Returns:
 *   {
 *     company:    { name, legal_name, nif, website, location, language, currency }
 *     business:   marketingContext de la Company (vertical, target_customers,
 *                 unique_strengths, known_competitors, excluded_segments, goals,
 *                 brand_voice)
 *     financial:  KPIs derivats (revenue any en curs, expenses, margin, cash, etc.)
 *     top_clients:    top 10 clients per facturació any en curs
 *     top_suppliers:  top 10 proveïdors per despesa any en curs
 *     equipment_summary: nº equips per categoria
 *     generated_at: ISO timestamp
 *   }
 */
const express = require('express');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

/**
 * Service-key bypass: agents interns (com el marketing Python) poden cridar
 * l'endpoint enviant `X-Service-Key` que coincideixi amb env `SERVICE_API_KEY`.
 * Si no, cau al middleware d'autenticació JWT normal (UI humana).
 *
 * `ADMIN_SERVICE_KEY` s'accepta com a alias per compat amb .env antics del
 * marketing (s'avisa una vegada al log).
 */
let _warnedAlias = false;
function _expectedServiceKey() {
  const primary = process.env.SERVICE_API_KEY;
  if (primary) return primary;
  const alias = process.env.ADMIN_SERVICE_KEY;
  if (alias && !_warnedAlias) {
    logger.warn('ADMIN_SERVICE_KEY està obsolet — renomena a SERVICE_API_KEY al .env del backend.');
    _warnedAlias = true;
  }
  return alias || null;
}

function authOrServiceKey(req, res, next) {
  const provided = req.headers['x-service-key'];
  const expected = _expectedServiceKey();
  if (provided && expected && provided === expected) {
    req.user = { id: 'service', role: 'SERVICE', name: 'internal-service' };
    return next();
  }
  return authenticate(req, res, () => requireSection('accounting')(req, res, next));
}

router.use(authOrServiceKey);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const yearStart = (y) => new Date(Date.UTC(y, 0, 1));
const yearEnd = (y) => new Date(Date.UTC(y, 11, 31, 23, 59, 59));

router.get('/', async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) return res.status(404).json({ error: 'Cap empresa configurada' });

    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const from = yearStart(year);
    const to = yearEnd(year);

    // ---- Financials de l'any ----
    const [issued, expensesRows, cashRows] = await Promise.all([
      prisma.issuedInvoice.aggregate({
        where: { issueDate: { gte: from, lte: to }, journalEntryId: { not: null } },
        _sum: { totalAmount: true, subtotal: true },
        _count: true,
      }),
      prisma.$queryRawUnsafe(
        `SELECT SUM(jl.debit - jl.credit)::float AS total
         FROM journal_lines jl
         JOIN journal_entries je ON jl."journalEntryId" = je.id
         JOIN chart_of_accounts a ON jl."accountId" = a.id
         WHERE je."companyId" = $1 AND je.status = 'POSTED'
           AND je.date >= $2 AND je.date <= $3
           AND a.code LIKE '6%' AND a.code NOT LIKE '630%'`,
        company.id, from, to,
      ),
      prisma.$queryRawUnsafe(
        `SELECT SUM(jl.debit - jl.credit)::float AS total
         FROM journal_lines jl
         JOIN journal_entries je ON jl."journalEntryId" = je.id
         JOIN chart_of_accounts a ON jl."accountId" = a.id
         WHERE je."companyId" = $1 AND je.status = 'POSTED' AND a.code LIKE '572%'`,
        company.id,
      ),
    ]);

    const revenue = round2(issued._sum.subtotal || 0);
    const expenses = round2(expensesRows[0]?.total || 0);
    const cash = round2(cashRows[0]?.total || 0);
    const margin = round2(revenue - expenses);
    const marginPct = revenue > 0 ? round2((margin / revenue) * 100) : null;

    // ---- Top clients de l'any ----
    const topClients = await prisma.$queryRawUnsafe(
      `SELECT c.name AS name, c.nif AS nif,
              COUNT(*)::int AS invoice_count,
              SUM(i."totalAmount")::float AS total_eur
       FROM issued_invoices i
       JOIN clients c ON c.id = i."clientId"
       WHERE i."issueDate" >= $1 AND i."issueDate" <= $2 AND i."clientId" IS NOT NULL
       GROUP BY c.id, c.name, c.nif
       ORDER BY SUM(i."totalAmount") DESC NULLS LAST
       LIMIT 10`,
      from, to,
    );

    // ---- Top suppliers de l'any ----
    const topSuppliers = await prisma.$queryRawUnsafe(
      `SELECT s.name AS name, s.nif AS nif,
              COUNT(*)::int AS invoice_count,
              SUM(r."totalAmount")::float AS total_eur
       FROM received_invoices r
       JOIN suppliers s ON s.id = r."supplierId"
       WHERE r."issueDate" >= $1 AND r."issueDate" <= $2
         AND r."supplierId" IS NOT NULL
         AND r."deletedAt" IS NULL
         AND r.origin <> 'LOGISTIK'
       GROUP BY s.id, s.name, s.nif
       ORDER BY SUM(r."totalAmount") DESC NULLS LAST
       LIMIT 10`,
      from, to,
    );

    // ---- Equipment summary (per categoria) ----
    const equipmentByCategory = await prisma.equipment.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { _count: { category: 'desc' } },
    });
    const equipmentSummary = equipmentByCategory.map((e) => ({
      category: e.category || 'sense categoria',
      count: e._count,
    }));

    res.json({
      company: {
        name: company.commercialName || company.legalName,
        legal_name: company.legalName,
        nif: company.nif,
        website: company.website,
        location: [company.city, company.province, company.country].filter(Boolean).join(', '),
        currency: company.defaultCurrency,
      },
      business: company.marketingContext || {},
      financial: {
        year,
        revenue_eur: revenue,
        expenses_eur: expenses,
        gross_margin_eur: margin,
        gross_margin_pct: marginPct,
        cash_balance_eur: cash,
        invoice_count: issued._count,
      },
      top_clients: topClients,
      top_suppliers: topSuppliers,
      equipment_summary: equipmentSummary,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/company-context/business
 * Body: marketingContext (parcial; merge superficial sobre la JSON existent)
 */
router.patch('/business', async (req, res, next) => {
  try {
    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) return res.status(404).json({ error: 'Cap empresa' });
    const merged = { ...(company.marketingContext || {}), ...(req.body || {}) };
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { marketingContext: merged },
      select: { marketingContext: true },
    });
    res.json(updated.marketingContext);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
