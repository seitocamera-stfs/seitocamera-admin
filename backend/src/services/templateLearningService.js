/**
 * TEMPLATE LEARNING SERVICE
 *
 * Aprèn automàticament dels canvis manuals de l'usuari per millorar
 * les plantilles de proveïdor (SupplierTemplate).
 *
 * Quan l'usuari corregeix el número de factura, l'import, o altres camps,
 * el sistema detecta el canvi i actualitza la plantilla perquè futures
 * factures del mateix proveïdor s'extreguin correctament.
 *
 * Flux:
 *   1. PUT /received/:id → detecta canvis al invoiceNumber
 *   2. Crida learnFromCorrection() amb les dades antigues i noves
 *   3. Actualitza/crea la SupplierTemplate amb els patrons apresos
 */

const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

/**
 * Genera un patró regex a partir d'un número de factura concret.
 * Ex: "213750680" → "^\\d{9}$"
 * Ex: "FRA-2026/0489" → "^[A-Z]{3}-\\d{4}/\\d{4}$"
 * Ex: "INV-00123" → "^[A-Z]{3}-\\d{5}$"
 */
function generatePattern(invoiceNumber) {
  if (!invoiceNumber) return null;

  const pattern = invoiceNumber
    .replace(/[0-9]+/g, (m) => `\\d{${Math.max(1, m.length - 1)},${m.length + 1}}`)
    .replace(/[A-Z]+/g, (m) => `[A-Z]{${m.length}}`)
    .replace(/[a-z]+/g, (m) => `[a-z]{${m.length}}`);

  // Escapar caràcters especials de regex (excepte els que ja hem substituït)
  const escaped = pattern
    .replace(/\//g, '\\/')
    .replace(/\./g, '\\.')
    .replace(/\-/g, '\\-');

  return `^${escaped}$`;
}

/**
 * Extreu el prefix comú d'un número de factura.
 * Ex: "213750680" → null (tot dígits, no hi ha prefix)
 * Ex: "FRA-2026/0489" → "FRA-"
 * Ex: "INV00123" → "INV"
 */
function extractPrefix(invoiceNumber) {
  if (!invoiceNumber) return null;

  // Buscar la part no-numèrica del principi
  const match = invoiceNumber.match(/^([A-Za-z]+[\-_./]?)/);
  if (match && match[1].length >= 2) return match[1];

  return null;
}

/**
 * Comprova si dos patrons regex són equivalents o un conté l'altre.
 */
function patternsOverlap(existing, newPattern) {
  try {
    // Comprovar si són iguals (normalitzats)
    const norm = (p) => p.replace(/\{(\d+),\d+\}/g, '{$1}');
    return norm(existing) === norm(newPattern);
  } catch {
    return false;
  }
}

/**
 * FUNCIÓ PRINCIPAL: Aprèn d'una correcció manual de l'usuari.
 *
 * Es crida quan l'usuari actualitza una factura i canvia el número de factura.
 * Compara el valor antic amb el nou, i actualitza la plantilla del proveïdor.
 *
 * @param {Object} params
 * @param {string} params.supplierId - ID del proveïdor
 * @param {string} params.oldInvoiceNumber - Número antic (extret automàticament)
 * @param {string} params.newInvoiceNumber - Número corregit per l'usuari
 * @param {number} [params.totalAmount] - Import total (per actualitzar rangs)
 * @param {number} [params.taxRate] - IVA (per actualitzar IVA comú)
 */
async function learnFromCorrection({ supplierId, oldInvoiceNumber, newInvoiceNumber, totalAmount, taxRate }) {
  if (!supplierId || !newInvoiceNumber) return;

  // Si no ha canviat, no cal aprendre
  if (oldInvoiceNumber === newInvoiceNumber) return;

  // Ignorar números provisionals
  if (newInvoiceNumber.startsWith('PROV-') || newInvoiceNumber.startsWith('GDRIVE-')) return;

  try {
    // Buscar o crear la plantilla
    let template = await prisma.supplierTemplate.findUnique({
      where: { supplierId },
      include: { supplier: { select: { name: true } } },
    });

    const supplierName = template?.supplier?.name || 'desconegut';
    const newPattern = generatePattern(newInvoiceNumber);
    const newPrefix = extractPrefix(newInvoiceNumber);

    if (template) {
      // Actualitzar plantilla existent
      const currentPatterns = Array.isArray(template.invoicePatterns) ? [...template.invoicePatterns] : [];
      const updateData = {};

      // Afegir patró si no existeix un d'equivalent
      if (newPattern) {
        const alreadyExists = currentPatterns.some(p => patternsOverlap(p, newPattern));
        if (!alreadyExists) {
          currentPatterns.push(newPattern);
          updateData.invoicePatterns = currentPatterns;
          logger.info(`TemplateLearning: Nou patró après per ${supplierName}: ${newPattern} (de "${newInvoiceNumber}")`);
        }
      }

      // Actualitzar prefix si no en tenim o si el nou és més específic
      if (newPrefix && (!template.invoicePrefix || newPrefix.length > template.invoicePrefix.length)) {
        updateData.invoicePrefix = newPrefix;
        logger.info(`TemplateLearning: Prefix actualitzat per ${supplierName}: "${newPrefix}"`);
      }

      // Actualitzar rangs d'import
      if (totalAmount && totalAmount > 0) {
        const min = template.minAmount ? Math.min(parseFloat(template.minAmount), totalAmount) : totalAmount;
        const max = template.maxAmount ? Math.max(parseFloat(template.maxAmount), totalAmount) : totalAmount;
        const oldAvg = template.avgAmount ? parseFloat(template.avgAmount) : 0;
        const count = template.sampleCount || 1;
        const newAvg = (oldAvg * count + totalAmount) / (count + 1);

        updateData.minAmount = min;
        updateData.maxAmount = max;
        updateData.avgAmount = parseFloat(newAvg.toFixed(2));
        updateData.sampleCount = count + 1;
      }

      // Actualitzar IVA comú si proporcionat
      if (taxRate && taxRate > 0) {
        updateData.commonTaxRate = taxRate;
      }

      // Incrementar confiança (més correccions = més confiança)
      const newConfidence = Math.min(1, (template.confidence || 0) + 0.1);
      updateData.confidence = newConfidence;

      if (Object.keys(updateData).length > 0) {
        await prisma.supplierTemplate.update({
          where: { supplierId },
          data: updateData,
        });
        logger.info(`TemplateLearning: Plantilla actualitzada per ${supplierName}`);
      }
    } else {
      // Crear nova plantilla a partir de la correcció
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { name: true },
      });

      const createData = {
        supplierId,
        invoicePatterns: newPattern ? [newPattern] : [],
        invoicePrefix: newPrefix,
        sampleCount: 1,
        confidence: 0.3, // Confiança baixa amb una sola mostra
      };

      if (totalAmount && totalAmount > 0) {
        createData.avgAmount = totalAmount;
        createData.minAmount = totalAmount;
        createData.maxAmount = totalAmount;
      }

      if (taxRate && taxRate > 0) {
        createData.commonTaxRate = taxRate;
      }

      await prisma.supplierTemplate.create({ data: createData });
      logger.info(`TemplateLearning: Nova plantilla creada per ${supplier?.name || supplierId} a partir de correcció manual`);
    }

    // Log del canvi per auditoria
    if (oldInvoiceNumber && oldInvoiceNumber !== newInvoiceNumber) {
      logger.info(
        `TemplateLearning: Correcció detectada per ${supplierName}: ` +
        `"${oldInvoiceNumber}" → "${newInvoiceNumber}"`
      );
    }
  } catch (error) {
    // No propagar l'error — l'aprenentatge és secondary, no ha de trencar el PUT
    logger.error(`TemplateLearning: Error aprenent de correcció: ${error.message}`);
  }
}

/**
 * Aprèn de totes les factures correctes (amb número no provisional) d'un proveïdor.
 * Útil per reconstruir la plantilla a partir de les dades existents.
 *
 * @param {string} supplierId - ID del proveïdor
 */
async function rebuildTemplateFromHistory(supplierId) {
  if (!supplierId) return null;

  try {
    const invoices = await prisma.receivedInvoice.findMany({
      where: {
        supplierId,
        deletedAt: null,
        isDuplicate: false,
        status: { notIn: ['NOT_INVOICE'] },
        invoiceNumber: {
          not: { startsWith: 'PROV-' },
        },
      },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        taxRate: true,
        gdriveFileName: true,
      },
      orderBy: { issueDate: 'desc' },
    });

    // Filtrar números provisionals / duplicats
    const validInvoices = invoices.filter(
      i => i.invoiceNumber &&
        !i.invoiceNumber.startsWith('PROV-') &&
        !i.invoiceNumber.startsWith('GDRIVE-') &&
        !i.invoiceNumber.includes('-DUP-')
    );

    if (validInvoices.length < 2) return null;

    const numbers = validInvoices.map(i => i.invoiceNumber);

    // Generar patrons
    const patterns = new Set();
    for (const num of numbers) {
      const p = generatePattern(num);
      if (p) patterns.add(p);
    }

    // Deduplicar patrons similars
    const uniquePatterns = [...patterns];

    // Trobar prefix comú
    const sorted = [...numbers].sort();
    let prefix = '';
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    for (let i = 0; i < Math.min(first.length, last.length); i++) {
      if (first[i] === last[i]) prefix += first[i];
      else break;
    }
    // Netejar prefix
    const sepMatch = prefix.match(/^(.*[/\-_. ])/);
    if (sepMatch) prefix = sepMatch[1];
    else if (/\d$/.test(prefix)) prefix = prefix.replace(/\d+$/, '');
    if (prefix.length < 2 || prefix.length >= first.length) prefix = null;

    // Imports
    const amounts = validInvoices
      .map(i => parseFloat(i.totalAmount))
      .filter(a => a > 0);
    const avgAmount = amounts.length
      ? parseFloat((amounts.reduce((a, b) => a + b, 0) / amounts.length).toFixed(2))
      : null;
    const minAmount = amounts.length ? Math.min(...amounts) : null;
    const maxAmount = amounts.length ? Math.max(...amounts) : null;

    // IVA comú
    const taxRates = validInvoices.map(i => parseFloat(i.taxRate)).filter(r => r > 0);
    const taxCounts = {};
    for (const r of taxRates) {
      const rounded = Math.round(r * 10) / 10;
      taxCounts[rounded] = (taxCounts[rounded] || 0) + 1;
    }
    const commonTaxRate = Object.entries(taxCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0]
      ? parseFloat(Object.entries(taxCounts).sort((a, b) => b[1] - a[1])[0][0])
      : null;

    // File patterns
    const fileNames = validInvoices.map(i => i.gdriveFileName).filter(Boolean);
    const filePatterns = [];
    if (fileNames.length >= 2) {
      const cleaned = fileNames.map(f => f.replace(/\.[^.]+$/, ''));
      const sortedFiles = [...cleaned].sort();
      let commonFilePrefix = '';
      const fFirst = sortedFiles[0];
      const fLast = sortedFiles[sortedFiles.length - 1];
      for (let i = 0; i < Math.min(fFirst.length, fLast.length, 50); i++) {
        if (fFirst[i] === fLast[i]) commonFilePrefix += fFirst[i];
        else break;
      }
      commonFilePrefix = commonFilePrefix.replace(/[\d_\-. ]+$/, '').trim();
      if (commonFilePrefix.length >= 3) filePatterns.push(commonFilePrefix);
    }

    // NIFs
    // (no podem extreure NIFs sense rellegir els PDFs, usar els que ja tenim)
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { nif: true, name: true },
    });
    const knownNifs = supplier?.nif ? [supplier.nif] : [];

    const templateData = {
      invoicePatterns: uniquePatterns,
      invoicePrefix: prefix,
      filePatterns: filePatterns.length > 0 ? filePatterns : undefined,
      knownNifs: knownNifs.length > 0 ? knownNifs : undefined,
      avgAmount,
      minAmount,
      maxAmount,
      commonTaxRate,
      sampleCount: validInvoices.length,
      confidence: Math.min(1, 0.3 + validInvoices.length * 0.05),
    };

    // Upsert
    const result = await prisma.supplierTemplate.upsert({
      where: { supplierId },
      update: templateData,
      create: { supplierId, ...templateData },
    });

    logger.info(
      `TemplateLearning: Plantilla reconstruïda per ${supplier?.name || supplierId}: ` +
      `${uniquePatterns.length} patrons, prefix="${prefix}", ` +
      `${validInvoices.length} factures analitzades`
    );

    return result;
  } catch (error) {
    logger.error(`TemplateLearning: Error reconstruint plantilla: ${error.message}`);
    return null;
  }
}

module.exports = {
  learnFromCorrection,
  rebuildTemplateFromHistory,
  generatePattern,
  extractPrefix,
};
