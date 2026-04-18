#!/usr/bin/env node
/**
 * CORRECCIÓ DE DATES DE FACTURES REBUDES
 *
 * Revisa les factures que probablement tenen una data incorrecta
 * (data de pujada a GDrive en lloc de la data real de la factura) i
 * re-extreu la data del PDF amb la lògica millorada.
 *
 * Criteris per considerar una data sospitosa:
 *   1. Factures amb font GDRIVE_SYNC o EMAIL_WITH_PDF
 *   2. Que tinguin un gdriveFileId (PDF accessible)
 *   3. On la data no va ser extreta del PDF (ocrRawData.invoiceDate === null)
 *      O on ocrRawData no existeix (factures antigues sense OCR)
 *
 * EXECUTAR: node scripts/fix-invoice-dates.js
 * MODE SEC:  node scripts/fix-invoice-dates.js --dry-run
 * FORÇAR TOTES: node scripts/fix-invoice-dates.js --all (re-extreu totes, no només les sospitoses)
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
  console.log('  CORRECCIÓ DE DATES DE FACTURES REBUDES');
  console.log(`  Mode: ${DRY_RUN ? '🔍 SEC (només mostra canvis)' : '✏️  REAL (aplicarà canvis)'}`);
  console.log(`  Abast: ${FORCE_ALL ? 'TOTES les factures amb PDF' : 'Només dates sospitoses'}`);
  console.log('═══════════════════════════════════════════════\n');

  // Buscar totes les factures amb PDF a GDrive
  const allInvoices = await prisma.receivedInvoice.findMany({
    where: {
      gdriveFileId: { not: null },
    },
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      gdriveFileId: true,
      originalFileName: true,
      ocrRawData: true,
      source: true,
      createdAt: true,
      supplier: { select: { name: true } },
    },
    orderBy: { issueDate: 'desc' },
  });

  console.log(`📋 Total factures amb PDF: ${allInvoices.length}`);

  // Filtrar: en mode normal, només les sospitoses (data molt propera a createdAt o sense ocrRawData.invoiceDate)
  let invoices;
  if (FORCE_ALL) {
    invoices = allInvoices;
  } else {
    invoices = allInvoices.filter((inv) => {
      // 1) Si no té ocrRawData o ocrRawData.invoiceDate és null → sospitosa
      if (!inv.ocrRawData || inv.ocrRawData.invoiceDate === null || inv.ocrRawData.invoiceDate === undefined) {
        return true;
      }
      // 2) Si issueDate està dins de 2 dies de createdAt → probablement data de pujada
      const issueDateMs = new Date(inv.issueDate).getTime();
      const createdAtMs = new Date(inv.createdAt).getTime();
      const diffDays = Math.abs(issueDateMs - createdAtMs) / (1000 * 60 * 60 * 24);
      if (diffDays < 2) return true;
      return false;
    });
  }

  console.log(`🔍 Factures a revisar: ${invoices.length}${FORCE_ALL ? ' (totes)' : ' (dates sospitoses)'}\n`);

  if (invoices.length === 0) {
    console.log('✅ No hi ha factures per corregir!');
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

  const tmpDir = path.join(os.tmpdir(), 'fix-dates-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  let noChange = 0;

  for (const inv of invoices) {
    const label = `${inv.invoiceNumber} (${inv.supplier?.name || 'sense proveïdor'})`;
    process.stdout.write(`  📄 ${label}... `);

    try {
      // Descarregar PDF de GDrive
      const tmpPath = path.join(tmpDir, `${inv.id}.pdf`);
      await gdrive.downloadFile(inv.gdriveFileId, tmpPath);

      // Re-extreure amb la lògica millorada
      const analysis = await pdfExtract.analyzePdf(tmpPath);

      // Netejar fitxer temporal
      try { fs.unlinkSync(tmpPath); } catch {}

      if (!analysis.invoiceDate) {
        console.log('⚪ No s\'ha pogut detectar data');
        skipped++;
        continue;
      }

      const oldDate = inv.issueDate;
      const newDate = analysis.invoiceDate;

      // Comparar dates (ignorar hores)
      const oldStr = oldDate.toISOString().split('T')[0];
      const newStr = newDate.toISOString().split('T')[0];

      if (oldStr === newStr) {
        console.log(`✅ Data correcta (${oldStr})`);
        noChange++;
        continue;
      }

      console.log(`🔄 ${oldStr} → ${newStr}`);

      if (!DRY_RUN) {
        // Actualitzar la data i guardar la data extreta a ocrRawData
        const ocrRawData = inv.ocrRawData || {};
        ocrRawData.invoiceDate = newDate.toISOString();
        ocrRawData.invoiceDateFixed = true;
        ocrRawData.previousDate = oldDate.toISOString();

        await prisma.receivedInvoice.update({
          where: { id: inv.id },
          data: {
            issueDate: newDate,
            ocrRawData,
          },
        });
      }
      fixed++;
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      errors++;
    }
  }

  // Netejar directori temporal
  try { fs.rmdirSync(tmpDir, { recursive: true }); } catch {}

  console.log('\n═══════════════════════════════════════════════');
  console.log('  RESULTAT:');
  console.log(`  ✅ Correctes:    ${noChange}`);
  console.log(`  🔄 Corregides:   ${fixed}${DRY_RUN ? ' (mode sec, no aplicat)' : ''}`);
  console.log(`  ⚪ Sense data:   ${skipped}`);
  console.log(`  ❌ Errors:       ${errors}`);
  console.log('═══════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  prisma.$disconnect();
  process.exit(1);
});
