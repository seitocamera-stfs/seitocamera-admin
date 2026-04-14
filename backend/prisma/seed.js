const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Crear usuari admin per defecte
  // IMPORTANT: Canvia aquesta contrasenya després del primer login!
  const adminPassword = await bcrypt.hash('Admin2026!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@seitocamera.com' },
    update: { passwordHash: adminPassword },
    create: {
      email: 'admin@seitocamera.com',
      name: 'Sergi (Admin)',
      passwordHash: adminPassword,
      role: 'ADMIN',
    },
  });
  console.log(`Usuari admin creat: ${admin.email}`);

  // Alguns proveïdors de mostra
  const suppliers = [
    { name: 'Canon Espanya', nif: 'A12345678', email: 'factures@canon.es' },
    { name: 'Sony Iberia', nif: 'B87654321', email: 'billing@sony.es' },
    { name: 'Sigma Europe', nif: 'W98765432', email: 'invoices@sigma-global.com' },
  ];

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { nif: supplier.nif },
      update: {},
      create: supplier,
    });
  }
  console.log(`${suppliers.length} proveïdors creats`);

  // Alguns clients de mostra
  const clients = [
    { name: 'Estudi Fotogràfic BCN', nif: 'B11111111', email: 'info@estudibcn.com' },
    { name: 'Produccions Visuals SL', nif: 'B22222222', email: 'admin@prodvisuals.com' },
  ];

  for (const client of clients) {
    await prisma.client.upsert({
      where: { nif: client.nif },
      update: {},
      create: client,
    });
  }
  console.log(`${clients.length} clients creats`);

  console.log('Seed completat!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
