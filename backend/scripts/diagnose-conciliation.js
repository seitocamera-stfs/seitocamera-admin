#!/usr/bin/env node
/**
 * Script de diagnòstic per entendre per què la conciliació no funciona.
 * Analitza el cas KINOLUX i qualsevol altre moviment orfe.
 *
 * Ús: node backend/scripts/diagnose-conciliation.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Buscar la factura KINOLUX
  console.log('=== DIAGNÒSTIC CONCILIACIÓ ===\n');

  const kinolux = await prisma.receivedInvoice.findMany({
    where: {
      supplier: { name: { contains: 'kinolux', mode: 'insensitive' } },
    },
    include: {
      supplier: { select: { name: true } },
      conciliations: { include: { bankMovement: true } },
    },
    orderBy: { issueDate: 'desc' },
    take: 10,
  });

  console.log(`--- Factures KINOLUX (últimes 10) ---`);
  for (const inv of kinolux) {
    console.log(`  ${inv.invoiceNumber} | ${inv.totalAmount}€ | status: ${inv.status} | conciliacions: ${inv.conciliations.length}`);
    if (inv.conciliations.length > 0) {
      for (const c of inv.conciliations) {
        console.log(`    → Conciliació: ${c.status} | moviment: ${c.bankMovement.description} (${c.bankMovement.amount}€) | isConciliated: ${c.bankMovement.isConciliated}`);
      }
    }
  }

  // 2. Buscar moviments bancaris amb contrapart KINOLUX
  console.log(`\n--- Moviments bancaris amb KINOLUX ---`);
  const kinoluxMovements = await prisma.bankMovement.findMany({
    where: {
      OR: [
        { counterparty: { contains: 'kinolux', mode: 'insensitive' } },
        { description: { contains: 'kinolux', mode: 'insensitive' } },
      ],
    },
    include: { conciliations: true },
    orderBy: { date: 'desc' },
    take: 10,
  });

  for (const m of kinoluxMovements) {
    console.log(`  ${m.date.toISOString().slice(0, 10)} | ${m.counterparty} | ${m.amount}€ | type: ${m.type} | isConciliated: ${m.isConciliated} | conciliacions: ${m.conciliations.length}`);
    if (m.conciliations.length > 0) {
      for (const c of m.conciliations) {
        console.log(`    → Conciliació: ${c.status} | receivedInvoiceId: ${c.receivedInvoiceId}`);
      }
    }
  }

  // 3. Stats generals de moviments orfes
  console.log(`\n--- Estadístiques generals ---`);

  const totalMovements = await prisma.bankMovement.count();
  const conciliated = await prisma.bankMovement.count({ where: { isConciliated: true } });
  const withConcRecord = await prisma.bankMovement.count({ where: { conciliations: { some: {} } } });
  const orphaned = await prisma.bankMovement.count({
    where: { isConciliated: true, conciliations: { none: {} } },
  });
  const transfers = await prisma.bankMovement.count({
    where: {
      isConciliated: true,
      conciliations: { none: {} },
      OR: [
        { operationType: 'transfer' },
        { description: { contains: 'Internal transfer', mode: 'insensitive' } },
        { counterparty: { contains: 'SEITO CAMERA', mode: 'insensitive' } },
      ],
    },
  });

  console.log(`  Total moviments: ${totalMovements}`);
  console.log(`  isConciliated=true: ${conciliated}`);
  console.log(`  Amb registre Conciliation: ${withConcRecord}`);
  console.log(`  Orfes (isConciliated=true, sense Conciliation): ${orphaned}`);
  console.log(`  D'aquests, transferències internes: ${transfers}`);
  console.log(`  Orfes NO-transferència (els que l'auto-conciliació intenta processar): ${orphaned - transfers}`);

  // 4. Mostra 5 exemples d'orfes no-transferència per entendre'ls
  const orphanExamples = await prisma.bankMovement.findMany({
    where: {
      isConciliated: true,
      conciliations: { none: {} },
      operationType: { notIn: ['transfer'] },
      NOT: [
        { description: { contains: 'Internal transfer', mode: 'insensitive' } },
        { counterparty: { contains: 'SEITO CAMERA', mode: 'insensitive' } },
      ],
    },
    orderBy: { date: 'desc' },
    take: 5,
  });

  console.log(`\n--- Exemples de moviments orfes (non-transfer) ---`);
  for (const m of orphanExamples) {
    const absAmount = Math.abs(parseFloat(m.amount));
    // Buscar factures amb import similar
    const matchingInvoices = await prisma.receivedInvoice.findMany({
      where: {
        totalAmount: { gte: absAmount - 0.02, lte: absAmount + 0.02 },
      },
      include: { supplier: { select: { name: true } }, conciliations: { select: { id: true } } },
    });
    const available = matchingInvoices.filter(i => i.conciliations.length === 0);

    console.log(`  ${m.date.toISOString().slice(0, 10)} | ${m.counterparty || m.description} | ${m.amount}€ | type: ${m.type} | opType: ${m.operationType}`);
    console.log(`    Factures amb import similar: ${matchingInvoices.length} (sense conciliació: ${available.length})`);
    for (const inv of matchingInvoices.slice(0, 3)) {
      console.log(`      - ${inv.supplier?.name}: ${inv.invoiceNumber} (${inv.totalAmount}€) conciliacions: ${inv.conciliations.length}`);
    }
  }

  // 5. Específicament: KINOLUX 26-00184
  console.log(`\n--- Cas específic: KINOLUX 26-00184 ---`);
  const kinoluxInv = await prisma.receivedInvoice.findFirst({
    where: { invoiceNumber: { contains: '26-00184' } },
    include: {
      supplier: { select: { name: true } },
      conciliations: { include: { bankMovement: true } },
    },
  });

  if (kinoluxInv) {
    console.log(`  Factura: ${kinoluxInv.invoiceNumber} | ${kinoluxInv.totalAmount}€ | status: ${kinoluxInv.status}`);
    console.log(`  Conciliacions: ${kinoluxInv.conciliations.length}`);

    const amount = parseFloat(kinoluxInv.totalAmount);
    // Buscar moviments amb import similar
    const matchingMovements = await prisma.bankMovement.findMany({
      where: {
        OR: [
          { amount: { gte: -amount - 0.02, lte: -amount + 0.02 } },
          { amount: { gte: amount - 0.02, lte: amount + 0.02 } },
        ],
      },
      include: { conciliations: true },
    });

    console.log(`  Moviments amb import similar (±${amount}€): ${matchingMovements.length}`);
    for (const m of matchingMovements) {
      console.log(`    ${m.date.toISOString().slice(0, 10)} | ${m.counterparty} | ${m.amount}€ | isConciliated: ${m.isConciliated} | conciliacions: ${m.conciliations.length} | type: ${m.type}`);
    }
  } else {
    console.log('  No trobada!');
  }
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
