#!/usr/bin/env node
/**
 * BULK RESCAN — Re-escaneja TOTES les factures rebudes amb el codi millorat.
 *
 * Per cada factura amb PDF:
 *   1. Re-analitza el PDF (analyzePdf)
 *   2. Actualitza número de factura, import, data, proveïdor si millora
 *   3. Detecta duplicats reals → soft-delete el pitjor
 *   4. Marca com NOT_INVOICE si el document no és factura
 *
 * Ús:
 *   node backend/scripts/bulk-rescan.js              (dry-run: només informe)
 *   node backend/scripts/bulk-rescan.js --apply       (aplica canvis)
 *   node backend/scripts/bulk-rescan.js --apply --verbose
 *
 * IMPORTANT: Executar des de l'arrel del projecte.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Importar serveis
const pdfExtract = require('../src/services/pdfExtractService');

let gdrive;
try {
  gdrive = require('../src/services/gdriveService');
} catch (e) {
  console.warn('⚠️  GDrive service no disponible — només es processaran PDFs locals');
}

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// Estadístiques
const stats = {
  total: 0,
  withPdf: 0,
  processed: 0,
  skipped: 0,
  errors: 0,
  updated: 0,
  duplicatesFound: 0,
  duplicatesDeleted: 0,
  notInvoice: 0,
  numberFixed: 0,
  amountFixed: 0,
  supplierFixed: 0,
  dateFixed: 0,
};

const report = {
  duplicates: [],
  notInvoices: [],
  numberChanges: [],
  amountChanges: [],
  errors: [],
};

function log(msg) {
  if (VERBOSE) console.log(msg);
}

function isProvisionalNumber(num) {
  return /^(PROV-|GDRIVE-|ZOHO-)/.test(num) || /^-DUP-/.test(num);
}

function isBetterNumber(oldNum, newNum) {
  if (!newNum) return false;
  if (isProvisionalNumber(oldNum) && !isProvisionalNumber(newNum)) return true;
  if (oldNum.includes('-DUP-') && !newNum.includes('-DUP-')) return true;
  return false;
}

async function getPdfBuffer(invoice) {
  // 1. Fitxer local
  if (invoice.filePath && fs.existsSync(invoice.filePath)) {
    return fs.readFileSync(invoice.filePath);
  }

  // 2. Google Drive
  if (invoice.gdriveFileId && gdrive) {
    try {
      const drive = gdrive.getDriveClient();
      const fileRes = await drive.files.get(
        { fileId: invoice.gdriveFileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      );
      return Buffer.from(fileRes.data);
    } catch (err) {
      log(`  ⚠️  Error GDrive ${invoice.gdriveFileId}: ${err.message}`);
      return null;
    }
  }

  return null;
}

async function processInvoice(invoice) {
  const pdfBuffer = await getPdfBuffer(invoice);
  if (!pdfBuffer) {
    stats.skipped++;
    return;
  }
  stats.withPdf++;

  let analysis;
  try {
    analysis = await pdfExtract.analyzePdf(pdfBuffer);
  } catch (err) {
    stats.errors++;
    report.errors.push({ id: invoice.id, num: invoice.invoiceNumber, error: `analyzePdf: ${err.message}` });
    return;
  }

  if (!analysis.hasText) {
    stats.skipped++;
    log(`  ⏭️  ${invoice.invoiceNumber} — sense text`);
    return;
  }

  stats.processed++;
  const changes = {};

  // --- 1. Tipus de document ---
  if (analysis.documentType?.type && analysis.documentType.type !== 'invoice' && analysis.documentType.type !== 'unknown') {
    if (analysis.documentType.confidence >= 0.6) {
      stats.notInvoice++;
      report.notInvoices.push({
        id: invoice.id,
        num: invoice.invoiceNumber,
        supplier: invoice.supplier?.name,
        type: analysis.documentType.label,
        confidence: analysis.documentType.confidence,
      });
      if (APPLY && invoice.status !== 'NOT_INVOICE') {
        changes.status = 'NOT_INVOICE';
      }
    }
  }

  // --- 2. Número de factura ---
  if (analysis.invoiceNumber) {
    const newNum = analysis.invoiceNumber;
    const oldNum = invoice.invoiceNumber;
    if (newNum !== oldNum) {
      if (isBetterNumber(oldNum, newNum)) {
        stats.numberFixed++;
        report.numberChanges.push({
          id: invoice.id,
          old: oldNum,
          new: newNum,
          supplier: invoice.supplier?.name,
          reason: 'provisional → real',
        });
        changes.invoiceNumber = newNum;
      } else if (oldNum !== newNum && VERBOSE) {
        log(`  ℹ️  ${oldNum} → ${newNum} (no aplicat, no és millora clara)`);
      }
    }
  }

  // --- 3. Import ---
  if (analysis.totalAmount && analysis.totalAmount > 0) {
    const oldAmount = parseFloat(invoice.totalAmount);
    const newAmount = analysis.totalAmount;
    // Actualitzar si: import era 0, o diferència significativa amb número provisional
    if (oldAmount === 0 || (isProvisionalNumber(invoice.invoiceNumber) && Math.abs(oldAmount - newAmount) > 1)) {
      stats.amountFixed++;
      report.amountChanges.push({
        id: invoice.id,
        num: invoice.invoiceNumber,
        supplier: invoice.supplier?.name,
        old: oldAmount,
        new: newAmount,
      });
      changes.totalAmount = newAmount;

      // Recalcular subtotal/IVA
      if (analysis.baseAmount && analysis.baseAmount < newAmount) {
        changes.subtotal = parseFloat(analysis.baseAmount.toFixed(2));
        changes.taxAmount = parseFloat((newAmount - changes.subtotal).toFixed(2));
        if (changes.subtotal > 0) {
          changes.taxRate = Math.round((changes.taxAmount / changes.subtotal) * 100);
        }
      } else {
        changes.subtotal = parseFloat((newAmount / 1.21).toFixed(2));
        changes.taxAmount = parseFloat((newAmount - changes.subtotal).toFixed(2));
        changes.taxRate = 21;
      }
    }
  }

  // --- 4. Proveïdor ---
  if (!invoice.supplierId && analysis.nifCif?.length > 0) {
    let matched = await pdfExtract.findSupplierByNif(analysis.nifCif);
    if (!matched && analysis.supplierName) {
      matched = await pdfExtract.findSupplierByName(analysis.supplierName);
    }
    if (!matched && invoice.originalFileName) {
      matched = await pdfExtract.findSupplierByFileName(invoice.originalFileName);
    }
    if (matched) {
      stats.supplierFixed++;
      changes.supplierId = matched.id;
      log(`  🏢 ${invoice.invoiceNumber} — proveïdor detectat: ${matched.name}`);
    }
  }

  // --- 5. Data ---
  if (analysis.invoiceDate && invoice.issueDate) {
    const oldDate = new Date(invoice.issueDate).toISOString().slice(0, 10);
    const newDate = new Date(analysis.invoiceDate).toISOString().slice(0, 10);
    // Només corregir si la data actual és sospitosa (1 de gener, molt antiga, etc.)
    if (oldDate !== newDate && (oldDate.endsWith('-01-01') || isProvisionalNumber(invoice.invoiceNumber))) {
      stats.dateFixed++;
      changes.issueDate = new Date(analysis.invoiceDate);
    }
  }

  // --- Aplicar canvis ---
  if (Object.keys(changes).length > 0) {
    stats.updated++;
    log(`  ✏️  ${invoice.invoiceNumber} — canvis: ${Object.keys(changes).join(', ')}`);
    if (APPLY) {
      try {
        await prisma.receivedInvoice.update({
          where: { id: invoice.id },
          data: changes,
        });
      } catch (err) {
        stats.errors++;
        report.errors.push({ id: invoice.id, num: invoice.invoiceNumber, error: `update: ${err.message}` });
      }
    }
  }
}

async function findAndCleanDuplicates() {
  console.log('\n🔍 Buscant duplicats...\n');

  // Agrupar per invoiceNumber + supplierId
  const groups = await prisma.$queryRaw`
    SELECT "invoiceNumber", "supplierId",
           ARRAY_AGG("id" ORDER BY "createdAt" ASC) AS ids,
           ARRAY_AGG("totalAmount"::float ORDER BY "createdAt" ASC) AS amounts,
           ARRAY_AGG("status" ORDER BY "createdAt" ASC) AS statuses,
           ARRAY_AGG("source" ORDER BY "createdAt" ASC) AS sources,
           COUNT(*) AS cnt
    FROM "received_invoices"
    WHERE "deletedAt" IS NULL
      AND "invoiceNumber" NOT LIKE 'PROV-%'
      AND "invoiceNumber" NOT LIKE 'GDRIVE-%'
      AND "invoiceNumber" NOT LIKE 'ZOHO-%'
    GROUP BY "invoiceNumber", "supplierId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  for (const group of groups) {
    const ids = group.ids;
    const amounts = group.amounts;
    const statuses = group.statuses;
    const sources = group.sources;

    // Decidir quin queda: preferir PAID > APPROVED > PENDING > resta, i el primer creat
    let keepIdx = 0;
    const statusPriority = { PAID: 5, APPROVED: 4, REVIEWED: 3, PENDING: 2, PDF_PENDING: 1, AMOUNT_PENDING: 1 };
    for (let i = 1; i < ids.length; i++) {
      const currentPri = statusPriority[statuses[i]] || 0;
      const keepPri = statusPriority[statuses[keepIdx]] || 0;
      if (currentPri > keepPri) keepIdx = i;
      else if (currentPri === keepPri && amounts[i] > 0 && amounts[keepIdx] === 0) keepIdx = i;
    }

    const keepId = ids[keepIdx];
    const deleteIds = ids.filter((_, i) => i !== keepIdx);

    stats.duplicatesFound += deleteIds.length;
    report.duplicates.push({
      invoiceNumber: group.invoiceNumber,
      count: parseInt(group.cnt),
      keepId,
      keepStatus: statuses[keepIdx],
      deleteIds,
    });

    console.log(`  📋 ${group.invoiceNumber} — ${group.cnt} còpies → quedem amb ${statuses[keepIdx]} (${keepId.slice(0, 8)}), eliminem ${deleteIds.length}`);

    if (APPLY) {
      for (const delId of deleteIds) {
        try {
          await prisma.receivedInvoice.update({
            where: { id: delId },
            data: { deletedAt: new Date(), isDuplicate: true, duplicateOfId: keepId },
          });
          stats.duplicatesDeleted++;
        } catch (err) {
          report.errors.push({ id: delId, error: `delete dup: ${err.message}` });
        }
      }
    }
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  BULK RESCAN — ${APPLY ? '⚡ MODE APLICAR' : '👁️  DRY-RUN (sense canvis)'}`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. Obtenir totes les factures actives
  const invoices = await prisma.receivedInvoice.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      subtotal: true,
      taxRate: true,
      taxAmount: true,
      issueDate: true,
      status: true,
      source: true,
      filePath: true,
      gdriveFileId: true,
      originalFileName: true,
      supplierId: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  stats.total = invoices.length;
  console.log(`📦 Total factures actives: ${stats.total}\n`);

  // 2. Re-escanejar cada factura amb PDF
  console.log('🔄 Re-escanejant factures...\n');

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    const hasPdf = !!(inv.filePath || inv.gdriveFileId);

    if (i % 50 === 0 && i > 0) {
      console.log(`  ... ${i}/${stats.total} processades (${stats.updated} actualitzades, ${stats.errors} errors)`);
    }

    if (!hasPdf) {
      stats.skipped++;
      continue;
    }

    try {
      await processInvoice(inv);
    } catch (err) {
      stats.errors++;
      report.errors.push({ id: inv.id, num: inv.invoiceNumber, error: err.message });
    }

    // Petit delay per no saturar GDrive API
    if (inv.gdriveFileId) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 3. Netejar duplicats
  await findAndCleanDuplicates();

  // 4. Informe final
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  INFORME FINAL ${APPLY ? '(CANVIS APLICATS)' : '(DRY-RUN)'}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total factures:        ${stats.total}`);
  console.log(`  Amb PDF:               ${stats.withPdf}`);
  console.log(`  Processades:           ${stats.processed}`);
  console.log(`  Sense PDF / text:      ${stats.skipped}`);
  console.log(`  Errors:                ${stats.errors}`);
  console.log(`  ---`);
  console.log(`  Actualitzades:         ${stats.updated}`);
  console.log(`  Números corregits:     ${stats.numberFixed}`);
  console.log(`  Imports corregits:     ${stats.amountFixed}`);
  console.log(`  Proveïdors assignats:  ${stats.supplierFixed}`);
  console.log(`  Dates corregides:      ${stats.dateFixed}`);
  console.log(`  No són factura:        ${stats.notInvoice}`);
  console.log(`  ---`);
  console.log(`  Duplicats trobats:     ${stats.duplicatesFound}`);
  console.log(`  Duplicats eliminats:   ${stats.duplicatesDeleted}`);

  if (report.duplicates.length > 0) {
    console.log(`\n📋 DUPLICATS:`);
    for (const d of report.duplicates) {
      console.log(`  ${d.invoiceNumber} — ${d.count} còpies, queda: ${d.keepStatus}`);
    }
  }

  if (report.notInvoices.length > 0) {
    console.log(`\n🚫 NO SÓN FACTURA:`);
    for (const n of report.notInvoices) {
      console.log(`  ${n.num} (${n.supplier || '?'}) → ${n.type} (${Math.round(n.confidence * 100)}%)`);
    }
  }

  if (report.numberChanges.length > 0) {
    console.log(`\n🔢 NÚMEROS CORREGITS:`);
    for (const c of report.numberChanges) {
      console.log(`  ${c.old} → ${c.new} (${c.supplier || '?'}) [${c.reason}]`);
    }
  }

  if (report.amountChanges.length > 0) {
    console.log(`\n💰 IMPORTS CORREGITS:`);
    for (const c of report.amountChanges) {
      console.log(`  ${c.num} (${c.supplier || '?'}) → ${c.old}€ → ${c.new}€`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`\n❌ ERRORS:`);
    for (const e of report.errors.slice(0, 20)) {
      console.log(`  ${e.num || e.id} — ${e.error}`);
    }
    if (report.errors.length > 20) {
      console.log(`  ... i ${report.errors.length - 20} errors més`);
    }
  }

  if (!APPLY) {
    console.log(`\n💡 Per aplicar els canvis, executa:`);
    console.log(`   node backend/scripts/bulk-rescan.js --apply\n`);
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Error fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
