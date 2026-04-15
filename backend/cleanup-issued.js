require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  // 1. Esborrar conciliacions vinculades a factures emeses
  const delConc = await prisma.conciliation.deleteMany({
    where: { issuedInvoiceId: { not: null } },
  });
  console.log('Conciliacions esborrades:', delConc.count);

  // 2. Esborrar totes les factures emeses
  const delInv = await prisma.issuedInvoice.deleteMany();
  console.log('Factures emeses esborrades:', delInv.count);

  // 3. Esborrar clients que no tenen factures (orfes de Rentman)
  const orphanClients = await prisma.client.findMany({
    where: { issuedInvoices: { none: {} } },
    select: { id: true, name: true },
  });

  let clientsDeleted = 0;
  for (const c of orphanClients) {
    try {
      await prisma.client.delete({ where: { id: c.id } });
      clientsDeleted++;
    } catch (e) {
      // Pot tenir altres relacions
    }
  }
  console.log('Clients orfes esborrats:', clientsDeleted);

  console.log('\nFet. Ara pots reimportar amb: curl -X POST http://localhost:4000/api/rentman/sync/invoices');
  await prisma.$disconnect();
  process.exit(0);
}

cleanup().catch(e => { console.error(e); process.exit(1); });
