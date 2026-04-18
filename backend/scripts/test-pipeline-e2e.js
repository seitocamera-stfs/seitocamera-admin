#!/usr/bin/env node
/**
 * Test end-to-end: Zoho Email → Download PDF → Upload GDrive → Mark Read → Move to FACTURA REBUDA
 *
 * Executa des de backend/:
 *   node scripts/test-pipeline-e2e.js
 */
require('dotenv').config();

const zohoMail = require('../src/services/zohoMailService');
const gdrive = require('../src/services/gdriveService');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLEANUP_GDRIVE = true; // Esborra el fitxer test de GDrive després de pujar

async function testFullPipeline() {
  console.log('=== TEST END-TO-END: Email → PDF → GDrive → Mark Read → Move ===\n');

  // ---- STEP 1: Scan ----
  console.log('1) Escanejant correus amb PDF adjunt (últims 7 dies)...');
  const results = await zohoMail.scanForInvoices({
    since: new Date(Date.now() - 7 * 24 * 3600 * 1000),
    limit: 20,
  });

  let pdfEmails = results.filter(
    (e) => e.classification === 'PDF_ATTACHED' && e.pdfAttachments && e.pdfAttachments.length > 0
  );
  console.log(`   ${results.length} correus escanejats, ${pdfEmails.length} amb PDF_ATTACHED`);

  if (pdfEmails.length === 0) {
    const withAtt = results.filter((e) => e.pdfAttachments && e.pdfAttachments.length > 0);
    console.log(`   Cap PDF_ATTACHED. ${withAtt.length} amb attachments PDF genèrics`);
    if (withAtt.length === 0) {
      console.log('   ⚠ No hi ha correus amb PDF els últims 7 dies. Test acabat.');
      process.exit(0);
    }
    pdfEmails = [withAtt[0]];
  }

  const testEmail = pdfEmails[0];
  const att = testEmail.pdfAttachments[0];
  console.log(`   Email: ${testEmail.emailMeta.from} — ${testEmail.emailMeta.subject}`);
  console.log(`   Attachment: ${att.fileName} (${att.size || '?'} bytes)`);
  console.log(`   Carpeta: ${testEmail.folderPath} (ID: ${testEmail.folderId})`);
  console.log(`   Message ID: ${testEmail.messageId}\n`);

  // ---- STEP 2: Download ----
  console.log('2) Descarregant PDF...');
  const buffer = await zohoMail.downloadAttachment(testEmail.folderId, testEmail.messageId, att.attachmentId);
  const header = buffer.slice(0, 5).toString('utf-8');
  console.log(`   ${buffer.length} bytes descarregats`);
  console.log(`   Signatura PDF: "${header}" ${header === '%PDF-' ? '✓' : '✗ WARN'}\n`);

  if (buffer.length < 100) {
    console.error('   ✗ FAIL: Buffer massa petit');
    process.exit(1);
  }

  // ---- STEP 3: Upload to GDrive ----
  console.log('3) Pujant a GDrive factures-rebudes/inbox/...');
  const facturesId = await gdrive.getSubfolderId('factures-rebudes');
  const inboxFolder = await gdrive.findOrCreateFolder('inbox', facturesId);
  console.log(`   factures-rebudes: ${facturesId}`);
  console.log(`   inbox: ${inboxFolder.id}`);

  const drive = gdrive.getDriveClient();
  const tmpDir = path.join(os.tmpdir(), 'seitocamera-zoho-test');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const testFileName = 'TEST_PIPELINE_' + att.fileName;
  const safeName = testFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = path.join(tmpDir, safeName);
  fs.writeFileSync(tmpPath, buffer);

  const uploadResult = await drive.files.create({
    resource: { name: testFileName, parents: [inboxFolder.id] },
    media: { mimeType: 'application/pdf', body: fs.createReadStream(tmpPath) },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  console.log(`   ✓ Pujat: ${uploadResult.data.name} (ID: ${uploadResult.data.id})`);

  // Cleanup
  if (CLEANUP_GDRIVE) {
    try {
      await drive.files.delete({ fileId: uploadResult.data.id, supportsAllDrives: true });
      console.log('   Fitxer test esborrat de GDrive');
    } catch (e) {
      console.log('   Nota: no s\'ha pogut esborrar el test: ' + e.message);
    }
  }
  fs.unlinkSync(tmpPath);
  console.log();

  // ---- STEP 4: Mark as read ----
  console.log('4) Marcant com a llegit...');
  const readResult = await zohoMail.markAsRead(testEmail.messageId);
  const readOk = readResult?.status?.code === 200;
  console.log(`   ${readOk ? '✓' : '✗'} Resultat: ${JSON.stringify(readResult)}\n`);

  // ---- STEP 5: Move to FACTURA REBUDA ----
  console.log('5) Movent a FACTURA REBUDA...');
  if (testEmail.folderPath && testEmail.folderPath.toUpperCase().includes('FACTURA')) {
    console.log(`   ⊘ Ja es troba a carpeta FACTURA (${testEmail.folderPath})\n`);
  } else {
    try {
      const facturaFolderId = await zohoMail.getFolderId('FACTURA REBUDA');
      console.log(`   FACTURA REBUDA ID: ${facturaFolderId}`);
      const moveResult = await zohoMail.moveMessage(testEmail.messageId, facturaFolderId);
      const moveOk = moveResult?.status?.code === 200;
      console.log(`   ${moveOk ? '✓' : '✗'} Resultat: ${JSON.stringify(moveResult)}\n`);
    } catch (moveErr) {
      console.log(`   ✗ Error: ${moveErr.message}\n`);
    }
  }

  console.log('=== PIPELINE TEST COMPLETAT ===');
}

testFullPipeline()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
