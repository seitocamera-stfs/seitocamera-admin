#!/usr/bin/env node
/**
 * Accepta tots els AgentSuggestion PENDING amb confiança ≥ MIN.
 *
 * Usat per resoldre el bottleneck de revisar suggeriments un per un quan
 * sabem que els d'alta confiança són majoritàriament correctes.
 *
 * Use --dry-run per veure què passaria sense aplicar.
 * Use --min=0.X per canviar el llindar (default 0.85).
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const agent = require('../src/services/accountingAgentService');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? true; return acc;
}, {});
const DRY_RUN = !!args['dry-run'];
const MIN_CONF = args.min ? parseFloat(args.min) : 0.85;
// Només els tipus que apliquen canvis automàtics tenen sentit acceptar en
// massa. Els altres (ANOMALY, MISSING_DATA, DUPLICATE, TAX_WARNING,
// CONCILIATION_MATCH) són alertes per revisar manualment.
const ACCEPTABLE_TYPES = ['CLASSIFICATION', 'PGC_ACCOUNT'];

(async () => {
  console.log(`\n=== Accept-all suggestions ${DRY_RUN ? '(DRY-RUN)' : ''} ===`);
  console.log(`Llindar confiança: ≥ ${MIN_CONF}\n`);

  const pending = await prisma.agentSuggestion.findMany({
    where: {
      status: 'PENDING',
      confidence: { gte: MIN_CONF },
      type: { in: ACCEPTABLE_TYPES },
    },
    select: { id: true, type: true, title: true, confidence: true, receivedInvoiceId: true },
    orderBy: { confidence: 'desc' },
  });

  console.log(`Suggeriments candidats: ${pending.length}\n`);
  if (pending.length === 0) { console.log('Cap suggeriment d\'alta confiança a acceptar.'); process.exit(0); }

  if (DRY_RUN) {
    console.log('Sample primers 10:');
    pending.slice(0, 10).forEach((s, i) => console.log(`  ${i+1}. [${s.confidence.toFixed(2)}] ${s.type} · ${s.title.slice(0, 80)}`));
    console.log(`\n[DRY-RUN] No s'ha aplicat res. Re-llança sense --dry-run per executar.`);
    process.exit(0);
  }

  let applied = 0, failed = 0, reclassified = 0;
  for (const s of pending) {
    try {
      const result = await agent.applySuggestion(s.id);
      applied++;
      if (result?.reclassified) reclassified++;
      if (applied % 50 === 0) console.log(`  ${applied}/${pending.length} aplicats...`);
    } catch (err) {
      failed++;
      // No log per cada un — n'hi haurà molts d'enmig (suggerències sobre la mateixa factura, ja resolta, etc.)
    }
  }

  console.log(`\n=== Resum ===`);
  console.log(`  Aplicats: ${applied}`);
  console.log(`  Re-comptabilitzats (factures que ja tenien JE): ${reclassified}`);
  console.log(`  Fallits: ${failed}`);
  const remaining = await prisma.agentSuggestion.count({ where: { status: 'PENDING' } });
  console.log(`  Restants PENDING (qualsevol confiança): ${remaining}`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
