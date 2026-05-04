/**
 * Seed: Fonaments del mòdul de comptabilitat
 * - Empresa per defecte (Seito)
 * - Exercici comptable de l'any en curs
 * - Pla General Comptable PYMES (subcomptes mestres)
 *
 * Executar: node prisma/seedAccounting.js
 * És idempotent: es pot rellançar sense duplicar dades.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===========================================
// PGC PYMES — subcomptes mestres
// ===========================================
// Estructura:
//   Grup (1 dígit)    → level 0, isLeaf=false
//   Subgrup (2 dígits) → level 1, isLeaf=false
//   Compte (3 dígits)  → level 2, isLeaf=false (en general)
//   Subcompte (4+ dígits) → level 3, isLeaf=true (utilitzable en apunts)
//
// El camp `taxBookType` marca els comptes que han d'aparèixer als llibres
// d'IVA suportat / repercutit / IRPF (calcul automatitzat de 303/390/111).
//
// Subcomptes 4xxxxxx (proveïdors/clients individuals) NO van al seed:
// es generen dinàmicament un cop per cada Supplier/Client (Sprint 1, pas 7).

const ACCOUNTS = [
  // ───────── GRUPS (level 0) ─────────
  { code: '1', name: 'Finançament bàsic', type: 'EQUITY', level: 0, isLeaf: false },
  { code: '2', name: 'Actiu no corrent', type: 'ASSET', level: 0, isLeaf: false },
  { code: '4', name: 'Creditors i deutors per operacions comercials', type: 'ASSET', level: 0, isLeaf: false },
  { code: '5', name: 'Comptes financers', type: 'ASSET', level: 0, isLeaf: false },
  { code: '6', name: 'Compres i despeses', type: 'EXPENSE', level: 0, isLeaf: false },
  { code: '7', name: 'Vendes i ingressos', type: 'INCOME', level: 0, isLeaf: false },

  // ───────── GRUP 1 — Patrimoni net (subgrup 10, 11, 12) ─────────
  { code: '10', name: 'Capital', type: 'EQUITY', level: 1, isLeaf: false },
  { code: '11', name: 'Reserves', type: 'EQUITY', level: 1, isLeaf: false },
  { code: '12', name: 'Resultats pendents d\'aplicació', type: 'EQUITY', level: 1, isLeaf: false },
  { code: '100', name: 'Capital social', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'CAPITAL' },
  { code: '100000', name: 'Capital social', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'CAPITAL' },
  { code: '112', name: 'Reserva legal', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'RESERVES' },
  { code: '112000', name: 'Reserva legal', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'RESERVES' },
  { code: '113', name: 'Reserves voluntàries', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'RESERVES' },
  { code: '113000', name: 'Reserves voluntàries', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'RESERVES' },
  { code: '120', name: 'Romanent', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'RETAINED_EARNINGS' },
  { code: '120000', name: 'Romanent', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'RETAINED_EARNINGS' },
  { code: '121', name: 'Resultats negatius d\'exercicis anteriors', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'RETAINED_EARNINGS' },
  { code: '121000', name: 'Resultats negatius d\'exercicis anteriors', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'RETAINED_EARNINGS' },
  { code: '129', name: 'Resultat de l\'exercici', type: 'EQUITY', level: 2, isLeaf: false, subtype: 'YEAR_RESULT' },
  { code: '129000', name: 'Resultat de l\'exercici', type: 'EQUITY', level: 3, isLeaf: true, subtype: 'YEAR_RESULT' },

  // ───────── GRUP 2 — Immobilitzat (subgrup 21, 28) ─────────
  { code: '21', name: 'Immobilitzat material', type: 'ASSET', level: 1, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '213', name: 'Maquinària', type: 'ASSET', level: 2, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '213000', name: 'Maquinària', type: 'ASSET', level: 3, isLeaf: true, subtype: 'FIXED_ASSET' },
  { code: '216', name: 'Mobiliari', type: 'ASSET', level: 2, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '216000', name: 'Mobiliari', type: 'ASSET', level: 3, isLeaf: true, subtype: 'FIXED_ASSET' },
  { code: '217', name: 'Equips per a processos d\'informació', type: 'ASSET', level: 2, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '217000', name: 'Equips per a processos d\'informació', type: 'ASSET', level: 3, isLeaf: true, subtype: 'FIXED_ASSET' },
  { code: '218', name: 'Elements de transport', type: 'ASSET', level: 2, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '218000', name: 'Elements de transport', type: 'ASSET', level: 3, isLeaf: true, subtype: 'FIXED_ASSET' },
  { code: '219', name: 'Altre immobilitzat material', type: 'ASSET', level: 2, isLeaf: false, subtype: 'FIXED_ASSET' },
  { code: '219000', name: 'Altre immobilitzat material', type: 'ASSET', level: 3, isLeaf: true, subtype: 'FIXED_ASSET' },

  { code: '28', name: 'Amortització acumulada de l\'immobilitzat', type: 'ASSET', level: 1, isLeaf: false, subtype: 'AMORTIZATION_ACCUM' },
  { code: '281', name: 'Amortització acumulada de l\'immobilitzat material', type: 'ASSET', level: 2, isLeaf: false, subtype: 'AMORTIZATION_ACCUM' },
  { code: '2813', name: 'Amortització acumulada de maquinària', type: 'ASSET', level: 3, isLeaf: true, subtype: 'AMORTIZATION_ACCUM' },
  { code: '2816', name: 'Amortització acumulada de mobiliari', type: 'ASSET', level: 3, isLeaf: true, subtype: 'AMORTIZATION_ACCUM' },
  { code: '2817', name: 'Amortització acumulada d\'equips per a processos d\'informació', type: 'ASSET', level: 3, isLeaf: true, subtype: 'AMORTIZATION_ACCUM' },
  { code: '2818', name: 'Amortització acumulada d\'elements de transport', type: 'ASSET', level: 3, isLeaf: true, subtype: 'AMORTIZATION_ACCUM' },
  { code: '2819', name: 'Amortització acumulada d\'altre immobilitzat material', type: 'ASSET', level: 3, isLeaf: true, subtype: 'AMORTIZATION_ACCUM' },

  // ───────── GRUP 4 — Creditors i deutors (subgrup 40, 41, 43, 46, 47) ─────────
  { code: '40', name: 'Proveïdors', type: 'LIABILITY', level: 1, isLeaf: false, subtype: 'SUPPLIER' },
  { code: '400', name: 'Proveïdors', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'SUPPLIER' },
  // Subcomptes 4000xxxx es generen dinàmicament per cada Supplier no-public-admin

  { code: '41', name: 'Creditors per prestació de serveis', type: 'LIABILITY', level: 1, isLeaf: false, subtype: 'CREDITOR' },
  { code: '410', name: 'Creditors per prestació de serveis', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'CREDITOR' },
  // Subcomptes 4100xxxx es generen dinàmicament

  { code: '43', name: 'Clients', type: 'ASSET', level: 1, isLeaf: false, subtype: 'CLIENT' },
  { code: '430', name: 'Clients', type: 'ASSET', level: 2, isLeaf: false, subtype: 'CLIENT' },
  // Subcomptes 4300xxxx es generen dinàmicament
  { code: '432', name: 'Clients, factura pendent emetre', type: 'ASSET', level: 2, isLeaf: false, subtype: 'CLIENT' },
  { code: '432000', name: 'Clients, factura pendent emetre', type: 'ASSET', level: 3, isLeaf: true, subtype: 'CLIENT' },

  { code: '46', name: 'Personal', type: 'ASSET', level: 1, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '460', name: 'Avançaments de remuneracions', type: 'ASSET', level: 2, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '460000', name: 'Avançaments de remuneracions', type: 'ASSET', level: 3, isLeaf: true, subtype: 'PERSONNEL' },
  { code: '465', name: 'Remuneracions pendents de pagament', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '465000', name: 'Remuneracions pendents de pagament', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'PERSONNEL' },

  { code: '47', name: 'Administracions Públiques', type: 'LIABILITY', level: 1, isLeaf: false, subtype: 'PUBLIC_ADMIN' },
  { code: '470', name: 'Hisenda Pública, deutora per diversos conceptes', type: 'ASSET', level: 2, isLeaf: false, subtype: 'PUBLIC_ADMIN' },
  { code: '4709', name: 'Hisenda Pública, deutora per IVA', type: 'ASSET', level: 3, isLeaf: true, subtype: 'PUBLIC_ADMIN' },
  { code: '472', name: 'Hisenda Pública, IVA suportat', type: 'ASSET', level: 2, isLeaf: false, subtype: 'VAT_INPUT', taxBookType: 'VAT_INPUT' },
  { code: '472000', name: 'Hisenda Pública, IVA suportat', type: 'ASSET', level: 3, isLeaf: true, subtype: 'VAT_INPUT', taxBookType: 'VAT_INPUT', defaultVatRate: 21 },
  { code: '475', name: 'Hisenda Pública, creditora per conceptes fiscals', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'PUBLIC_ADMIN' },
  { code: '4750', name: 'Hisenda Pública, creditora per IVA', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'PUBLIC_ADMIN' },
  { code: '4751', name: 'Hisenda Pública, creditora per retencions practicades', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'IRPF_PRACTICED', taxBookType: 'IRPF' },
  { code: '4752', name: 'Hisenda Pública, creditora per Impost de societats', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'CORPORATE_TAX' },
  { code: '476', name: 'Organismes de la Seguretat Social, creditors', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'PUBLIC_ADMIN' },
  { code: '476000', name: 'Organismes de la Seguretat Social, creditors', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'PUBLIC_ADMIN' },
  { code: '477', name: 'Hisenda Pública, IVA repercutit', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'VAT_OUTPUT', taxBookType: 'VAT_OUTPUT' },
  { code: '477000', name: 'Hisenda Pública, IVA repercutit', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'VAT_OUTPUT', taxBookType: 'VAT_OUTPUT', defaultVatRate: 21 },

  // ───────── GRUP 5 — Comptes financers (subgrup 52, 57) ─────────
  { code: '52', name: 'Deutes a curt termini per préstecs rebuts', type: 'LIABILITY', level: 1, isLeaf: false, subtype: 'SHORT_TERM_DEBT' },
  { code: '520', name: 'Deutes a curt termini amb entitats de crèdit', type: 'LIABILITY', level: 2, isLeaf: false, subtype: 'SHORT_TERM_DEBT' },
  { code: '520000', name: 'Deutes a curt termini amb entitats de crèdit', type: 'LIABILITY', level: 3, isLeaf: true, subtype: 'SHORT_TERM_DEBT' },

  { code: '57', name: 'Tresoreria', type: 'ASSET', level: 1, isLeaf: false, subtype: 'CASH' },
  { code: '570', name: 'Caixa', type: 'ASSET', level: 2, isLeaf: false, subtype: 'CASH' },
  { code: '570000', name: 'Caixa, euros', type: 'ASSET', level: 3, isLeaf: true, subtype: 'CASH' },
  { code: '572', name: 'Bancs i institucions de crèdit c/c vista, euros', type: 'ASSET', level: 2, isLeaf: false, subtype: 'BANK' },
  // Subcomptes 572xxxx es generen un per BankAccount

  // ───────── GRUP 6 — Despeses (subgrup 62, 63, 64, 66, 67, 68, 69) ─────────
  { code: '62', name: 'Serveis exteriors', type: 'EXPENSE', level: 1, isLeaf: false },
  { code: '621', name: 'Arrendaments i cànons', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '621000', name: 'Arrendaments i cànons', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '622', name: 'Reparacions i conservació', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '622000', name: 'Reparacions i conservació', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '623', name: 'Serveis professionals independents', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '623000', name: 'Serveis professionals independents', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '624', name: 'Transports', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '624000', name: 'Transports', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '625', name: 'Primes d\'assegurances', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '625000', name: 'Primes d\'assegurances', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 0 },
  { code: '626', name: 'Serveis bancaris i similars', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '626000', name: 'Serveis bancaris i similars', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 0 },
  { code: '627', name: 'Publicitat, propaganda i relacions públiques', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '627000', name: 'Publicitat, propaganda i relacions públiques', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '628', name: 'Subministraments', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '628000', name: 'Subministraments', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '629', name: 'Altres serveis', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '629000', name: 'Altres serveis', type: 'EXPENSE', level: 3, isLeaf: true, defaultVatRate: 21 },

  { code: '63', name: 'Tributs', type: 'EXPENSE', level: 1, isLeaf: false },
  { code: '630', name: 'Impost sobre beneficis', type: 'EXPENSE', level: 2, isLeaf: false, subtype: 'CORPORATE_TAX' },
  { code: '630000', name: 'Impost sobre beneficis', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'CORPORATE_TAX' },
  { code: '631', name: 'Altres tributs', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '631000', name: 'Altres tributs', type: 'EXPENSE', level: 3, isLeaf: true },

  { code: '64', name: 'Despeses de personal', type: 'EXPENSE', level: 1, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '640', name: 'Sous i salaris', type: 'EXPENSE', level: 2, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '640000', name: 'Sous i salaris', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'PERSONNEL' },
  { code: '642', name: 'Seguretat Social a càrrec de l\'empresa', type: 'EXPENSE', level: 2, isLeaf: false, subtype: 'PERSONNEL' },
  { code: '642000', name: 'Seguretat Social a càrrec de l\'empresa', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'PERSONNEL' },

  { code: '66', name: 'Despeses financeres', type: 'EXPENSE', level: 1, isLeaf: false },
  { code: '669', name: 'Altres despeses financeres', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '669000', name: 'Altres despeses financeres', type: 'EXPENSE', level: 3, isLeaf: true },

  { code: '67', name: 'Pèrdues procedents d\'actius i altres despeses excepcionals', type: 'EXPENSE', level: 1, isLeaf: false },
  { code: '678', name: 'Despeses excepcionals', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '678000', name: 'Despeses excepcionals', type: 'EXPENSE', level: 3, isLeaf: true },

  { code: '68', name: 'Dotacions per amortització', type: 'EXPENSE', level: 1, isLeaf: false, subtype: 'AMORTIZATION' },
  { code: '681', name: 'Amortització de l\'immobilitzat material', type: 'EXPENSE', level: 2, isLeaf: false, subtype: 'AMORTIZATION' },
  { code: '6813', name: 'Amortització de maquinària', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'AMORTIZATION' },
  { code: '6816', name: 'Amortització de mobiliari', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'AMORTIZATION' },
  { code: '6817', name: 'Amortització d\'equips per a processos d\'informació', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'AMORTIZATION' },
  { code: '6818', name: 'Amortització d\'elements de transport', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'AMORTIZATION' },
  { code: '6819', name: 'Amortització d\'altre immobilitzat material', type: 'EXPENSE', level: 3, isLeaf: true, subtype: 'AMORTIZATION' },

  { code: '69', name: 'Pèrdues per deteriorament i altres dotacions', type: 'EXPENSE', level: 1, isLeaf: false },
  { code: '694', name: 'Pèrdues per deteriorament de crèdits comercials', type: 'EXPENSE', level: 2, isLeaf: false },
  { code: '694000', name: 'Pèrdues per deteriorament de crèdits comercials', type: 'EXPENSE', level: 3, isLeaf: true },

  // ───────── GRUP 7 — Vendes i ingressos (subgrup 70, 75, 76, 77) ─────────
  { code: '70', name: 'Vendes de mercaderies, de producció pròpia, de serveis', type: 'INCOME', level: 1, isLeaf: false },
  { code: '700', name: 'Vendes de mercaderies', type: 'INCOME', level: 2, isLeaf: false },
  { code: '700000', name: 'Vendes de mercaderies', type: 'INCOME', level: 3, isLeaf: true, defaultVatRate: 21 },
  { code: '705', name: 'Prestacions de serveis', type: 'INCOME', level: 2, isLeaf: false },
  { code: '705000', name: 'Prestacions de serveis (lloguer d\'equip)', type: 'INCOME', level: 3, isLeaf: true, defaultVatRate: 21 },

  { code: '75', name: 'Altres ingressos de gestió', type: 'INCOME', level: 1, isLeaf: false },
  { code: '759', name: 'Ingressos per serveis diversos', type: 'INCOME', level: 2, isLeaf: false },
  { code: '759000', name: 'Ingressos per serveis diversos', type: 'INCOME', level: 3, isLeaf: true, defaultVatRate: 21 },

  { code: '76', name: 'Ingressos financers', type: 'INCOME', level: 1, isLeaf: false },
  { code: '769', name: 'Altres ingressos financers', type: 'INCOME', level: 2, isLeaf: false },
  { code: '769000', name: 'Altres ingressos financers', type: 'INCOME', level: 3, isLeaf: true },

  { code: '77', name: 'Beneficis procedents d\'actius i altres ingressos excepcionals', type: 'INCOME', level: 1, isLeaf: false },
  { code: '778', name: 'Ingressos excepcionals', type: 'INCOME', level: 2, isLeaf: false },
  { code: '778000', name: 'Ingressos excepcionals', type: 'INCOME', level: 3, isLeaf: true },
];

// ===========================================
// MAIN
// ===========================================
async function main() {
  console.log('\n=== Seed Comptabilitat — Sprint 1 ===\n');

  // ─────────── 1. Empresa ───────────
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: {
        legalName: 'SEITO CAMERA, S.L.',
        commercialName: 'SeitoCamera',
        nif: process.env.SEITO_NIF || 'PENDING_NIF_CONFIG',
        country: 'ES',
        defaultVatRate: 21,
        defaultIrpfRate: 15,
        corporateTaxRate: 25,
        aeatRegime: 'GENERAL',
        vatPeriod: 'QUARTERLY',
        is347Threshold: 3005.06,
      },
    });
    console.log(`Empresa creada: ${company.legalName} (NIF: ${company.nif})`);
    if (company.nif === 'PENDING_NIF_CONFIG') {
      console.log('   ATENCIÓ: cal omplir les dades fiscals de l\'empresa des de la UI o definir SEITO_NIF al .env');
    }
  } else {
    console.log(`Empresa ja existent: ${company.legalName}`);
  }

  // ─────────── 2. Exercici comptable any en curs ───────────
  const currentYear = new Date().getFullYear();
  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { companyId_year: { companyId: company.id, year: currentYear } },
    update: {},
    create: {
      companyId: company.id,
      year: currentYear,
      startDate: new Date(`${currentYear}-01-01T00:00:00Z`),
      endDate: new Date(`${currentYear}-12-31T23:59:59Z`),
      status: 'OPEN',
    },
  });
  console.log(`Exercici ${currentYear}: ${fiscalYear.status}`);

  // ─────────── 3. Pla de comptes (PGC PYMES) ───────────
  // Passada 1: crear/actualitzar tots els comptes sense parentId
  let createdCount = 0;
  let updatedCount = 0;

  for (const acc of ACCOUNTS) {
    const existing = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId: company.id, code: acc.code } },
    });

    const data = {
      companyId: company.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      level: acc.level,
      isLeaf: acc.isLeaf,
      subtype: acc.subtype || null,
      taxBookType: acc.taxBookType || null,
      defaultVatRate: acc.defaultVatRate ?? null,
      isSystem: true,
      isActive: true,
    };

    if (existing) {
      await prisma.chartOfAccount.update({ where: { id: existing.id }, data });
      updatedCount++;
    } else {
      await prisma.chartOfAccount.create({ data });
      createdCount++;
    }
  }

  // Passada 2: assignar parents per code prefix matching
  // Regla: el parent és el compte amb el codi més llarg que encara és prefix.
  // Ex: 213000 → parent 213; 213 → parent 21; 21 → parent 2.
  const allAccounts = await prisma.chartOfAccount.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true },
  });
  const codeMap = new Map(allAccounts.map(a => [a.code, a.id]));

  let parentLinkedCount = 0;
  for (const acc of allAccounts) {
    if (acc.code.length <= 1) continue;  // Grups (1 dígit) no tenen parent

    let parentId = null;
    for (let len = acc.code.length - 1; len >= 1; len--) {
      const prefix = acc.code.substring(0, len);
      if (codeMap.has(prefix)) {
        parentId = codeMap.get(prefix);
        break;
      }
    }

    if (parentId) {
      await prisma.chartOfAccount.update({
        where: { id: acc.id },
        data: { parentId },
      });
      parentLinkedCount++;
    }
  }

  console.log(`Pla de comptes: ${createdCount} creats, ${updatedCount} actualitzats, ${parentLinkedCount} vinculats a parent`);
  console.log(`\nSeed completat.\n`);
}

main()
  .catch((e) => {
    console.error('ERROR al seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
