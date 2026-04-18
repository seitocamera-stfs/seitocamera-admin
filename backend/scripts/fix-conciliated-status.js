#!/usr/bin/env node
/**
 * Script per corregir les factures que estan conciliades (tenen un registre
 * a la taula conciliations) però el seu status no és PAID.
 *
 * Ús: node backend/scripts/fix-conciliated-status.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Trobar conciliacions amb factura rebuda que no està PAID
  const receivedToFix = await prisma.conciliation.findMany({
    where: {
      receivedInvoiceId: { not: null },
      receivedInvoice: { status: { not: 'PAID' } },
    },
    include: {
      receivedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });

  console.log(`\nFactures rebudes conciliades amb estat incorrecte: ${receivedToFix.length}`);
  for (const c of receivedToFix) {
    const inv = c.receivedInvoice;
    console.log(`  - ${inv.invoiceNumber} (${inv.status} → PAID)`);
    await prisma.receivedInvoice.update({
      where: { id: inv.id },
      data: { status: 'PAID' },
    });
  }

  // 2. Trobar conciliacions amb factura emesa que no està PAID
  const issuedToFix = await prisma.conciliation.findMany({
    where: {
      issuedInvoiceId: { not: null },
      issuedInvoice: { status: { not: 'PAID' } },
    },
    include: {
      issuedInvoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });

  console.log(`Factures emeses conciliades amb estat incorrecte: ${issuedToFix.length}`);
  for (const c of issuedToFix) {
    const inv = c.issuedInvoice;
    console.log(`  - ${inv.invoiceNumber} (${inv.status} → PAID)`);
    await prisma.issuedInvoice.update({
      where: { id: inv.id },
      data: { status: 'PAID' },
    });
  }

  console.log(`\nCorrecció completada: ${receivedToFix.length + issuedToFix.length} factures actualitzades a PAID`);
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
