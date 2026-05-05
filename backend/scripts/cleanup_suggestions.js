#!/usr/bin/env node
/**
 * Neteja massiva de suggeriments PENDING:
 *
 *  1. Marca EXPIRED suggeriments de factures fora del scope (per defecte: anys
 *     anteriors a `--keep-from-year=2026`). Opció B: només treballem amb 2026.
 *
 *  2. Deduplica suggeriments repetits — quan el mateix (receivedInvoiceId,
 *     type, title) té múltiples PENDING, deixa només el més recent.
 *
 * Flags:
 *   --dry-run          Mostra què faria, no escriu res
 *   --keep-from-year=YYYY  Any des del qual conservem (default 2026)
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? true; return acc;
}, {});
const DRY_RUN = !!args['dry-run'];
const KEEP_FROM = args['keep-from-year'] ? parseInt(args['keep-from-year'], 10) : 2026;

(async () => {
  console.log(`\n=== Cleanup suggestions ${DRY_RUN ? '(DRY-RUN)' : ''} ===`);
  console.log(`Conservar des de l'any: ${KEEP_FROM}\n`);

  // ---- 1) Expirar suggeriments de factures fora de scope ----
  const cutoff = new Date(`${KEEP_FROM}-01-01T00:00:00Z`);
  const outOfScope = await prisma.agentSuggestion.findMany({
    where: {
      status: 'PENDING',
      receivedInvoice: { issueDate: { lt: cutoff } },
    },
    select: { id: true },
  });
  console.log(`[1] Suggeriments fora de scope (factures < ${KEEP_FROM}): ${outOfScope.length}`);
  if (!DRY_RUN && outOfScope.length > 0) {
    await prisma.agentSuggestion.updateMany({
      where: { id: { in: outOfScope.map((s) => s.id) } },
      data: { status: 'EXPIRED', resolvedBy: 'cleanup-script', resolvedAt: new Date() },
    });
    console.log('     → marcats com EXPIRED');
  }

  // ---- 2) Deduplicar (mateix receivedInvoiceId + type + title) ----
  const allInScope = await prisma.agentSuggestion.findMany({
    where: { status: 'PENDING' },
    select: { id: true, receivedInvoiceId: true, type: true, title: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const seen = new Set();
  const toExpire = [];
  for (const s of allInScope) {
    const key = `${s.receivedInvoiceId}|${s.type}|${s.title}`;
    if (seen.has(key)) toExpire.push(s.id);
    else seen.add(key);
  }
  console.log(`[2] Suggeriments duplicats (mateix invoice+type+title): ${toExpire.length}`);
  if (!DRY_RUN && toExpire.length > 0) {
    await prisma.agentSuggestion.updateMany({
      where: { id: { in: toExpire } },
      data: { status: 'EXPIRED', resolvedBy: 'cleanup-script-dedup', resolvedAt: new Date() },
    });
    console.log('     → duplicats marcats com EXPIRED (conservat el més recent)');
  }

  // ---- Resum final ----
  const remaining = await prisma.agentSuggestion.groupBy({
    by: ['type'],
    where: { status: 'PENDING' },
    _count: true,
  });
  console.log(`\n=== PENDING restants per tipus ===`);
  let total = 0;
  for (const r of remaining) {
    console.log(`  ${r.type.padEnd(20)} ${r._count}`);
    total += r._count;
  }
  console.log(`  TOTAL: ${total}`);

  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
