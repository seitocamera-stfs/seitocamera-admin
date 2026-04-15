require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const gdrive = require('./src/services/gdriveService');
const pdfExtract = require('./src/services/pdfExtractService');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const invoices = await prisma.receivedInvoice.findMany({
    select: { id: true, invoiceNumber: true, gdriveFileId: true, originalFileName: true },
    orderBy: { issueDate: 'desc' },
  });

  for (const inv of invoices) {
    if (!inv.gdriveFileId) continue;
    console.log('\n========================================');
    console.log('Fitxer:', inv.originalFileName);
    console.log('Detectat com:', inv.invoiceNumber);
    console.log('========================================');
    try {
      const tmp = path.join(os.tmpdir(), 'analyze_' + Date.now() + '.pdf');
      await gdrive.downloadFile(inv.gdriveFileId, tmp);
      const result = await pdfExtract.analyzePdf(tmp);
      console.log('Numero:', result.invoiceNumber);
      console.log('NIF:', result.nifCif);
      console.log('Total:', result.totalAmount);
      console.log('Data:', result.invoiceDate);
      console.log('Proveidor:', result.supplierName);
      console.log('OCR:', result.ocrUsed);
      console.log('--- TEXT (primers 1200 chars) ---');
      console.log((result.text || '').substring(0, 1200));
      fs.unlinkSync(tmp);
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
  await prisma.$disconnect();
  process.exit(0);
})();
