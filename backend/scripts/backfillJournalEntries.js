#!/usr/bin/env node
/**
 * Backfill — genera assentaments retroactius del Llibre Diari per a totes les
 * factures rebudes i emeses històriques que encara no n'han.
 *
 * IMPORTANT: aquest script només cal executar-lo UN COP, després de portar les
 * dades de producció a local (o directament a producció després del Sprint 3).
 *
 * Comportament:
 *   - Itera totes les ReceivedInvoice/IssuedInvoice amb status REVIEWED, APPROVED,
 *     PAID o PARTIALLY_PAID, sense `journalEntryId`, no eliminades, i (per
 *     received) amb `origin != 'LOGISTIK'`.
 *   - Per cada una crida invoicePostingService.postReceivedInvoice / postIssuedInvoice.
 *   - Si la factura no té `accountId` resolt i tampoc `pgcAccount` text mapejable,
 *     l'agent IA s'invoca per classificar-la (això pot trigar — agent està
 *     ratejat per minut).
 *   - Resum per pantalla amb OK/errors i amb suggeriments creats per agent.
 *
 * Flags:
 *   --dry-run             No fa res, només llista què faria.
 *   --skip-agent          Salta factures que requereixen l'agent.
 *   --year=YYYY           Limita a un any concret (per defecte: l'any en curs).
 *   --type=received|issued  Limita a un tipus.
 *   --limit=N             Limita a N factures (per provar abans).
 *
 * Executar:
 *   node scripts/backfillJournalEntries.js [flags]
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const invoicePostingService = require('../src/services/invoicePostingService');
const accountingAgent = require('../src/services/accountingAgentService');

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [k, v] = arg.replace(/^--/, '').split('=');
  acc[k] = v ?? true;
  return acc;
}, {});

const DRY_RUN = !!args['dry-run'];
const SKIP_AGENT = !!args['skip-agent'];
const YEAR = args.year ? parseInt(args.year, 10) : new Date().getFullYear();
const ONLY_TYPE = args.type;
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

async function main() {
  console.log('\n=== Backfill Llibre Diari ===');
  console.log(`Any: ${YEAR}${ONLY_TYPE ? ` · Tipus: ${ONLY_TYPE}` : ''}${DRY_RUN ? ' · DRY-RUN' : ''}${SKIP_AGENT ? ' · SKIP AGENT' : ''}${LIMIT ? ` · LIMIT=${LIMIT}` : ''}\n`);

  const yearStart = new Date(`${YEAR}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${YEAR}-12-31T23:59:59Z`);

  // Cercar admin user per "createdById" (els assentaments s'atribueixen a aquest)
  const sysUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!sysUser) {
    console.error('No hi ha cap usuari ADMIN per atribuir els assentaments.');
    process.exit(1);
  }
  const userId = sysUser.id;

  const stats = { received: { ok: 0, agent: 0, fail: 0 }, issued: { ok: 0, fail: 0 }, errors: [] };

  if (!ONLY_TYPE || ONLY_TYPE === 'received') {
    const where = {
      deletedAt: null,
      journalEntryId: null,
      origin: { not: 'LOGISTIK' },
      status: { in: ['REVIEWED', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] },
      issueDate: { gte: yearStart, lte: yearEnd },
    };
    const candidates = await prisma.receivedInvoice.findMany({
      where,
      orderBy: { issueDate: 'asc' },
      ...(LIMIT && { take: LIMIT }),
    });
    console.log(`ReceivedInvoice candidates: ${candidates.length}`);

    for (const inv of candidates) {
      const label = `${inv.invoiceNumber} (${inv.issueDate.toISOString().slice(0,10)})`;
      try {
        if (DRY_RUN) {
          console.log(`[dry-run] postReceivedInvoice ${label}`);
          continue;
        }
        const r = await invoicePostingService.postReceivedInvoice(inv.id, {
          userId,
          agent: SKIP_AGENT ? undefined : accountingAgent,
        });
        if (r.resolvedByAgent) stats.received.agent++;
        stats.received.ok++;
        process.stdout.write('.');
      } catch (err) {
        stats.received.fail++;
        stats.errors.push({ type: 'received', invoice: label, error: err.message });
        process.stdout.write('x');
      }
    }
    process.stdout.write('\n');
  }

  if (!ONLY_TYPE || ONLY_TYPE === 'issued') {
    const where = {
      journalEntryId: null,
      status: { in: ['PENDING', 'APPROVED', 'PAID', 'PARTIALLY_PAID'] },
      issueDate: { gte: yearStart, lte: yearEnd },
    };
    const candidates = await prisma.issuedInvoice.findMany({
      where,
      orderBy: { issueDate: 'asc' },
      ...(LIMIT && { take: LIMIT }),
    });
    console.log(`IssuedInvoice candidates: ${candidates.length}`);

    for (const inv of candidates) {
      const label = `${inv.invoiceNumber} (${inv.issueDate.toISOString().slice(0,10)})`;
      try {
        if (DRY_RUN) {
          console.log(`[dry-run] postIssuedInvoice ${label}`);
          continue;
        }
        await invoicePostingService.postIssuedInvoice(inv.id, { userId });
        stats.issued.ok++;
        process.stdout.write('.');
      } catch (err) {
        stats.issued.fail++;
        stats.errors.push({ type: 'issued', invoice: label, error: err.message });
        process.stdout.write('x');
      }
    }
    process.stdout.write('\n');
  }

  console.log('\n=== Resum ===');
  console.log(`ReceivedInvoice: ${stats.received.ok} OK (${stats.received.agent} via agent), ${stats.received.fail} errors`);
  console.log(`IssuedInvoice:   ${stats.issued.ok} OK, ${stats.issued.fail} errors`);
  if (stats.errors.length) {
    console.log(`\nDetall d'errors (primers 30):`);
    stats.errors.slice(0, 30).forEach((e) => console.log(`  [${e.type}] ${e.invoice}: ${e.error}`));
    if (stats.errors.length > 30) console.log(`  ... i ${stats.errors.length - 30} més`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
