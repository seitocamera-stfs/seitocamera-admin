#!/usr/bin/env node
/**
 * Script de neteja de duplicats:
 * 1. Mou TOTS els fitxers de duplicades/ → inbox/
 * 2. Elimina TOTS els registres isDuplicate=true de la BD
 * 3. Neteja les claus Redis de fitxers processats
 * 4. Opcional: també re-processa factures amb números erronis (NIF, GDRIVE-, 2006/112)
 *
 * El cron de GDrive sync reprocessarà tot amb la lògica millorada.
 *
 * EXECUTAR: node scripts/fix-duplicades.js
 * MODE SEC (sense canvis): node scripts/fix-duplicades.js --dry-run
 */
require('dotenv').config();

const { prisma } = require('../src/config/database');
const { redis } = require('../src/config/redis');
const gdrive = require('../src/services/gdriveService');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) console.log('🔍 MODE SEC — no es farà cap canvi\n');
  console.log('=== NETEJA DE DUPLICATS I NÚMEROS ERRONIS ===\n');

  const drive = gdrive.getDriveClient();
  const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');
  const dupFolder = await gdrive.findOrCreateFolder('duplicades', facturesRebudesId);
  const inboxFolder = await gdrive.findOrCreateFolder('inbox', facturesRebudesId);

  // ============================================
  // PART 1: Moure fitxers de duplicades/ → inbox/
  // ============================================
  console.log('1) Movent fitxers de duplicades/ → inbox/...');

  const gdriveRes = await drive.files.list({
    q: `'${dupFolder.id}' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 500,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const dupFiles = gdriveRes.data.files || [];
  console.log(`   ${dupFiles.length} fitxers a duplicades/`);

  let movedCount = 0;
  for (const file of dupFiles) {
    try {
      if (!DRY_RUN) {
        await drive.files.update({
          fileId: file.id,
          addParents: inboxFolder.id,
          removeParents: dupFolder.id,
          fields: 'id, name, parents',
          supportsAllDrives: true,
        });
      }
      movedCount++;
    } catch (err) {
      console.log(`   ✗ Error movent ${file.name}: ${err.message}`);
    }
  }
  console.log(`   ${DRY_RUN ? 'Mourien' : 'Moguts'}: ${movedCount} fitxers\n`);

  // ============================================
  // PART 2: Eliminar registres duplicat de BD
  // ============================================
  console.log('2) Eliminant registres isDuplicate=true de BD...');

  const dupRecords = await prisma.receivedInvoice.findMany({
    where: { isDuplicate: true },
    select: { id: true, gdriveFileId: true, originalFileName: true },
  });

  console.log(`   ${dupRecords.length} registres duplicat a BD`);

  if (!DRY_RUN && dupRecords.length > 0) {
    // Primer eliminar recordatoris associats
    const dupIds = dupRecords.map(d => d.id);
    const deletedReminders = await prisma.reminder.deleteMany({
      where: { entityType: 'received_invoice', entityId: { in: dupIds } },
    });
    console.log(`   ${deletedReminders.count} recordatoris eliminats`);

    // Eliminar factures duplicades
    const deleted = await prisma.receivedInvoice.deleteMany({
      where: { isDuplicate: true },
    });
    console.log(`   ${deleted.count} registres duplicat eliminats`);
  }

  // ============================================
  // PART 3: Identificar i netejar factures amb números erronis
  // ============================================
  console.log('\n3) Identificant factures amb números erronis...');

  // Números que sabem que són incorrectes
  const badNumbers = await prisma.receivedInvoice.findMany({
    where: {
      OR: [
        { invoiceNumber: { equals: 'NIF', mode: 'insensitive' } },
        { invoiceNumber: { equals: 'Factura', mode: 'insensitive' } },
        { invoiceNumber: { startsWith: 'GDRIVE-' } },
        { invoiceNumber: { equals: '2006/112' } },
        { invoiceNumber: { equals: '2006-112' } },
        { invoiceNumber: { equals: 'A26/C', mode: 'insensitive' } },
        { invoiceNumber: { startsWith: 'A26/Descripci' } },
      ],
    },
    select: { id: true, invoiceNumber: true, gdriveFileId: true, originalFileName: true, totalAmount: true },
  });

  console.log(`   ${badNumbers.length} factures amb números erronis trobades`);

  // Comptar per tipus
  const nifCount = badNumbers.filter(b => b.invoiceNumber.toUpperCase() === 'NIF').length;
  const gdriveCount = badNumbers.filter(b => b.invoiceNumber.startsWith('GDRIVE-')).length;
  const euDirCount = badNumbers.filter(b => b.invoiceNumber.includes('2006/112') || b.invoiceNumber.includes('2006-112')).length;
  const a26cCount = badNumbers.filter(b => b.invoiceNumber.toUpperCase().startsWith('A26/C')).length;
  const facturaCount = badNumbers.filter(b => b.invoiceNumber.toUpperCase() === 'FACTURA').length;

  console.log(`     "NIF": ${nifCount}`);
  console.log(`     "GDRIVE-": ${gdriveCount}`);
  console.log(`     "2006/112": ${euDirCount}`);
  console.log(`     "A26/C" truncat: ${a26cCount}`);
  console.log(`     "Factura": ${facturaCount}`);

  // Per les factures amb números erronis que tenen fitxer GDrive:
  // Moure-les a inbox per reprocessar
  const toReprocess = badNumbers.filter(b => b.gdriveFileId);
  console.log(`   ${toReprocess.length} amb fitxer GDrive — seran reprocessades`);

  // Primer, trobar en quina carpeta està cada fitxer i moure'l a inbox
  let reprocessMoved = 0;
  for (const inv of toReprocess) {
    try {
      // Comprovar que el fitxer existeix i obtenir parent
      const fileInfo = await drive.files.get({
        fileId: inv.gdriveFileId,
        fields: 'id, name, parents',
        supportsAllDrives: true,
      });

      const currentParent = fileInfo.data.parents?.[0];
      if (currentParent === inboxFolder.id) continue; // Ja a inbox

      if (!DRY_RUN) {
        await drive.files.update({
          fileId: inv.gdriveFileId,
          addParents: inboxFolder.id,
          removeParents: currentParent,
          fields: 'id',
          supportsAllDrives: true,
        });
      }
      reprocessMoved++;
    } catch (err) {
      // Fitxer potser ja no existeix
      if (err.code === 404) {
        console.log(`   Fitxer no trobat: ${inv.originalFileName} (${inv.gdriveFileId})`);
      }
    }
  }
  console.log(`   ${DRY_RUN ? 'Mourien' : 'Moguts'} a inbox: ${reprocessMoved}`);

  // Eliminar els registres erronis de BD
  if (!DRY_RUN && badNumbers.length > 0) {
    const badIds = badNumbers.map(b => b.id);

    // Eliminar recordatoris associats
    const delRem = await prisma.reminder.deleteMany({
      where: { entityType: 'received_invoice', entityId: { in: badIds } },
    });
    console.log(`   ${delRem.count} recordatoris eliminats`);

    // Eliminar factures
    const del = await prisma.receivedInvoice.deleteMany({
      where: { id: { in: badIds } },
    });
    console.log(`   ${del.count} registres erronis eliminats de BD`);
  }

  // ============================================
  // PART 4: Netejar claus Redis processats
  // ============================================
  console.log('\n4) Netejant claus Redis de fitxers processats...');

  // Netejar totes les claus gdrive:processed:* perquè es reprocessin
  let redisCleared = 0;
  try {
    const keys = await redis.keys('gdrive:processed:*');
    if (keys.length > 0 && !DRY_RUN) {
      await redis.del(...keys);
    }
    redisCleared = keys.length;
    console.log(`   ${DRY_RUN ? 'Netejarien' : 'Netejades'}: ${redisCleared} claus Redis`);
  } catch (err) {
    console.log(`   Error netejant Redis: ${err.message}`);
  }

  // ============================================
  // RESUM
  // ============================================
  console.log('\n=== RESUM ===');
  console.log(`Fitxers moguts duplicades/ → inbox/: ${movedCount}`);
  console.log(`Registres duplicat eliminats: ${dupRecords.length}`);
  console.log(`Factures amb nº erròni reprocessades: ${badNumbers.length}`);
  console.log(`Claus Redis netejades: ${redisCleared}`);

  if (DRY_RUN) {
    console.log('\n⚠ MODE SEC — cap canvi real. Executa sense --dry-run per aplicar.');
  } else {
    console.log('\n✓ Tot net. El cron reprocessarà els fitxers de inbox/ amb la lògica millorada.');
    console.log('  O executa manualment: node -e \'require("dotenv").config(); require("./src/jobs/gdriveSyncJob").syncGdriveFiles().then(r => { console.log(r); process.exit(); })\'');
  }

  await prisma.$disconnect();
  await redis.quit();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
