#!/usr/bin/env node
/**
 * Backfill — genera assentaments retroactius per als BankMovements que ja
 * estan conciliats (CONFIRMED) però sense `journalEntryId`.
 *
 * Requereix que les factures vinculades estiguin POSTED prèviament (sino el
 * subcompte 410/430 del proveïdor/client no està definit). Executa primer
 * el backfillJournalEntries.js de factures.
 *
 * Flags:
 *   --dry-run             No escriu res, només mostra el que faria.
 *   --year=YYYY           Limita per any.
 *   --limit=N             Limita a N moviments.
 *
 * Executar: node scripts/backfillBankPostings.js [flags]
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const bankPostingService = require('../src/services/bankPostingService');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? true; return acc;
}, {});

const DRY_RUN = !!args['dry-run'];
const YEAR = args.year ? parseInt(args.year, 10) : new Date().getFullYear();
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

async function main() {
  console.log(`\n=== Backfill BankMovements → Llibre Diari ===`);
  console.log(`Any: ${YEAR}${DRY_RUN ? ' · DRY-RUN' : ''}${LIMIT ? ` · LIMIT=${LIMIT}` : ''}\n`);

  const sysUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!sysUser) { console.error('Cap usuari ADMIN'); process.exit(1); }

  const yearStart = new Date(`${YEAR}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${YEAR}-12-31T23:59:59Z`);

  const where = {
    journalEntryId: null,
    isDismissed: false,
    date: { gte: yearStart, lte: yearEnd },
    conciliations: { some: { status: 'CONFIRMED' } },
  };

  const candidates = await prisma.bankMovement.findMany({
    where, orderBy: { date: 'asc' }, ...(LIMIT && { take: LIMIT }),
  });
  console.log(`Candidats: ${candidates.length}`);

  const stats = { ok: 0, fail: 0, errors: [] };
  for (const m of candidates) {
    try {
      if (DRY_RUN) {
        console.log(`[dry-run] postBankMovement ${m.date.toISOString().slice(0,10)} ${m.description?.slice(0,50)}`);
        continue;
      }
      await bankPostingService.postBankMovement(m.id, sysUser.id);
      stats.ok++;
      process.stdout.write('.');
    } catch (err) {
      stats.fail++;
      stats.errors.push({ id: m.id, date: m.date.toISOString().slice(0,10), desc: m.description?.slice(0,80), error: err.message });
      process.stdout.write('x');
    }
  }
  process.stdout.write('\n\n');
  console.log(`Resum: ${stats.ok} OK, ${stats.fail} errors`);
  if (stats.errors.length) {
    console.log(`\nDetall d'errors (primers 30):`);
    stats.errors.slice(0, 30).forEach(e => console.log(`  ${e.date} | ${e.desc} | ${e.error}`));
    if (stats.errors.length > 30) console.log(`  ... i ${stats.errors.length - 30} més`);
  }
  console.log('');
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
