/**
 * Llibre Major i Sumes i Saldos.
 *
 * Tots dos s'agreguen sobre journal_lines de assentaments POSTED.
 * Els REVERSED no compten (ja s'han neutralitzat amb el seu correu d'inversió).
 */
const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSection } = require('../middleware/sectionAccess');

const router = express.Router();

router.use(authenticate);
router.use(requireSection('accounting'));

/**
 * GET /api/ledger?accountId=...&companyId=...&from=&to=
 * Retorna tots els apunts d'un compte amb saldo acumulat.
 */
router.get('/', async (req, res, next) => {
  try {
    const { accountId, companyId, from, to, fiscalYearId } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId requerit' });

    const where = {
      accountId,
      journalEntry: {
        status: 'POSTED',
        ...(companyId && { companyId }),
        ...(fiscalYearId && { fiscalYearId }),
        ...((from || to) && {
          date: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }),
      },
    };

    const lines = await prisma.journalLine.findMany({
      where,
      include: {
        journalEntry: {
          select: { id: true, date: true, entryNumber: true, description: true, type: true },
        },
        account: { select: { code: true, name: true, type: true } },
      },
      orderBy: [
        { journalEntry: { date: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
        { sortOrder: 'asc' },
      ],
    });

    // Calcula saldo acumulat
    let balance = 0;
    const items = lines.map((l) => {
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      // Saldo = SUM(debit) - SUM(credit). Comptes d'actiu/despesa naturalment deutors;
      // passiu/PN/ingrés naturalment creditors. La columna de saldo deutor/creditor es decideix a la UI.
      balance += debit - credit;
      return {
        id: l.id,
        date: l.journalEntry.date,
        entryNumber: l.journalEntry.entryNumber,
        entryId: l.journalEntry.id,
        entryDescription: l.journalEntry.description,
        entryType: l.journalEntry.type,
        lineDescription: l.description,
        debit,
        credit,
        balance: Math.round(balance * 100) / 100,
      };
    });

    const account = lines[0]?.account || await prisma.chartOfAccount.findUnique({
      where: { id: accountId }, select: { code: true, name: true, type: true },
    });

    res.json({
      account,
      items,
      totals: {
        debit: items.reduce((a, l) => a + l.debit, 0),
        credit: items.reduce((a, l) => a + l.credit, 0),
        balance: items.length ? items[items.length - 1].balance : 0,
      },
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/ledger/trial-balance?companyId=...&fiscalYearId=...&to=...
 * Sumes i saldos per a tots els comptes a una data tall.
 */
router.get('/trial-balance', async (req, res, next) => {
  try {
    const { companyId, fiscalYearId, from, to } = req.query;
    if (!companyId) return res.status(400).json({ error: 'companyId requerit' });

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to)   dateFilter.lte = new Date(to);

    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          companyId,
          status: 'POSTED',
          ...(fiscalYearId && { fiscalYearId }),
          ...(Object.keys(dateFilter).length && { date: dateFilter }),
        },
      },
      include: { account: { select: { id: true, code: true, name: true, type: true, isLeaf: true } } },
    });

    // Agrupar per accountId
    const byAccount = new Map();
    for (const l of lines) {
      const key = l.account.id;
      if (!byAccount.has(key)) {
        byAccount.set(key, {
          accountId: l.account.id,
          code: l.account.code,
          name: l.account.name,
          type: l.account.type,
          isLeaf: l.account.isLeaf,
          debit: 0,
          credit: 0,
        });
      }
      const row = byAccount.get(key);
      row.debit += Number(l.debit);
      row.credit += Number(l.credit);
    }

    const items = Array.from(byAccount.values())
      .map((r) => ({
        ...r,
        debit: Math.round(r.debit * 100) / 100,
        credit: Math.round(r.credit * 100) / 100,
        balance: Math.round((r.debit - r.credit) * 100) / 100,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const totals = items.reduce(
      (acc, r) => ({
        debit: acc.debit + r.debit,
        credit: acc.credit + r.credit,
      }),
      { debit: 0, credit: 0 },
    );

    res.json({
      items,
      totals: {
        debit: Math.round(totals.debit * 100) / 100,
        credit: Math.round(totals.credit * 100) / 100,
        balanced: Math.abs(totals.debit - totals.credit) < 0.01,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
