#!/usr/bin/env node
/**
 * Script d'auditoria de dates BD vs PDF real
 * S'executa directament dins el container backend (sense timeout nginx)
 *
 * Ús: docker compose exec -T backend node scripts/date-audit.js [--fix]
 *   --fix  → corregeix automàticament les dates a la BD
 */

const { prisma } = require('../src/config/database');
const gdrive = require('../src/services/gdriveService');
const pdfExtract = require('../src/services/pdfExtractService');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AUTO_FIX = process.argv.includes('--fix');

async function main() {
  console.log('=== AUDITORIA DATES BD vs PDF ===');
  console.log(`Mode: ${AUTO_FIX ? '🔧 CORRECCIÓ AUTOMÀTICA' : '🔍 NOMÉS LECTURA (dry run)'}`);
  console.log('');

  // Només factures NO processades amb Claude IA
  const invoices = await prisma.receivedInvoice.findMany({
    where: {
      gdriveFileId: { not: null },
      deletedAt: null,
      classifiedBy: null,
    },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      gdriveFileId: true,
      supplier: { select: { name: true } },
      totalAmount: true,
    },
    orderBy: { issueDate: 'asc' },
  });

  console.log(`📋 Total factures a auditar: ${invoices.length}`);
  console.log('');

  const results = { correct: 0, mismatched: [], errors: [], fixed: 0 };
  const tmpDir = os.tmpdir();
  const BATCH_SIZE = 5;

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const batch = invoices.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(invoices.length / BATCH_SIZE);

    process.stdout.write(`⏳ Lot ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, invoices.length)})...`);

    const batchResults = await Promise.allSettled(batch.map(async (inv) => {
      const tmpPath = path.join(tmpDir, `audit_${inv.id}.pdf`);
      try {
        await gdrive.downloadFile(inv.gdriveFileId, tmpPath);
      } catch (dlErr) {
        throw new Error(`No es pot descarregar: ${dlErr.message}`);
      }

      let text = '';
      try {
        text = await pdfExtract.extractText(tmpPath);
      } catch (e) {
        try { text = await pdfExtract.ocrPdf(tmpPath); } catch (e2) { /* ignorar */ }
      }

      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignorar */ }

      if (!text || text.trim().length < 10) {
        throw new Error('No s\'ha pogut extreure text del PDF');
      }

      const detectedDate = pdfExtract.detectInvoiceDate(text);
      if (!detectedDate) {
        throw new Error('No s\'ha pogut detectar la data al PDF');
      }

      const dbDate = new Date(inv.issueDate);
      const dbDateStr = dbDate.toISOString().split('T')[0];
      const pdfDateStr = detectedDate.toISOString().split('T')[0];

      return { inv, dbDateStr, pdfDateStr, match: dbDateStr === pdfDateStr };
    }));

    let batchOk = 0;
    let batchBad = 0;
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        if (r.value.match) {
          results.correct++;
          batchOk++;
        } else {
          results.mismatched.push(r.value);
          batchBad++;
        }
      } else {
        results.errors.push({
          invoiceNumber: batch[j].invoiceNumber,
          error: r.reason?.message || 'Error desconegut',
        });
      }
    }
    console.log(` ✅${batchOk} ❌${batchBad} ⚠️${batchResults.filter(r => r.status === 'rejected').length}`);
  }

  // Resum
  console.log('');
  console.log('=== RESULTAT ===');
  console.log(`✅ Correctes: ${results.correct}`);
  console.log(`❌ Dates incorrectes: ${results.mismatched.length}`);
  console.log(`⚠️  Errors lectura: ${results.errors.length}`);
  console.log('');

  // Mostrar discrepàncies
  if (results.mismatched.length > 0) {
    console.log('=== DATES INCORRECTES ===');
    console.log('Factura'.padEnd(20) + 'Proveïdor'.padEnd(35) + 'BD'.padEnd(14) + 'PDF real'.padEnd(14));
    console.log('-'.repeat(83));
    for (const m of results.mismatched) {
      const supplier = (m.inv.supplier?.name || '—').substring(0, 33);
      console.log(
        (m.inv.invoiceNumber || '—').padEnd(20) +
        supplier.padEnd(35) +
        m.dbDateStr.padEnd(14) +
        m.pdfDateStr.padEnd(14)
      );
    }
    console.log('');

    // Corregir si --fix
    if (AUTO_FIX) {
      console.log('🔧 Corregint dates a la BD...');
      for (const m of results.mismatched) {
        try {
          await prisma.receivedInvoice.update({
            where: { id: m.inv.id },
            data: { issueDate: new Date(m.pdfDateStr) },
          });
          results.fixed++;
          console.log(`  ✅ ${m.inv.invoiceNumber}: ${m.dbDateStr} → ${m.pdfDateStr}`);
        } catch (err) {
          console.log(`  ❌ ${m.inv.invoiceNumber}: ${err.message}`);
        }
      }
      console.log(`\n🎉 ${results.fixed}/${results.mismatched.length} dates corregides!`);
    } else {
      console.log('💡 Per corregir automàticament, executa amb --fix:');
      console.log('   docker compose exec -T backend node scripts/date-audit.js --fix');
    }
  }

  // Errors
  if (results.errors.length > 0) {
    console.log('\n=== ERRORS DE LECTURA ===');
    for (const e of results.errors) {
      console.log(`  ⚠️  ${e.invoiceNumber}: ${e.error}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
