#!/usr/bin/env node
/**
 * Script per netejar les factures buides creades pel cron de Zoho
 * quan processava correus sense PDF.
 *
 * Esborra:
 *   - Reminders associats a factures ZOHO-* amb source EMAIL_NO_PDF
 *   - ReceivedInvoices amb invoiceNumber ZOHO-* i source EMAIL_NO_PDF
 *
 * Ús: node backend/scripts/cleanup-zoho-empty.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Trobar les factures buides
  const emptyInvoices = await prisma.receivedInvoice.findMany({
    where: {
      invoiceNumber: { startsWith: 'ZOHO-' },
      source: 'EMAIL_NO_PDF',
    },
    select: { id: true, invoiceNumber: true, description: true, createdAt: true },
  });

  console.log(`\nTrobades ${emptyInvoices.length} factures ZOHO buides (EMAIL_NO_PDF):\n`);
  for (const inv of emptyInvoices) {
    console.log(`  - ${inv.invoiceNumber} | ${inv.description || 'sense descripció'} | ${inv.createdAt.toISOString()}`);
  }

  if (emptyInvoices.length === 0) {
    console.log('Res a netejar!');
    return;
  }

  const ids = emptyInvoices.map((i) => i.id);

  // 2. Esborrar reminders associats
  const deletedReminders = await prisma.reminder.deleteMany({
    where: {
      entityType: 'received_invoice',
      entityId: { in: ids },
    },
  });
  console.log(`\nReminders esborrats: ${deletedReminders.count}`);

  // 3. Esborrar les factures buides
  const deletedInvoices = await prisma.receivedInvoice.deleteMany({
    where: {
      id: { in: ids },
    },
  });
  console.log(`Factures buides esborrades: ${deletedInvoices.count}`);

  console.log('\nNeteja completada!');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
