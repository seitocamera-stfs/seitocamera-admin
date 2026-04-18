#!/usr/bin/env node
/**
 * APRENENTATGE DE PATRONS DE FACTURES
 *
 * Analitza les factures existents correctament processades per generar
 * plantilles (SupplierTemplate) per a cada proveïdor. Aquestes plantilles
 * s'utilitzen després per millorar l'extracció automàtica de PDFs nous.
 *
 * Què aprèn per cada proveïdor:
 *   - Patrons regex dels números de factura (prefix, format)
 *   - Patrons del nom de fitxer que identifiquen el proveïdor
 *   - NIFs detectats als PDFs
 *   - Rang d'imports habituals (min, max, mitjana)
 *   - IVA més comú
 *
 * EXECUTAR: node scripts/learn-supplier-patterns.js
 * MODE SEC:  node scripts/learn-supplier-patterns.js --dry-run
 */
require('dotenv').config();

const { prisma } = require('../src/config/database');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Escapa caràcters especials de regex
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A partir d'una llista de números de factura, intenta trobar el patró comú.
 * Ex: ["FRA-2601", "FRA-2602", "FRA-2603"] → prefix "FRA-", pattern "^FRA-\\d{4}$"
 * Ex: ["2026/0489", "2026/0490"] → prefix "2026/", pattern "^\\d{4}/\\d{3,5}$"
 */
function analyzeInvoiceNumbers(numbers) {
  if (!numbers.length) return { prefix: null, patterns: [] };

  // Filtrar números provisionals i duplicats
  const clean = [...new Set(
    numbers.filter(n => n && !n.startsWith('PROV-') && !n.startsWith('GDRIVE-') && !n.includes('-DUP-'))
  )];

  if (clean.length < 2) return { prefix: null, patterns: [] };

  // --- Trobar prefix comú ---
  let prefix = '';
  const sorted = clean.sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  for (let i = 0; i < Math.min(first.length, last.length); i++) {
    if (first[i] === last[i]) prefix += first[i];
    else break;
  }
  // El prefix ha de tenir sentit (no acabar a mig dígit)
  // Tallar al darrer separador si cal
  const sepMatch = prefix.match(/^(.*[/\-_. ])/);
  if (sepMatch) {
    prefix = sepMatch[1];
  } else if (/\d$/.test(prefix) && prefix.length < first.length) {
    // Prefix acaba en dígit — pot ser part del any. Buscar fins abans dels dígits que canvien.
    const alphaPrefix = prefix.replace(/\d+$/, '');
    if (alphaPrefix.length >= 2) {
      prefix = alphaPrefix;
    }
  }
  // Si el prefix és massa curt (< 2 chars) o massa llarg, no és útil
  if (prefix.length < 2 || prefix.length >= first.length) prefix = null;

  // --- Generar patrons regex ---
  const patterns = [];

  // Analitzar l'estructura dels números
  const structures = clean.map(n => {
    return n
      .replace(/[0-9]+/g, (m) => `\\d{${m.length}}`)
      .replace(/[A-Z]+/g, (m) => `[A-Z]{${m.length}}`)
      .replace(/[a-z]+/g, (m) => `[a-z]{${m.length}}`);
  });

  // Comptar estructures repetides
  const structCounts = {};
  for (const s of structures) {
    structCounts[s] = (structCounts[s] || 0) + 1;
  }

  // Mantenir patrons que cobreixen almenys 30% de les factures
  const threshold = Math.max(2, clean.length * 0.3);
  for (const [pattern, count] of Object.entries(structCounts)) {
    if (count >= threshold) {
      // Generalitzar \d{4} a \d{3,5} per permetre variació de longitud
      const relaxed = pattern.replace(/\\d\{(\d+)\}/g, (m, len) => {
        const n = parseInt(len);
        return `\\d{${Math.max(1, n - 1)},${n + 1}}`;
      });
      patterns.push(`^${relaxed}$`);
    }
  }

  return { prefix: prefix || null, patterns };
}

/**
 * Analitza noms de fitxer per trobar patrons que identifiquen el proveïdor.
 * Ex: ["Fra_Cromalite_20260489.pdf", "Fra_Cromalite_20260512.pdf"] → ["Fra_Cromalite"]
 */
function analyzeFileNames(fileNames, supplierName) {
  if (!fileNames.length) return [];

  const patterns = new Set();

  // 1. Buscar parts comunes entre noms de fitxer
  const cleaned = fileNames
    .map(f => f.replace(/\.[^.]+$/, ''))  // treure extensió
    .filter(Boolean);

  if (cleaned.length >= 2) {
    // Trobar prefix comú entre tots els fitxers
    let commonPrefix = '';
    const sorted = [...cleaned].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    for (let i = 0; i < Math.min(first.length, last.length, 50); i++) {
      if (first[i] === last[i]) commonPrefix += first[i];
      else break;
    }
    // Netejar: treure dígits i separadors del final
    commonPrefix = commonPrefix.replace(/[\d_\-. ]+$/, '').trim();
    if (commonPrefix.length >= 3) {
      patterns.add(commonPrefix);
    }
  }

  // 2. Buscar el nom del proveïdor (o part) dins els noms de fitxer
  if (supplierName) {
    const nameParts = supplierName
      .replace(/[,.]?\s*(S\.?L\.?U?\.?|S\.?A\.?|S\.?C\.?P?\.?)$/i, '')
      .trim()
      .split(/\s+/)
      .filter(p => p.length >= 3);

    for (const part of nameParts) {
      const lower = part.toLowerCase();
      const matchCount = cleaned.filter(f => f.toLowerCase().includes(lower)).length;
      if (matchCount >= Math.max(1, cleaned.length * 0.5)) {
        patterns.add(part);
      }
    }
  }

  return [...patterns];
}

/**
 * Analitza imports per trobar el rang habitual i IVA comú
 */
function analyzeAmounts(invoices) {
  const amounts = invoices
    .map(i => parseFloat(i.totalAmount))
    .filter(a => a > 0);

  const taxRates = invoices
    .map(i => parseFloat(i.taxRate))
    .filter(r => r > 0);

  if (!amounts.length) return { avgAmount: null, minAmount: null, maxAmount: null, commonTaxRate: null };

  const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;

  // IVA més comú
  const taxCounts = {};
  for (const r of taxRates) {
    const rounded = Math.round(r * 10) / 10;
    taxCounts[rounded] = (taxCounts[rounded] || 0) + 1;
  }
  const commonTaxRate = Object.entries(taxCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    avgAmount: Math.round(avg * 100) / 100,
    minAmount: Math.round(Math.min(...amounts) * 100) / 100,
    maxAmount: Math.round(Math.max(...amounts) * 100) / 100,
    commonTaxRate: commonTaxRate ? parseFloat(commonTaxRate) : null,
  };
}

async function main() {
  if (DRY_RUN) console.log('🔍 MODE SEC — no es guardarà res a BD\n');
  console.log('=== APRENENTATGE DE PATRONS DE FACTURES ===\n');

  // 1. Obtenir tots els proveïdors amb les seves factures
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    include: {
      receivedInvoices: {
        where: {
          isDuplicate: false,
          // Excloure factures amb números provisionals
          NOT: {
            OR: [
              { invoiceNumber: { startsWith: 'PROV-' } },
              { invoiceNumber: { startsWith: 'GDRIVE-' } },
            ],
          },
        },
        select: {
          invoiceNumber: true,
          totalAmount: true,
          taxRate: true,
          originalFileName: true,
          ocrRawData: true,
          status: true,
        },
      },
      template: true,
    },
    orderBy: { name: 'asc' },
  });

  console.log(`Proveïdors actius: ${suppliers.length}\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const supplier of suppliers) {
    const invoices = supplier.receivedInvoices;

    // Necessitem almenys 2 factures per aprendre patrons
    if (invoices.length < 2) {
      skipped++;
      continue;
    }

    console.log(`\n📊 ${supplier.name} (${invoices.length} factures)`);

    // --- Analitzar números de factura ---
    const numbers = invoices.map(i => i.invoiceNumber);
    const { prefix, patterns } = analyzeInvoiceNumbers(numbers);

    if (prefix) console.log(`   Prefix: "${prefix}"`);
    if (patterns.length) console.log(`   Patrons: ${patterns.join(', ')}`);

    // --- Analitzar noms de fitxer ---
    const fileNames = invoices.map(i => i.originalFileName).filter(Boolean);
    const filePatterns = analyzeFileNames(fileNames, supplier.name);

    if (filePatterns.length) console.log(`   Fitxers: ${filePatterns.join(', ')}`);

    // --- Analitzar NIFs des de ocrRawData ---
    const knownNifs = new Set();
    if (supplier.nif) knownNifs.add(supplier.nif);
    for (const inv of invoices) {
      const ocrData = inv.ocrRawData;
      if (ocrData && Array.isArray(ocrData.nifCif)) {
        for (const nif of ocrData.nifCif) {
          knownNifs.add(nif);
        }
      }
    }
    const nifList = [...knownNifs].filter(Boolean);
    if (nifList.length) console.log(`   NIFs: ${nifList.join(', ')}`);

    // --- Analitzar imports ---
    const amountStats = analyzeAmounts(invoices);
    if (amountStats.avgAmount) {
      console.log(`   Imports: ${amountStats.minAmount}€ — ${amountStats.maxAmount}€ (mitjana: ${amountStats.avgAmount}€)`);
    }
    if (amountStats.commonTaxRate) {
      console.log(`   IVA habitual: ${amountStats.commonTaxRate}%`);
    }

    // --- Calcular confiança ---
    let confidence = 0;
    if (patterns.length > 0) confidence += 0.3;
    if (prefix) confidence += 0.2;
    if (filePatterns.length > 0) confidence += 0.2;
    if (nifList.length > 0) confidence += 0.2;
    if (amountStats.avgAmount) confidence += 0.1;
    confidence = Math.min(1, confidence);

    console.log(`   Confiança: ${(confidence * 100).toFixed(0)}%`);

    // --- Guardar plantilla ---
    if (!DRY_RUN) {
      const templateData = {
        invoicePatterns: patterns.length > 0 ? patterns : null,
        invoicePrefix: prefix,
        filePatterns: filePatterns.length > 0 ? filePatterns : null,
        knownNifs: nifList.length > 0 ? nifList : null,
        avgAmount: amountStats.avgAmount,
        minAmount: amountStats.minAmount,
        maxAmount: amountStats.maxAmount,
        commonTaxRate: amountStats.commonTaxRate,
        sampleCount: invoices.length,
        confidence,
      };

      if (supplier.template) {
        await prisma.supplierTemplate.update({
          where: { id: supplier.template.id },
          data: templateData,
        });
        updated++;
      } else {
        await prisma.supplierTemplate.create({
          data: {
            supplierId: supplier.id,
            ...templateData,
          },
        });
        created++;
      }
    }
  }

  // --- Resum ---
  console.log('\n\n=== RESUM ===');
  console.log(`Proveïdors analitzats: ${suppliers.length}`);
  console.log(`Plantilles creades: ${created}`);
  console.log(`Plantilles actualitzades: ${updated}`);
  console.log(`Saltats (< 2 factures): ${skipped}`);

  if (DRY_RUN) {
    console.log('\n⚠ MODE SEC — cap canvi. Executa sense --dry-run per guardar.');
  } else {
    console.log('\n✓ Plantilles guardades. S\'utilitzaran en la propera extracció de PDFs.');
  }

  // --- Estadístiques addicionals ---
  console.log('\n=== QUALITAT D\'EXTRACCIÓ ACTUAL ===');

  const totalInvoices = await prisma.receivedInvoice.count({ where: { isDuplicate: false } });
  const provisionalCount = await prisma.receivedInvoice.count({
    where: { isDuplicate: false, invoiceNumber: { startsWith: 'PROV-' } },
  });
  const zeroAmount = await prisma.receivedInvoice.count({
    where: { isDuplicate: false, totalAmount: 0 },
  });
  const noSupplier = await prisma.receivedInvoice.count({
    where: { isDuplicate: false, supplierId: null },
  });
  const pdfPending = await prisma.receivedInvoice.count({
    where: { isDuplicate: false, status: 'PDF_PENDING' },
  });

  const pctProvisional = totalInvoices > 0 ? (provisionalCount / totalInvoices * 100).toFixed(1) : 0;
  const pctZero = totalInvoices > 0 ? (zeroAmount / totalInvoices * 100).toFixed(1) : 0;
  const pctNoSupplier = totalInvoices > 0 ? (noSupplier / totalInvoices * 100).toFixed(1) : 0;

  console.log(`Total factures (no duplicades): ${totalInvoices}`);
  console.log(`Números provisionals (PROV-): ${provisionalCount} (${pctProvisional}%)`);
  console.log(`Import zero: ${zeroAmount} (${pctZero}%)`);
  console.log(`Sense proveïdor: ${noSupplier} (${pctNoSupplier}%)`);
  console.log(`Pendents revisió (PDF_PENDING): ${pdfPending}`);
  console.log(`\nObjectiu: reduir provisionals i imports zero amb les plantilles.`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
