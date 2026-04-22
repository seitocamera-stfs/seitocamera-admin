#!/usr/bin/env node
/**
 * Script d'anàlisi i neteja de duplicats — Abril 2026
 *
 * Pas 1: MODE ANÀLISI (per defecte) — només mostra el que trobaria
 * Pas 2: MODE NETEJA (amb --clean) — elimina duplicats del Drive i marca a la BD
 *
 * Ús:
 *   node scripts/cleanDuplicatesApril.js          # Només anàlisi
 *   node scripts/cleanDuplicatesApril.js --clean   # Neteja real
 */

const { prisma } = require('../src/config/database');
const gdrive = require('../src/services/gdriveService');

const CLEAN_MODE = process.argv.includes('--clean');
const YEAR = 2026;
const MONTH = 4; // Abril

const from = new Date(YEAR, MONTH - 1, 1);
const to = new Date(YEAR, MONTH, 0, 23, 59, 59, 999);

async function main() {
  console.log('='.repeat(60));
  console.log(CLEAN_MODE ? '🧹 MODE NETEJA — Es faran canvis reals!' : '🔍 MODE ANÀLISI — Només revisió, sense canvis');
  console.log(`📅 Període: ${from.toISOString().split('T')[0]} → ${to.toISOString().split('T')[0]}`);
  console.log('='.repeat(60));

  // ===========================================
  // 1. ANÀLISI BD — Buscar duplicats per invoiceNumber + supplierId
  // ===========================================
  console.log('\n📊 ANÀLISI BASE DE DADES\n');

  const aprilInvoices = await prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      deletedAt: null,
    },
    include: {
      supplier: { select: { id: true, name: true, nif: true } },
    },
    orderBy: [{ invoiceNumber: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`Total factures abril a la BD: ${aprilInvoices.length}`);

  // Agrupar per invoiceNumber + supplierId
  const groups = {};
  for (const inv of aprilInvoices) {
    const key = `${(inv.invoiceNumber || '').toLowerCase().trim()}|${inv.supplierId || 'null'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(inv);
  }

  // Trobar grups amb >1 factura (possibles duplicats)
  const duplicateGroups = Object.entries(groups).filter(([_, invs]) => invs.length > 1);

  console.log(`Grups amb possibles duplicats: ${duplicateGroups.length}`);

  let dbDuplicatesFound = 0;
  const toMarkDuplicate = []; // Factures a marcar com isDuplicate
  const driveFilesToDelete = []; // IDs de fitxers a eliminar del Drive

  for (const [key, invs] of duplicateGroups) {
    const supplier = invs[0].supplier?.name || 'Desconegut';
    const invoiceNum = invs[0].invoiceNumber;

    // La primera (més antiga per createdAt) és l'original
    const sorted = invs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const original = sorted[0];
    const duplicates = sorted.slice(1);

    // Verificar que realment són duplicats (import similar)
    for (const dup of duplicates) {
      const amountDiff = Math.abs(parseFloat(original.totalAmount) - parseFloat(dup.totalAmount));
      const isSameAmount = amountDiff <= 1; // Tolerància 1€

      if (!isSameAmount) {
        console.log(`  ⚠️  ${invoiceNum} (${supplier}): import diferent (${original.totalAmount}€ vs ${dup.totalAmount}€) — NO duplicat`);
        continue;
      }

      dbDuplicatesFound++;
      console.log(`  🔁 DUPLICAT: ${invoiceNum} | ${supplier} | ${parseFloat(dup.totalAmount).toFixed(2)}€`);
      console.log(`     Original: id=${original.id} | creat ${original.createdAt.toISOString().split('T')[0]} | isDuplicate=${original.isDuplicate}`);
      console.log(`     Duplicat: id=${dup.id} | creat ${dup.createdAt.toISOString().split('T')[0]} | isDuplicate=${dup.isDuplicate} | gdriveFileId=${dup.gdriveFileId || '—'}`);

      if (!dup.isDuplicate) {
        toMarkDuplicate.push({ id: dup.id, duplicateOfId: original.id, gdriveFileId: dup.gdriveFileId });
      }

      // Si el duplicat té un fitxer al Drive, marcar per eliminar
      if (dup.gdriveFileId) {
        driveFilesToDelete.push({
          fileId: dup.gdriveFileId,
          invoiceNumber: invoiceNum,
          supplier,
          invoiceId: dup.id,
        });
      }
    }
  }

  // ===========================================
  // 2. Buscar factures ja marcades isDuplicate que encara tenen gdriveFileId
  // ===========================================
  const alreadyMarkedWithDrive = await prisma.receivedInvoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      isDuplicate: true,
      gdriveFileId: { not: null },
      deletedAt: null,
    },
    include: {
      supplier: { select: { name: true } },
    },
  });

  if (alreadyMarkedWithDrive.length > 0) {
    console.log(`\n📁 Factures ja marcades com duplicat AMB fitxer al Drive: ${alreadyMarkedWithDrive.length}`);
    for (const inv of alreadyMarkedWithDrive) {
      console.log(`  🗑️  ${inv.invoiceNumber} | ${inv.supplier?.name || '—'} | gdriveFileId=${inv.gdriveFileId}`);
      // Afegir si no ja a la llista
      if (!driveFilesToDelete.find(d => d.fileId === inv.gdriveFileId)) {
        driveFilesToDelete.push({
          fileId: inv.gdriveFileId,
          invoiceNumber: inv.invoiceNumber,
          supplier: inv.supplier?.name || '—',
          invoiceId: inv.id,
        });
      }
    }
  }

  // ===========================================
  // 3. ANÀLISI GOOGLE DRIVE — Buscar fitxers duplicats per nom
  // ===========================================
  console.log('\n📁 ANÀLISI GOOGLE DRIVE\n');

  try {
    // Llistar fitxers a la carpeta d'abril
    const aprilFolder = `factures-rebudes/${YEAR}/T2/04`;
    const files = await gdrive.listFiles(aprilFolder, 500);
    console.log(`Fitxers a ${aprilFolder}: ${files.length}`);

    // Buscar noms duplicats
    const nameGroups = {};
    for (const file of files) {
      const name = file.name.toLowerCase().trim();
      if (!nameGroups[name]) nameGroups[name] = [];
      nameGroups[name].push(file);
    }

    const driveNameDuplicates = Object.entries(nameGroups).filter(([_, fs]) => fs.length > 1);
    console.log(`Fitxers amb nom duplicat al Drive: ${driveNameDuplicates.length} grups`);

    for (const [name, fs] of driveNameDuplicates) {
      const sorted = fs.sort((a, b) => new Date(a.createdTime || 0) - new Date(b.createdTime || 0));
      console.log(`  📄 "${name}" — ${fs.length} còpies`);
      for (let i = 0; i < sorted.length; i++) {
        const f = sorted[i];
        const isOriginal = i === 0;
        console.log(`     ${isOriginal ? '✅ Original' : '🗑️  Duplicat'}: id=${f.id} | creat=${f.createdTime || '?'}`);

        // Afegir duplicats (no l'original) a la llista d'eliminació
        if (!isOriginal && !driveFilesToDelete.find(d => d.fileId === f.id)) {
          driveFilesToDelete.push({
            fileId: f.id,
            invoiceNumber: name,
            supplier: 'Drive duplicate',
            invoiceId: null,
          });
        }
      }
    }

    // També mirar la carpeta duplicades/
    try {
      const dupFolder = 'factures-rebudes/duplicades';
      const dupFiles = await gdrive.listFiles(dupFolder, 200);
      if (dupFiles.length > 0) {
        console.log(`\n📂 Fitxers a ${dupFolder}: ${dupFiles.length}`);
        // Filtrar els d'abril per data
        const aprilDups = dupFiles.filter(f => {
          const created = new Date(f.createdTime || f.modifiedTime || 0);
          return created >= from && created <= to;
        });
        console.log(`  D'abril: ${aprilDups.length}`);
      }
    } catch (e) {
      console.log(`  (No s'ha pogut llegir carpeta duplicades/: ${e.message})`);
    }

  } catch (e) {
    console.log(`⚠️  Error accedint a Google Drive: ${e.message}`);
    console.log('   Continuant amb l\'anàlisi de BD...');
  }

  // ===========================================
  // 4. RESUM
  // ===========================================
  console.log('\n' + '='.repeat(60));
  console.log('📋 RESUM');
  console.log('='.repeat(60));
  console.log(`Duplicats trobats a la BD: ${dbDuplicatesFound}`);
  console.log(`  → Pendents de marcar isDuplicate: ${toMarkDuplicate.length}`);
  console.log(`Fitxers a eliminar del Drive: ${driveFilesToDelete.length}`);

  if (!CLEAN_MODE) {
    console.log('\n💡 Per executar la neteja real:');
    console.log('   node scripts/cleanDuplicatesApril.js --clean');
    console.log('\nAixò:');
    console.log(`  1. Marcarà ${toMarkDuplicate.length} factures com isDuplicate a la BD`);
    console.log(`  2. Mourà ${driveFilesToDelete.length} fitxers a la paperera del Drive`);
    return;
  }

  // ===========================================
  // 5. NETEJA (només amb --clean)
  // ===========================================
  console.log('\n🧹 EXECUTANT NETEJA...\n');

  // 5a. Marcar duplicats a la BD
  let bdFixed = 0;
  for (const dup of toMarkDuplicate) {
    try {
      await prisma.receivedInvoice.update({
        where: { id: dup.id },
        data: {
          isDuplicate: true,
          duplicateOfId: dup.duplicateOfId,
        },
      });
      bdFixed++;
      console.log(`  ✅ BD: Marcat isDuplicate id=${dup.id}`);
    } catch (e) {
      console.log(`  ❌ BD: Error marcant ${dup.id}: ${e.message}`);
    }
  }

  // 5b. Eliminar fitxers del Drive (moure a paperera)
  let driveDeleted = 0;
  for (const file of driveFilesToDelete) {
    try {
      await gdrive.deleteFile(file.fileId);
      driveDeleted++;
      console.log(`  ✅ Drive: Eliminat ${file.invoiceNumber} (${file.supplier}) fileId=${file.fileId}`);

      // Si la factura té gdriveFileId, netejar-lo a la BD
      if (file.invoiceId) {
        await prisma.receivedInvoice.update({
          where: { id: file.invoiceId },
          data: { gdriveFileId: null },
        }).catch(() => {});
      }
    } catch (e) {
      console.log(`  ❌ Drive: Error eliminant ${file.fileId}: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ NETEJA COMPLETADA`);
  console.log(`   BD: ${bdFixed}/${toMarkDuplicate.length} factures marcades com duplicat`);
  console.log(`   Drive: ${driveDeleted}/${driveFilesToDelete.length} fitxers eliminats`);
  console.log('='.repeat(60));
}

main()
  .catch(e => {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
