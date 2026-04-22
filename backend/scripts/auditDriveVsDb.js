#!/usr/bin/env node
/**
 * AUDITORIA COMPLETA: Google Drive vs Base de Dades
 *
 * Comprova:
 *   1. Tots els fitxers dins factures-rebudes/ al Drive (recursiu)
 *   2. Totes les factures rebudes a la BD
 *   3. Detecta:
 *      - Fitxers duplicats al Drive (mateix nom)
 *      - Factures duplicades a la BD (invoiceNumber + supplierId)
 *      - Fitxers al Drive sense entrada a la BD (orfes Drive)
 *      - Factures a la BD amb gdriveFileId que no existeix al Drive (orfes BD)
 *      - Factures marcades isDuplicate
 *
 * Ús:
 *   node scripts/auditDriveVsDb.js
 */

const { prisma } = require('../src/config/database');
const gdrive = require('../src/services/gdriveService');

async function main() {
  console.log('='.repeat(70));
  console.log('🔍 AUDITORIA COMPLETA: Google Drive vs Base de Dades');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  // =============================================
  // 1. ESCANEJAR GOOGLE DRIVE — tots els fitxers dins factures-rebudes/
  // =============================================
  console.log('\n📁 ESCANEJANT GOOGLE DRIVE (factures-rebudes/ recursiu)...\n');

  const drive = gdrive.getDriveClient();
  const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');

  // Recollir TOTES les carpetes i fitxers recursivament
  const allFolders = [{ id: facturesRebudesId, path: 'factures-rebudes' }];
  const allDriveFiles = []; // { id, name, path, createdTime, size, parents }

  async function scanFolder(parentId, parentPath) {
    // Llistar contingut (fitxers i carpetes)
    let pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of res.data.files || []) {
        const filePath = `${parentPath}/${file.name}`;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          allFolders.push({ id: file.id, path: filePath });
          await scanFolder(file.id, filePath);
        } else {
          allDriveFiles.push({
            id: file.id,
            name: file.name,
            path: filePath,
            mimeType: file.mimeType,
            size: parseInt(file.size || '0'),
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
          });
        }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  await scanFolder(facturesRebudesId, 'factures-rebudes');

  console.log(`📂 Carpetes trobades: ${allFolders.length}`);
  console.log(`📄 Fitxers trobats: ${allDriveFiles.length}`);

  // Mostrar estructura de carpetes
  console.log('\n📂 ESTRUCTURA DE CARPETES:');
  for (const f of allFolders.sort((a, b) => a.path.localeCompare(b.path))) {
    const filesInFolder = allDriveFiles.filter(df => df.path.startsWith(f.path + '/') && !df.path.slice(f.path.length + 1).includes('/'));
    console.log(`  ${f.path}/ ${filesInFolder.length > 0 ? `(${filesInFolder.length} fitxers)` : '(buida)'}`);
  }

  // Llistar TOTS els fitxers amb el seu camí
  if (allDriveFiles.length > 0) {
    console.log('\n📄 TOTS ELS FITXERS AL DRIVE:');
    for (const f of allDriveFiles.sort((a, b) => a.path.localeCompare(b.path))) {
      const sizeKB = (f.size / 1024).toFixed(1);
      console.log(`  ${f.path} (${sizeKB} KB) [id=${f.id}] creat=${f.createdTime || '?'}`);
    }
  }

  // =============================================
  // 2. DETECTAR DUPLICATS AL DRIVE (mateix nom)
  // =============================================
  console.log('\n' + '-'.repeat(70));
  console.log('🔁 DUPLICATS AL DRIVE (fitxers amb el mateix nom)');
  console.log('-'.repeat(70));

  const driveNameGroups = {};
  for (const f of allDriveFiles) {
    const key = f.name.toLowerCase().trim();
    if (!driveNameGroups[key]) driveNameGroups[key] = [];
    driveNameGroups[key].push(f);
  }

  const driveDuplicates = Object.entries(driveNameGroups).filter(([_, files]) => files.length > 1);
  if (driveDuplicates.length === 0) {
    console.log('  ✅ Cap fitxer duplicat per nom al Drive');
  } else {
    console.log(`  ⚠️  ${driveDuplicates.length} grups de fitxers duplicats:\n`);
    for (const [name, files] of driveDuplicates) {
      console.log(`  📄 "${name}" — ${files.length} còpies:`);
      for (const f of files) {
        console.log(`     ${f.path} [id=${f.id}]`);
      }
    }
  }

  // =============================================
  // 3. CONSULTAR BD — totes les factures rebudes
  // =============================================
  console.log('\n' + '-'.repeat(70));
  console.log('🗄️  BASE DE DADES — Factures rebudes');
  console.log('-'.repeat(70));

  const dbInvoices = await prisma.receivedInvoice.findMany({
    where: { deletedAt: null },
    include: {
      supplier: { select: { id: true, name: true, nif: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n  Total factures a la BD: ${dbInvoices.length}`);

  const withDriveId = dbInvoices.filter(i => i.gdriveFileId);
  const withoutDriveId = dbInvoices.filter(i => !i.gdriveFileId);
  const markedDuplicate = dbInvoices.filter(i => i.isDuplicate);

  console.log(`  Amb gdriveFileId: ${withDriveId.length}`);
  console.log(`  Sense gdriveFileId: ${withoutDriveId.length}`);
  console.log(`  Marcades isDuplicate: ${markedDuplicate.length}`);

  // =============================================
  // 4. DUPLICATS A LA BD (invoiceNumber + supplierId)
  // =============================================
  console.log('\n' + '-'.repeat(70));
  console.log('🔁 DUPLICATS A LA BD (invoiceNumber + supplierId)');
  console.log('-'.repeat(70));

  const dbGroups = {};
  for (const inv of dbInvoices) {
    const key = `${(inv.invoiceNumber || '').toLowerCase().trim()}|${inv.supplierId || 'null'}`;
    if (!dbGroups[key]) dbGroups[key] = [];
    dbGroups[key].push(inv);
  }

  const dbDuplicateGroups = Object.entries(dbGroups).filter(([_, invs]) => invs.length > 1);
  if (dbDuplicateGroups.length === 0) {
    console.log('  ✅ Cap duplicat a la BD per invoiceNumber + supplierId');
  } else {
    console.log(`\n  ⚠️  ${dbDuplicateGroups.length} grups amb duplicats:\n`);
    for (const [key, invs] of dbDuplicateGroups) {
      const supplier = invs[0].supplier?.name || 'Desconegut';
      const invoiceNum = invs[0].invoiceNumber;
      console.log(`  📋 "${invoiceNum}" | ${supplier} — ${invs.length} entrades:`);
      for (const inv of invs) {
        console.log(`     id=${inv.id} | ${parseFloat(inv.totalAmount).toFixed(2)}€ | creat=${inv.createdAt.toISOString().split('T')[0]} | isDuplicate=${inv.isDuplicate} | gdriveFileId=${inv.gdriveFileId || '—'} | status=${inv.status}`);
      }
    }
  }

  // =============================================
  // 5. ORFES — Fitxers al Drive sense entrada a BD
  // =============================================
  console.log('\n' + '-'.repeat(70));
  console.log('👻 ORFES DRIVE — Fitxers al Drive sense entrada a la BD');
  console.log('-'.repeat(70));

  const dbDriveIds = new Set(withDriveId.map(i => i.gdriveFileId));

  // Excloure carpetes especials (inbox, duplicades, no-factures) del check d'orfes
  const specialFolders = ['inbox', 'duplicades', 'no-factures'];
  const filesInDateFolders = allDriveFiles.filter(f => {
    const parts = f.path.split('/');
    // Excloure fitxers dins de carpetes especials
    return !parts.some(p => specialFolders.includes(p.toLowerCase()));
  });

  const orphanDrive = filesInDateFolders.filter(f => !dbDriveIds.has(f.id));
  if (orphanDrive.length === 0) {
    console.log('  ✅ Tots els fitxers del Drive tenen entrada a la BD');
  } else {
    console.log(`\n  ⚠️  ${orphanDrive.length} fitxers al Drive SENSE entrada a la BD:\n`);
    for (const f of orphanDrive) {
      console.log(`  📄 ${f.path} [id=${f.id}]`);
    }
  }

  // Fitxers a carpetes especials (informació)
  const filesInSpecial = allDriveFiles.filter(f => {
    const parts = f.path.split('/');
    return parts.some(p => specialFolders.includes(p.toLowerCase()));
  });
  if (filesInSpecial.length > 0) {
    console.log(`\n  ℹ️  Fitxers en carpetes especials (inbox/duplicades/no-factures): ${filesInSpecial.length}`);
    for (const f of filesInSpecial) {
      console.log(`     ${f.path} [id=${f.id}]`);
    }
  }

  // =============================================
  // 6. ORFES BD — Factures a la BD amb gdriveFileId que no existeix al Drive
  // =============================================
  console.log('\n' + '-'.repeat(70));
  console.log('👻 ORFES BD — Factures amb gdriveFileId que NO existeix al Drive');
  console.log('-'.repeat(70));

  const driveFileIds = new Set(allDriveFiles.map(f => f.id));

  const orphanDb = withDriveId.filter(i => !driveFileIds.has(i.gdriveFileId));
  if (orphanDb.length === 0) {
    console.log('  ✅ Tots els gdriveFileId de la BD apunten a fitxers existents al Drive');
  } else {
    console.log(`\n  ⚠️  ${orphanDb.length} factures a la BD amb gdriveFileId INEXISTENT al Drive:\n`);
    for (const inv of orphanDb) {
      console.log(`  📋 id=${inv.id} | ${inv.invoiceNumber} | ${inv.supplier?.name || '—'} | ${parseFloat(inv.totalAmount).toFixed(2)}€ | gdriveFileId=${inv.gdriveFileId} | isDuplicate=${inv.isDuplicate}`);
    }
  }

  // =============================================
  // 7. RESUM FINAL
  // =============================================
  console.log('\n' + '='.repeat(70));
  console.log('📋 RESUM AUDITORIA');
  console.log('='.repeat(70));
  console.log(`  Carpetes al Drive:                    ${allFolders.length}`);
  console.log(`  Fitxers al Drive:                     ${allDriveFiles.length}`);
  console.log(`  Factures a la BD:                     ${dbInvoices.length}`);
  console.log(`  ---`);
  console.log(`  Duplicats al Drive (per nom):         ${driveDuplicates.length} grups`);
  console.log(`  Duplicats a la BD (num+supplier):     ${dbDuplicateGroups.length} grups`);
  console.log(`  Fitxers Drive sense BD (orfes):       ${orphanDrive.length}`);
  console.log(`  Factures BD sense Drive (orfes):      ${orphanDb.length}`);
  console.log(`  Factures marcades isDuplicate:        ${markedDuplicate.length}`);
  console.log(`  Fitxers en carpetes especials:        ${filesInSpecial.length}`);
  console.log('='.repeat(70));

  const hasIssues = driveDuplicates.length > 0 || dbDuplicateGroups.length > 0 || orphanDrive.length > 0 || orphanDb.length > 0;
  if (hasIssues) {
    console.log('\n⚠️  S\'han trobat inconsistències. Revisa els detalls a dalt.');
  } else {
    console.log('\n✅ Tot correcte! Drive i BD estan sincronitzats.');
  }
}

main()
  .catch(e => {
    console.error('❌ Error fatal:', e.message);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
