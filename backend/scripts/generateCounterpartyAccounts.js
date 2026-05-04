#!/usr/bin/env node
/**
 * Genera subcomptes individuals per a tercers existents:
 *   - Suppliers no-public-admin → subcomptes 4100001, 4100002, ... (parent 410)
 *   - Clients                   → subcomptes 4300001, 4300002, ... (parent 430)
 *   - BankAccounts              → subcomptes 5720001, 5720002, ... (parent 572)
 *
 * Idempotent: si un subcompte amb el mateix nom ja existeix sota el parent,
 * no en crea cap altre.
 *
 * Aquest script només crea els registres a chart_of_accounts. La FK directa
 * Supplier/Client/BankAccount → ChartOfAccount s'afegirà al Sprint 3 (factures)
 * i Sprint 4 (banc), quan tinguem JournalEntry per vincular-ho tot.
 *
 * Executar: node scripts/generateCounterpartyAccounts.js
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');

async function nextCode(companyId, prefix, padLength = 4) {
  const all = await prisma.chartOfAccount.findMany({
    where: { companyId, code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  const numericLen = prefix.length + padLength;
  for (const a of all) {
    if (a.code.length !== numericLen) continue;
    const tail = a.code.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(padLength, '0');
}

async function ensureSubaccount({ companyId, parentCode, prefix, type, subtype, name }) {
  // Buscar si ja existeix amb el mateix nom sota el mateix prefix
  const existing = await prisma.chartOfAccount.findFirst({
    where: { companyId, code: { startsWith: prefix }, name },
  });
  if (existing) return { account: existing, created: false };

  const parent = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId, code: parentCode } },
  });
  if (!parent) {
    throw new Error(`Falta el compte parent ${parentCode}. Cal executar abans seedAccounting.js`);
  }

  const code = await nextCode(companyId, prefix, 4);
  const account = await prisma.chartOfAccount.create({
    data: {
      companyId,
      code,
      name: name.slice(0, 200),
      type,
      subtype,
      level: 3,
      isLeaf: true,
      parentId: parent.id,
      isSystem: false,
    },
  });
  return { account, created: true };
}

async function main() {
  console.log('\n=== Generació de subcomptes per tercers existents ===\n');

  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No hi ha cap empresa configurada. Executa primer: node prisma/seedAccounting.js');
    process.exit(1);
  }
  console.log(`Empresa: ${company.legalName} (${company.id})\n`);

  // ───────── Suppliers (no public admin) ─────────
  const suppliers = await prisma.supplier.findMany({
    where: { isPublicAdmin: false, isActive: true },
    orderBy: { name: 'asc' },
  });
  let supCreated = 0;
  for (const s of suppliers) {
    const { created } = await ensureSubaccount({
      companyId: company.id,
      parentCode: '410',
      prefix: '410',
      type: 'LIABILITY',
      subtype: 'CREDITOR',
      name: s.name,
    });
    if (created) supCreated++;
  }
  console.log(`Suppliers: ${suppliers.length} totals, ${supCreated} subcomptes 410xxxx creats`);

  // ───────── Clients ─────────
  const clients = await prisma.client.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  let cliCreated = 0;
  for (const c of clients) {
    const { created } = await ensureSubaccount({
      companyId: company.id,
      parentCode: '430',
      prefix: '430',
      type: 'ASSET',
      subtype: 'CLIENT',
      name: c.name,
    });
    if (created) cliCreated++;
  }
  console.log(`Clients: ${clients.length} totals, ${cliCreated} subcomptes 430xxxx creats`);

  // ───────── Bank accounts ─────────
  // Cada BankAccount necessita el seu subcompte 572 ÚNIC (no es comparteix)
  // perquè BankAccount.accountId és @unique. Si dos comptes tenen el mateix
  // nom, els distingim amb el id.
  const banks = await prisma.bankAccount.findMany({ orderBy: { name: 'asc' } });
  const parent572 = await prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId: company.id, code: '572' } },
  });
  if (!parent572) throw new Error('Falta el compte 572 al pla. Executa seedAccounting.js');

  let bnkCreated = 0;
  let bnkLinked = 0;
  for (const b of banks) {
    let account;
    if (b.accountId) {
      // Ja vinculat — només refrescar
      account = await prisma.chartOfAccount.findUnique({ where: { id: b.accountId } });
    } else {
      const baseName = b.name || b.iban || `Banc ${b.id.slice(0, 6)}`;
      const accountName = baseName.length > 180 ? baseName.slice(0, 180) : baseName;
      const code = await nextCode(company.id, '572', 4);
      account = await prisma.chartOfAccount.create({
        data: {
          companyId: company.id, code,
          name: `${accountName} (${b.id.slice(-6)})`,
          type: 'ASSET', subtype: 'BANK',
          level: 3, isLeaf: true,
          parentId: parent572.id, isSystem: false,
        },
      });
      bnkCreated++;
      await prisma.bankAccount.update({ where: { id: b.id }, data: { accountId: account.id } });
      bnkLinked++;
    }
  }
  console.log(`Bank accounts: ${banks.length} totals, ${bnkCreated} subcomptes 572xxxx creats, ${bnkLinked} vinculats`);

  console.log('\nFet.\n');
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
