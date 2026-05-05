#!/usr/bin/env node
/**
 * Re-classifica factures actualment assignades al compte 629000 (Altres serveis)
 * usant l'agent IA amb les regles actives.
 *
 * Per defecte crea AgentSuggestion PENDING (l'usuari les revisa al supervisor i
 * decideix si aplicar). Amb --apply executa el canvi directament:
 *   1. Crida classifyInvoice (Qwen3 local, amb regles injectades al prompt)
 *   2. Si retorna un compte diferent de 629 (i diferent del que té), reverse
 *      l'assentament actual i re-comptabilitza amb el nou compte
 *   3. Si segueix retornant 629, deixa la factura igual
 *
 * Flags:
 *   --dry-run    No escriu res, només mostra suggeriments
 *   --apply      Aplicar canvis directament (sense passar per suggeriments)
 *   --limit=N    Limita a N factures (per provar)
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');
const accountingAgent = require('../src/services/accountingAgentService');
const invoicePostingService = require('../src/services/invoicePostingService');

const args = process.argv.slice(2).reduce((acc, a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  acc[k] = v ?? true; return acc;
}, {});
const DRY_RUN = !!args['dry-run'];
const APPLY = !!args['apply'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;

async function main() {
  const mode = DRY_RUN ? '(DRY-RUN)' : APPLY ? '(APPLY)' : '(SUGGESTION)';
  console.log(`\n=== Re-classificació de factures a 629 ${mode} ===\n`);

  const sysUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!sysUser) { console.error('Cap admin'); process.exit(1); }

  const acc629 = await prisma.chartOfAccount.findFirst({ where: { code: '629000' } });
  if (!acc629) { console.error('Falta compte 629000'); process.exit(1); }

  const candidates = await prisma.receivedInvoice.findMany({
    where: { accountId: acc629.id, journalEntryId: { not: null }, deletedAt: null },
    include: { supplier: { select: { name: true, nif: true } } },
    orderBy: { issueDate: 'asc' },
    ...(LIMIT && { take: LIMIT }),
  });
  console.log(`Candidats: ${candidates.length}\n`);

  const stats = { kept: 0, suggested: 0, reclassified: 0, skipped: 0, fail: 0, byNewCode: {} };

  for (const inv of candidates) {
    const label = `${(inv.supplier?.name || '?').slice(0, 30).padEnd(30)} ${inv.invoiceNumber.padEnd(20)} ${Number(inv.totalAmount).toFixed(2).padStart(8)}€`;
    try {
      const result = await accountingAgent.classifyInvoice(inv.id);
      if (!result?.pgcAccount) { stats.kept++; process.stdout.write('.'); continue; }

      // Resol el subcompte 6 dígits
      const codes = [result.pgcAccount, String(result.pgcAccount).trim() + '000'];
      let newAcc = null;
      for (const c of codes) {
        const found = await prisma.chartOfAccount.findFirst({ where: { code: c, isLeaf: true } });
        if (found) { newAcc = found; break; }
      }
      if (!newAcc) {
        stats.kept++;
        process.stdout.write('.');
        continue;
      }

      if (newAcc.id === acc629.id) {
        stats.kept++;
        process.stdout.write('.');
        continue;
      }

      stats.byNewCode[newAcc.code] = (stats.byNewCode[newAcc.code] || 0) + 1;

      if (DRY_RUN) {
        console.log(`\n  ${label} → ${newAcc.code} ${newAcc.name} (conf ${result.confidence})`);
        stats.suggested++;
        continue;
      }

      if (!APPLY) {
        // Mode suggeriment: comprovar si ja existeix un suggeriment PENDING
        // del mateix tipus per evitar duplicats si s'executa el script múltiples vegades
        const existing = await prisma.agentSuggestion.findFirst({
          where: { receivedInvoiceId: inv.id, type: 'PGC_ACCOUNT', status: 'PENDING' },
        });
        if (existing) {
          stats.skipped++;
          process.stdout.write('=');
          continue;
        }
        await prisma.agentSuggestion.create({
          data: {
            receivedInvoiceId: inv.id,
            type: 'PGC_ACCOUNT',
            status: 'PENDING',
            title: `Reclassificar ${acc629.code} → ${newAcc.code} ${newAcc.name}`,
            description: `Actualment a ${acc629.code} ${acc629.name}. L'agent proposa ${newAcc.code} ${newAcc.name} basant-se en proveïdor i descripció. Confiança: ${(result.confidence * 100).toFixed(0)}%.`,
            suggestedValue: {
              accountId: newAcc.id,
              accountCode: newAcc.code,
              accountName: newAcc.name,
              accountingType: result.accountingType,
              pgcAccount: result.pgcAccount,
              pgcAccountName: newAcc.name,
              previousAccountId: acc629.id,
              previousAccountCode: acc629.code,
            },
            confidence: result.confidence,
            reasoning: result.reasoning,
          },
        });
        stats.suggested++;
        process.stdout.write('s');
        continue;
      }

      // Mode --apply: re-comptabilitzar directament
      await invoicePostingService.unpostInvoice('RECEIVED', inv.id, { userId: sysUser.id, reason: 'Re-classificació amb regles noves' });
      await prisma.receivedInvoice.update({
        where: { id: inv.id },
        data: { accountId: newAcc.id, pgcAccount: result.pgcAccount, pgcAccountName: newAcc.name, accountingType: result.accountingType, classifiedBy: 'AGENT_AUTO', classifiedAt: new Date() },
      });
      await invoicePostingService.postReceivedInvoice(inv.id, { userId: sysUser.id });
      stats.reclassified++;
      process.stdout.write('+');
    } catch (err) {
      stats.fail++;
      process.stdout.write('x');
    }
  }
  process.stdout.write('\n\n');

  if (APPLY) {
    console.log(`Resum: ${stats.kept} mantingudes, ${stats.reclassified} reclassificades, ${stats.fail} errors`);
  } else {
    console.log(`Resum: ${stats.kept} mantingudes, ${stats.suggested} suggeriments creats, ${stats.skipped} ja tenien suggeriment, ${stats.fail} errors`);
  }
  if (Object.keys(stats.byNewCode).length) {
    console.log(`\nNous comptes proposats:`);
    Object.entries(stats.byNewCode).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }
  console.log('');
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); }).finally(() => prisma.$disconnect());
