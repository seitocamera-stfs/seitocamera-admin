#!/usr/bin/env node
/**
 * DETECCIÓ I CORRECCIÓ D'IMPORTS ERRONIS (x1000 / x10000)
 *
 * Problema: parseEuropeanNumber() tractava "1.234" (separador de milers europeu)
 * com 1.234 (decimal anglosaxó) → imports guardats 1000x massa petits.
 *
 * Aquest script:
 *   1. Carrega TOTES les factures amb gdriveFileId
 *   2. Descarrega el PDF de GDrive i re-extreu l'import amb la lògica corregida
 *   3. Compara amb l'import guardat a la BD
 *   4. Corregeix si hi ha discrepància significativa (factor ~1000)
 *
 * EXECUTAR:   node scripts/fix-invoice-amounts.js
 * MODE SEC:   node scripts/fix-invoice-amounts.js --dry-run
 * TOTES:      node scripts/fix-invoice-amounts.js --all  (revisa totes, no només les que tenen import)
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');
const { prisma } = require('../src/config/database');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_ALL = process.argv.includes('--all');

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  CORRECCIÓ D\'IMPORTS DE FACTURES REBUDES');
  console.log(`  Mode: ${DRY_RUN ? '🔍 SEC (només mostra canvis)' : '✏️  REAL (aplicarà canvis)'}`);
  console.log(`  Abast: ${FORCE_ALL ? 'TOTES les factures amb PDF' : 'Factures amb import > 0'}`);
  console.log('═══════════════════════════════════════════════\n');

  // Carregar totes les factures amb PDF a GDrive
  const whereClause = {
    gdriveFileId: { not: null },
  };
  if (!FORCE_ALL) {
    whereClause.totalAmount = { gt: 0 };
  }

  const allInvoices = await prisma.receivedInvoice.findMany({
    where: whereClause,
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      subtotal: true,
      taxRate: true,
      taxAmount: true,
      gdriveFileId: true,
      originalFileName: true,
      ocrRawData: true,
      supplier: { select: { name: true } },
    },
    orderBy: { issueDate: 'desc' },
  });

  console.log(`📋 Factures amb PDF: ${allInvoices.length}\n`);

  if (allInvoices.length === 0) {
    console.log('✅ No hi ha factures per revisar!');
    await prisma.$disconnect();
    return;
  }

  // Carregar serveis
  let gdrive, pdfExtract;
  try {
    gdrive = require('../src/services/gdriveService');
    pdfExtract = require('../src/services/pdfExtractService');
  } catch (err) {
    console.error('❌ Error carregant serveis:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  const tmpDir = path.join(os.tmpdir(), 'fix-amounts-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const issues = [];
  let checked = 0;
  let skipped = 0;
  let correct = 0;
  let errors = 0;

  for (const inv of allInvoices) {
    const label = `${inv.invoiceNumber} (${inv.supplier?.name || 'sense proveïdor'})`;
    process.stdout.write(`  📄 ${label}... `);

    const storedAmount = parseFloat(inv.totalAmount) || 0;

    try {
      // Descarregar PDF de GDrive
      const tmpPath = path.join(tmpDir, `${inv.id}.pdf`);
      await gdrive.downloadFile(inv.gdriveFileId, tmpPath);

      // Re-extreure amb la lògica corregida
      const analysis = await pdfExtract.analyzePdf(tmpPath);

      // Netejar fitxer temporal
      try { fs.unlinkSync(tmpPath); } catch {}

      checked++;

      if (!analysis.totalAmount) {
        console.log('⚪ No s\'ha pogut detectar import');
        skipped++;
        continue;
      }

      const reParsed = parseFloat(analysis.totalAmount);

      // Si l'import guardat és 0, simplement omplir-lo
      if (storedAmount === 0 && reParsed > 0) {
        issues.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplier: inv.supplier?.name || '?',
          storedAmount: 0,
          reParsed,
          factor: 'nou',
          taxRate: inv.taxRate || 21,
          ocrText: analysis.text?.substring(0, 5000) || null,
        });
        console.log(`🆕 Sense import → ${reParsed}€`);
        continue;
      }

      // Comprovar discrepància
      const ratio = reParsed / storedAmount;

      // Tolerance: si diferència < 5% considerem correcte (pot haver-hi petites variacions per arrodoniment)
      if (ratio > 0.95 && ratio < 1.05) {
        console.log(`✅ Correcte (${storedAmount}€)`);
        correct++;
        continue;
      }

      // Factors sospitosos: ~1000, ~10000, ~0.001, ~0.0001
      const isTooSmall = ratio > 500 && ratio < 1500;
      const isTooBig = ratio > 0.0005 && ratio < 0.0015;
      const isTooSmall10k = ratio > 5000 && ratio < 15000;
      const isTooBig10k = ratio > 0.00005 && ratio < 0.00015;

      // També detectar diferències significatives generals (>50%)
      const isSignificant = ratio < 0.5 || ratio > 2;

      if (isTooSmall || isTooBig || isTooSmall10k || isTooBig10k || isSignificant) {
        const factor = isTooSmall ? 'x1000 petit' :
          isTooBig ? 'x1000 gran' :
          isTooSmall10k ? 'x10000 petit' :
          isTooBig10k ? 'x10000 gran' :
          `ratio ${ratio.toFixed(2)}`;

        issues.push({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplier: inv.supplier?.name || '?',
          storedAmount,
          reParsed,
          factor,
          taxRate: inv.taxRate || 21,
          ocrText: analysis.text?.substring(0, 5000) || null,
        });

        console.log(`⚠️  BD: ${storedAmount}€ → PDF: ${reParsed}€ (${factor})`);
      } else {
        console.log(`✅ Correcte (${storedAmount}€, ratio: ${ratio.toFixed(2)})`);
        correct++;
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      errors++;
    }
  }

  // Netejar directori temporal
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log('\n═══════════════════════════════════════════════');
  console.log('  RESUM ANÀLISI:');
  console.log(`  📊 Revisades:      ${checked}`);
  console.log(`  ✅ Correctes:      ${correct}`);
  console.log(`  ⚠️  Discrepàncies:  ${issues.length}`);
  console.log(`  ⚪ Sense import:   ${skipped}`);
  console.log(`  ❌ Errors:         ${errors}`);
  console.log('═══════════════════════════════════════════════\n');

  if (issues.length === 0) {
    console.log('✅ No s\'han trobat imports erronis. Tot correcte!');
    await prisma.$disconnect();
    return;
  }

  // Mostrar resum
  console.log('📋 Factures amb discrepància:\n');
  for (const issue of issues) {
    console.log(`  ${issue.invoiceNumber} (${issue.supplier}): ${issue.storedAmount}€ → ${issue.reParsed}€ [${issue.factor}]`);
  }

  if (DRY_RUN) {
    console.log(`\n🔍 MODE SEC — No s'ha modificat res.`);
    console.log(`Per aplicar: node scripts/fix-invoice-amounts.js`);
    await prisma.$disconnect();
    return;
  }

  // Aplicar correccions
  console.log('\n✏️  Aplicant correccions...\n');
  let fixed = 0;
  for (const issue of issues) {
    const totalAmount = Math.round(issue.reParsed * 100) / 100;
    const taxRate = issue.taxRate;
    const subtotal = Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100;
    const taxAmount = Math.round((totalAmount - subtotal) * 100) / 100;

    try {
      // Preparar ocrRawData actualitzat
      const current = await prisma.receivedInvoice.findUnique({
        where: { id: issue.id },
        select: { ocrRawData: true, description: true },
      });

      const ocrRawData = current?.ocrRawData || {};
      ocrRawData.totalAmount = issue.reParsed;
      ocrRawData.amountCorrected = true;
      ocrRawData.previousAmount = issue.storedAmount;
      // Si no tenia text OCR, guardar-lo ara
      if (!ocrRawData.text && issue.ocrText) {
        ocrRawData.text = issue.ocrText;
      }

      // Nota a la descripció
      const note = ` [Import corregit: ${issue.storedAmount}€ → ${totalAmount}€]`;
      const newDescription = (current?.description || '') + note;

      await prisma.receivedInvoice.update({
        where: { id: issue.id },
        data: {
          totalAmount,
          subtotal,
          taxAmount,
          ocrRawData,
          description: newDescription,
        },
      });

      console.log(`  ✅ ${issue.invoiceNumber}: ${issue.storedAmount}€ → ${totalAmount}€ (base: ${subtotal}€, IVA: ${taxAmount}€)`);
      fixed++;
    } catch (err) {
      console.error(`  ❌ Error corregint ${issue.invoiceNumber}: ${err.message}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Corregides: ${fixed}/${issues.length}`);
  console.log(`═══════════════════════════════════════════════`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  prisma.$disconnect();
  process.exit(1);
});
