#!/usr/bin/env node
/**
 * Diagnòstic complet de duplicats:
 * - Fitxers a GDrive carpeta duplicades/
 * - Registres a BD marcats com isDuplicate
 * - Coherència entre GDrive i BD
 * - Falsos positius (diferent proveïdor, mateix nº)
 * - Factures originals vs duplicades
 */
require('dotenv').config();

const { prisma } = require('../src/config/database');
const gdrive = require('../src/services/gdriveService');

async function main() {
  console.log('=== DIAGNÒSTIC COMPLET DUPLICATS ===\n');

  // =============================================
  // PART 1: FITXERS A GDRIVE duplicades/
  // =============================================
  console.log('═══ 1. FITXERS A GDRIVE duplicades/ ═══\n');

  const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');
  const dupFolder = await gdrive.findOrCreateFolder('duplicades', facturesRebudesId);
  const drive = gdrive.getDriveClient();

  const gdriveRes = await drive.files.list({
    q: `'${dupFolder.id}' in parents and trashed=false`,
    fields: 'files(id, name, size, createdTime, modifiedTime)',
    orderBy: 'createdTime desc',
    pageSize: 500,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const gdriveFiles = gdriveRes.data.files || [];
  console.log(`Total fitxers a duplicades/: ${gdriveFiles.length}\n`);

  for (const f of gdriveFiles) {
    const sizeKB = f.size ? Math.round(f.size / 1024) : '?';
    console.log(`  ${f.name} (${sizeKB} KB) — creat: ${f.createdTime?.split('T')[0] || '?'} — ID: ${f.id}`);
  }

  // =============================================
  // PART 2: REGISTRES A BD (isDuplicate = true)
  // =============================================
  console.log('\n═══ 2. REGISTRES DUPLICAT A BD ═══\n');

  const dupInvoices = await prisma.receivedInvoice.findMany({
    where: { isDuplicate: true },
    select: {
      id: true,
      invoiceNumber: true,
      originalFileName: true,
      gdriveFileId: true,
      duplicateOfId: true,
      totalAmount: true,
      status: true,
      source: true,
      issueDate: true,
      createdAt: true,
      description: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Total registres duplicat a BD: ${dupInvoices.length}\n`);

  // =============================================
  // PART 3: FACTURES ORIGINALS (apuntades pels duplicats)
  // =============================================
  const originalIds = [...new Set(dupInvoices.map(d => d.duplicateOfId).filter(Boolean))];
  const originals = originalIds.length > 0
    ? await prisma.receivedInvoice.findMany({
        where: { id: { in: originalIds } },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          status: true,
          gdriveFileId: true,
          originalFileName: true,
          supplier: { select: { id: true, name: true } },
        },
      })
    : [];
  const originalsMap = Object.fromEntries(originals.map(o => [o.id, o]));

  // =============================================
  // PART 4: ANÀLISI DETALLAT
  // =============================================
  console.log('═══ 3. ANÀLISI DETALLAT ═══\n');

  const gdriveIdSet = new Set(gdriveFiles.map(f => f.id));
  const dbGdriveIdSet = new Set(dupInvoices.map(d => d.gdriveFileId).filter(Boolean));
  const supplierCounts = {};
  const numberCounts = {};
  const issues = {
    falsePositives: [],       // Diferent proveïdor
    orphanGdrive: [],         // A GDrive però no a BD
    orphanDb: [],             // A BD però no a GDrive
    missingOriginal: [],      // Original no trobat
    sameSupplierReal: [],     // Mateix proveïdor = duplicat real
    noSupplier: [],           // Sense proveïdor
  };

  for (const dup of dupInvoices) {
    const cleanNum = dup.invoiceNumber.replace(/-DUP-[a-z0-9]+$/i, '');
    const original = dup.duplicateOfId ? originalsMap[dup.duplicateOfId] : null;
    const dupSupplier = dup.supplier?.name || null;
    const origSupplier = original?.supplier?.name || null;

    supplierCounts[dupSupplier || 'Sense proveïdor'] = (supplierCounts[dupSupplier || 'Sense proveïdor'] || 0) + 1;
    numberCounts[cleanNum] = (numberCounts[cleanNum] || 0) + 1;

    // Comprovar si el fitxer GDrive existeix a duplicades/
    if (dup.gdriveFileId && !gdriveIdSet.has(dup.gdriveFileId)) {
      issues.orphanDb.push(dup);
    }

    // Comprovar si l'original existeix
    if (dup.duplicateOfId && !original) {
      issues.missingOriginal.push(dup);
    }

    // Falsos positius: diferent proveïdor
    if (original && dupSupplier && origSupplier && dupSupplier !== origSupplier) {
      issues.falsePositives.push({ dup, original });
    }

    // Sense proveïdor
    if (!dupSupplier && !origSupplier) {
      issues.noSupplier.push({ dup, original });
    }

    // Duplicats reals (mateix proveïdor)
    if (original && dupSupplier && origSupplier && dupSupplier === origSupplier) {
      issues.sameSupplierReal.push({ dup, original });
    }
  }

  // Fitxers a GDrive que no tenen registre a BD
  for (const f of gdriveFiles) {
    if (!dbGdriveIdSet.has(f.id)) {
      issues.orphanGdrive.push(f);
    }
  }

  // =============================================
  // PART 5: RESULTATS
  // =============================================

  // Detall per cada duplicat
  console.log('--- DETALL CADA DUPLICAT ---\n');
  for (const dup of dupInvoices) {
    const cleanNum = dup.invoiceNumber.replace(/-DUP-[a-z0-9]+$/i, '');
    const original = dup.duplicateOfId ? originalsMap[dup.duplicateOfId] : null;
    const inGdrive = dup.gdriveFileId ? gdriveIdSet.has(dup.gdriveFileId) : false;

    console.log(`  [${dup.id}] ${dup.originalFileName || '?'}`);
    console.log(`    Nº: ${cleanNum} | Proveïdor: ${dup.supplier?.name || 'CAP'} | Import: ${dup.totalAmount}€ | Status: ${dup.status}`);
    console.log(`    Font: ${dup.source} | Creat: ${dup.createdAt?.toISOString().split('T')[0]} | GDrive: ${inGdrive ? 'SÍ' : 'NO'}`);
    if (original) {
      const sameSupplier = (dup.supplier?.id === original.supplier?.id);
      console.log(`    → Original [${original.id}]: ${original.invoiceNumber} | ${original.supplier?.name || 'CAP'} | ${original.totalAmount}€ | ${original.status}`);
      if (!sameSupplier) {
        console.log(`    ⚠ FALS POSITIU: proveïdors DIFERENTS`);
      }
    } else if (dup.duplicateOfId) {
      console.log(`    ⚠ Original ID ${dup.duplicateOfId} NO TROBAT a BD`);
    }
    console.log();
  }

  // Resums
  console.log('\n═══ 4. RESUM ═══\n');

  console.log('Per proveïdor:');
  const sortedSuppliers = Object.entries(supplierCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedSuppliers) {
    console.log(`  ${name}: ${count}`);
  }

  console.log('\nNúmeros més repetits:');
  const sortedNumbers = Object.entries(numberCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [num, count] of sortedNumbers) {
    console.log(`  ${num}: ${count}x`);
  }

  // Problemes detectats
  console.log('\n═══ 5. PROBLEMES DETECTATS ═══\n');

  console.log(`✓ Duplicats reals (mateix proveïdor): ${issues.sameSupplierReal.length}`);
  console.log(`⚠ Falsos positius (diferent proveïdor): ${issues.falsePositives.length}`);
  console.log(`⚠ Sense proveïdor (no verificable): ${issues.noSupplier.length}`);
  console.log(`⚠ Fitxers GDrive sense registre BD: ${issues.orphanGdrive.length}`);
  console.log(`⚠ Registres BD sense fitxer GDrive: ${issues.orphanDb.length}`);
  console.log(`⚠ Original no trobat a BD: ${issues.missingOriginal.length}`);

  if (issues.falsePositives.length > 0) {
    console.log('\n--- FALSOS POSITIUS (cal recuperar) ---');
    for (const { dup, original } of issues.falsePositives) {
      const cleanNum = dup.invoiceNumber.replace(/-DUP-[a-z0-9]+$/i, '');
      console.log(`  "${cleanNum}": ${dup.supplier?.name} ≠ ${original.supplier?.name} (fitxer: ${dup.originalFileName})`);
    }
  }

  if (issues.orphanGdrive.length > 0) {
    console.log('\n--- FITXERS ORFES A GDRIVE (no a BD) ---');
    for (const f of issues.orphanGdrive) {
      console.log(`  ${f.name} — ${f.createdTime?.split('T')[0]} — ID: ${f.id}`);
    }
  }

  if (issues.orphanDb.length > 0) {
    console.log('\n--- REGISTRES BD SENSE FITXER GDRIVE ---');
    for (const d of issues.orphanDb) {
      console.log(`  [${d.id}] ${d.originalFileName} — gdriveId: ${d.gdriveFileId}`);
    }
  }

  // =============================================
  // PART 6: ESTADÍSTIQUES GENERALS FACTURES REBUDES
  // =============================================
  console.log('\n═══ 6. ESTADÍSTIQUES FACTURES REBUDES ═══\n');

  const totalInvoices = await prisma.receivedInvoice.count();
  const byStatus = await prisma.receivedInvoice.groupBy({
    by: ['status'],
    _count: true,
    orderBy: { _count: { status: 'desc' } },
  });
  const bySource = await prisma.receivedInvoice.groupBy({
    by: ['source'],
    _count: true,
    orderBy: { _count: { source: 'desc' } },
  });
  const duplicateCount = await prisma.receivedInvoice.count({ where: { isDuplicate: true } });
  const zeroAmount = await prisma.receivedInvoice.count({ where: { totalAmount: 0 } });
  const provNumbers = await prisma.receivedInvoice.count({
    where: { invoiceNumber: { startsWith: 'PROV-' } },
  });
  const gdriveNumbers = await prisma.receivedInvoice.count({
    where: { invoiceNumber: { startsWith: 'GDRIVE-' } },
  });

  console.log(`Total factures rebudes: ${totalInvoices}`);
  console.log(`Duplicats: ${duplicateCount}`);
  console.log(`Import zero: ${zeroAmount}`);
  console.log(`Nº provisional (PROV-): ${provNumbers}`);
  console.log(`Nº antic (GDRIVE-): ${gdriveNumbers}`);

  console.log('\nPer status:');
  for (const s of byStatus) {
    console.log(`  ${s.status}: ${s._count}`);
  }

  console.log('\nPer font:');
  for (const s of bySource) {
    console.log(`  ${s.source}: ${s._count}`);
  }

  await prisma.$disconnect();
  console.log('\n=== FI DIAGNÒSTIC ===');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
