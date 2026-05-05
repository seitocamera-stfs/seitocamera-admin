#!/usr/bin/env node
/**
 * Classifica factures rebudes de 2026 sense compte assignat.
 *
 * Estratègia per ordre de cost:
 *   1. Si supplier.defaultExpenseAccountId existeix → assignar directament (gratis)
 *   2. Sinó → cridar accountingAgentService.classifyInvoice (LLM local Ollama)
 *
 * Resultats: actualitza la factura amb accountId + crea suggerència PENDING
 * per traçabilitat (al supervisor IA).
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const agent = require('../src/services/accountingAgentService');

(async () => {
  const yearStart = new Date('2026-01-01T00:00:00Z');
  const yearEnd = new Date('2026-12-31T23:59:59Z');

  const pending = await prisma.receivedInvoice.findMany({
    where: {
      deletedAt: null,
      accountId: null,
      issueDate: { gte: yearStart, lte: yearEnd },
      origin: { not: 'LOGISTIK' },
    },
    include: {
      supplier: { select: { id: true, name: true, defaultExpenseAccountId: true } },
    },
    orderBy: { issueDate: 'asc' },
  });

  console.log(`Pendents de classificar: ${pending.length}\n`);

  const stats = { fromDefault: 0, fromLLM: 0, failed: 0, byAccount: {} };
  let i = 0;
  for (const inv of pending) {
    i++;
    const label = `${i}/${pending.length} · ${(inv.supplier?.name || '?').slice(0, 30).padEnd(30)} ${inv.invoiceNumber.padEnd(20)}`;

    try {
      // 1. Intent default del proveïdor
      if (inv.supplier?.defaultExpenseAccountId) {
        const acc = await prisma.chartOfAccount.findUnique({
          where: { id: inv.supplier.defaultExpenseAccountId },
          select: { id: true, code: true, name: true },
        });
        await prisma.receivedInvoice.update({
          where: { id: inv.id },
          data: {
            accountId: acc.id,
            pgcAccount: acc.code,
            pgcAccountName: acc.name,
            classifiedBy: 'AGENT_AUTO',
            classifiedAt: new Date(),
          },
        });
        stats.fromDefault++;
        stats.byAccount[acc.code] = (stats.byAccount[acc.code] || 0) + 1;
        console.log(`  ${label} → ${acc.code} (default proveïdor)`);
        continue;
      }

      // 2. LLM
      const result = await agent.classifyForAccount(inv.id);
      if (!result?.accountId) {
        stats.failed++;
        console.log(`  ${label} ✗ no es pot resoldre`);
        continue;
      }
      const acc = await prisma.chartOfAccount.findUnique({
        where: { id: result.accountId },
        select: { code: true, name: true },
      });
      stats.fromLLM++;
      stats.byAccount[acc.code] = (stats.byAccount[acc.code] || 0) + 1;
      console.log(`  ${label} → ${acc.code} (LLM)`);
    } catch (err) {
      stats.failed++;
      console.log(`  ${label} ✗ ${err.message.substring(0, 80)}`);
    }
  }

  console.log(`\n=== Resum ===`);
  console.log(`  Resoltes per default proveïdor: ${stats.fromDefault}`);
  console.log(`  Resoltes per LLM: ${stats.fromLLM}`);
  console.log(`  Fallides: ${stats.failed}`);
  console.log(`\n=== Distribució per compte ===`);
  Object.entries(stats.byAccount).sort((a, b) => b[1] - a[1]).forEach(([code, n]) => {
    console.log(`  ${code}: ${n}`);
  });

  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
