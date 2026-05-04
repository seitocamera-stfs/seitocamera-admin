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
  const banks = await prisma.bankAccount.findMany({
    orderBy: { name: 'asc' },
  });
  let bnkCreated = 0;
  for (const b of banks) {
    const { created } = await ensureSubaccount({
      companyId: company.id,
      parentCode: '572',
      prefix: '572',
      type: 'ASSET',
      subtype: 'BANK',
      name: b.name || b.iban || `Banc ${b.id.slice(0, 6)}`,
    });
    if (created) bnkCreated++;
  }
  console.log(`Bank accounts: ${banks.length} totals, ${bnkCreated} subcomptes 572xxxx creats`);

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
