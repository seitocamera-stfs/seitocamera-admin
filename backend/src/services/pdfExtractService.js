const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../config/logger');

// ===========================================
// Servei d'extracció de text i dades de PDFs
// ===========================================
// Extreu text dels PDFs de factures per detectar:
//   - Número de factura
//   - NIF/CIF del proveïdor
//   - Import total
//   - Data de factura
// Usa pdf-parse per a text natiu.
// Si el PDF és escanejat (sense text), usa OCR amb
// tesseract.js + pdf-to-img per extreure'l.
// ===========================================

let pdfParse = null;
let Tesseract = null;

/**
 * Carrega pdf-parse lazy (per si no està instal·lat)
 */
function getPdfParser() {
  if (!pdfParse) {
    try {
      pdfParse = require('pdf-parse');
    } catch {
      logger.warn('pdf-parse no instal·lat. Executa: npm install pdf-parse');
      return null;
    }
  }
  return pdfParse;
}

/**
 * Carrega tesseract.js lazy
 */
function getTesseract() {
  if (!Tesseract) {
    try {
      Tesseract = require('tesseract.js');
    } catch {
      logger.warn('tesseract.js no instal·lat. Executa: npm install tesseract.js');
      return null;
    }
  }
  return Tesseract;
}

/**
 * Renderitza una pàgina PDF a imatge PNG usant pdfjs-dist + canvas
 * @param {Buffer} pdfBuffer - Buffer del PDF
 * @param {number} pageNum - Número de pàgina (1-based)
 * @param {number} scale - Escala de renderització (2.0 = bona qualitat OCR)
 * @returns {Buffer|null} Buffer PNG de la pàgina
 */
async function renderPdfPageToImage(pdfBuffer, pageNum, scale = 2.0) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const { createCanvas } = require('canvas');

    const uint8Array = new Uint8Array(pdfBuffer);
    const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    const page = await doc.getPage(pageNum);

    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    await doc.destroy();
    return pngBuffer;
  } catch (err) {
    logger.warn(`Error renderitzant pàgina ${pageNum} del PDF: ${err.message}`);
    return null;
  }
}

/**
 * Extreu tot el text d'un PDF local
 * @param {string} filePath - Camí del fitxer PDF
 * @returns {string|null} Text extret, o null si no es pot
 */
async function extractText(filePath) {
  const parser = getPdfParser();
  if (!parser) return null;

  try {
    const buffer = fs.readFileSync(filePath);
    const data = await parser(buffer);
    return data.text || null;
  } catch (err) {
    logger.warn(`Error extraient text de ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Extreu text d'un buffer PDF (per quan descarreguem de GDrive o Zoho)
 * @param {Buffer} buffer - Buffer del PDF
 * @returns {string|null}
 */
async function extractTextFromBuffer(buffer) {
  const parser = getPdfParser();
  if (!parser) return null;

  try {
    const data = await parser(buffer);
    return data.text || null;
  } catch (err) {
    logger.warn(`Error extraient text de buffer PDF: ${err.message}`);
    return null;
  }
}

// ===========================================
// Patrons de detecció de número de factura
// ===========================================
// Les factures a Espanya solen tenir formats com:
//   Factura nº: FRA-2026/001
//   Nº Factura: 2026-0042
//   Invoice Number: INV-00123
//   Factura: A-123/2026
//   Fra. Nº 2026/001
//   Núm. Factura: FC2026-001
// ===========================================

const INVOICE_NUMBER_PATTERNS = [
  // "Factura nº: XXX" / "Factura núm: XXX" / "Factura número: XXX"
  /(?:factura|fra\.?)\s*(?:n[ºúo°]\.?|n[uú]m(?:ero)?\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,

  // "Nº Factura: XXX" / "Núm. Factura: XXX"
  /(?:n[ºúo°]\.?|n[uú]m(?:ero)?\.?)\s*(?:de\s+)?(?:factura|fra\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,

  // "Invoice (?:Number|No|#): XXX"
  /invoice\s*(?:number|no\.?|n[ºo°]\.?|#)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,

  // "Factura: XXX" (directe)
  /factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i,

  // "FRA-XXXX" / "FRA/XXXX" (codi directe)
  /\b(FRA[\-\/][A-Z0-9][\w\-\/\.]+)/i,

  // "Nº: XXX" quan apareix prop de "factura" al context
  /n[ºúo°]\.?\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{3,})/i,

  // "Albarà nº: XXX"
  /(?:albar[àa]|albaran)\s*(?:n[ºúo°]\.?|n[uú]m\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,
];

/**
 * Detecta el número de factura dins del text extret d'un PDF
 * @param {string} text - Text complet del PDF
 * @returns {string|null} Número de factura detectat, o null
 */
function detectInvoiceNumber(text) {
  if (!text || text.trim().length < 10) return null;

  // Normalitzar espais i salts de línia
  const normalized = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      // Netejar el resultat
      let num = match[1].trim();
      // Eliminar puntuació final
      num = num.replace(/[.,;:]+$/, '');
      // Validar que sembla un número de factura (mínim 3 caràcters)
      if (num.length >= 3 && num.length <= 50) {
        return num;
      }
    }
  }

  return null;
}

// ===========================================
// Detecció de NIF/CIF
// ===========================================

const NIF_CIF_PATTERN = /\b([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])\b/g;

// NIF/CIF propis de Seito Camera — excloure'ls per no confondre emissor/receptor
const OWN_NIF_LIST = ['B09805995'];

/**
 * Detecta NIFs/CIFs dins del text, excloent els propis de Seito Camera
 * @param {string} text
 * @returns {string[]} Llista de NIFs/CIFs trobats (sense els propis)
 */
function detectNifCif(text) {
  if (!text) return [];
  const matches = text.match(NIF_CIF_PATTERN) || [];
  // Deduplicar i excloure NIF propis
  return [...new Set(matches)].filter(nif => !OWN_NIF_LIST.includes(nif));
}

// ===========================================
// Detecció de nom del proveïdor
// ===========================================

/**
 * Detecta el nom del proveïdor/emissor de la factura dins del text.
 * Busca patrons com "Emisor:", "Empresa:", "Razón social:",
 * o el nom que apareix just abans del CIF/NIF.
 * @param {string} text - Text complet del PDF
 * @returns {string|null} Nom del proveïdor detectat
 */
function detectSupplierName(text) {
  if (!text) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Estratègia 1: Buscar etiquetes directes
  const labelPatterns = [
    /(?:emisor|emitent|proveedor|prove[ïi]dor|empresa|raz[oó]n\s*social)\s*[:\s]\s*(.+)/i,
    /(?:datos?\s*(?:del?\s*)?(?:emisor|proveedor|empresa))\s*[:\s]\s*(.+)/i,
  ];

  for (const pattern of labelPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name.length >= 3 && name.length <= 100) return name;
    }
  }

  // Estratègia 2: Buscar la línia just ABANS del primer CIF/NIF (que no sigui el propi)
  for (let i = 0; i < lines.length; i++) {
    const cifMatch = lines[i].match(/(?:CIF|NIF|CIF\/NIF)\s*[:\s]\s*([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])/i);
    if (cifMatch && cifMatch[1] && !OWN_NIF_LIST.includes(cifMatch[1].toUpperCase())) {
      // Buscar el nom a la línia anterior o a la línia "Emisor:"
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const candidate = lines[j].trim();
        // Descartar línies buides, etiquetes, adreces
        if (candidate.length < 3) continue;
        if (/^(emisor|enviar|cliente|datos|direc)/i.test(candidate)) continue;
        if (/^\d/.test(candidate)) continue; // Adreces que comencen amb número
        // Probablement és el nom de l'empresa
        if (candidate.length >= 3 && candidate.length <= 100) {
          return candidate.replace(/\s+/g, ' ');
        }
      }
    }
  }

  // Estratègia 3: Buscar després de "Emisor:" en línies
  for (let i = 0; i < lines.length; i++) {
    if (/^emisor/i.test(lines[i])) {
      // El nom sol ser la línia següent
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        const candidate = lines[j].trim();
        if (candidate.length >= 3 && !/^(cif|nif|tel|correo|web|dir|av|calle|carrer)/i.test(candidate)) {
          return candidate.replace(/\s+/g, ' ');
        }
      }
    }
  }

  return null;
}

// ===========================================
// Detecció d'imports
// ===========================================

const TOTAL_PATTERNS = [
  // "Total1.230,57" o "Total 1.230,57" (amb o sense espai, amb o sense dos punts)
  /total\s*[:\s]?\s*([\d.,]+)\s*€?/i,
  // "Total: 1.234,56 €" / "Total factura: 1234.56€"
  /total\s*(?:factura|fra\.?)?\s*[:\s]\s*([\d.,]+)\s*€?/i,
  // "TOTAL: €1,234.56"
  /total\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "Importe total: 1.234,56" / "Import total:"
  /import[e]?\s*total\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "Total a pagar / cobrar / general"
  /total\s*(?:a pagar|a cobrar|general)\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "TOTAL IVA inclòs: 1.234,56"
  /total\s*(?:iva\s*incl[oòuú]s|amb\s*iva|iva\s*incl\.?)\s*[:\s]?\s*€?\s*([\d.,]+)/i,
];

/**
 * Parseja un string numèric en format europeu a float
 * @param {string} numStr - "1.230,57" o "1230.57" o "1230,57"
 * @returns {number|NaN}
 */
function parseEuropeanNumber(numStr) {
  let s = numStr.trim();
  // Format europeu: 1.234,56 → 1234.56
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return parseFloat(s);
}

/**
 * Detecta l'import total dins del text.
 * Busca TOTS els "Total" i agafa el més gran (que sol ser el total amb IVA).
 * Exclou línies que contenen "Base imp" o "IVA XX%".
 * @param {string} text
 * @returns {number|null}
 */
function detectTotalAmount(text) {
  if (!text) return null;

  const amounts = [];

  // Estratègia 1: buscar per patrons específics
  const normalized = text.replace(/\s+/g, ' ');
  for (const pattern of TOTAL_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const num = parseEuropeanNumber(match[1]);
      if (!isNaN(num) && num > 0) amounts.push(num);
    }
  }

  // Estratègia 2: buscar TOTES les línies amb "Total" + número (per línia, no normalitzat)
  const lines = text.split('\n');
  for (const line of lines) {
    // Saltar línies de base imposable o IVA parcial
    if (/base\s*imp/i.test(line)) continue;
    if (/total\s*iva\s*\d+%/i.test(line)) continue;
    if (/total\s*\(base/i.test(line)) continue;

    const totalMatch = line.match(/total\s*[:\s]?\s*€?\s*([\d.,]+)/i);
    if (totalMatch && totalMatch[1]) {
      const num = parseEuropeanNumber(totalMatch[1]);
      if (!isNaN(num) && num > 0) amounts.push(num);
    }
  }

  if (amounts.length === 0) return null;

  // Retornar el valor més gran (normalment el total amb IVA)
  return Math.max(...amounts);
}

// ===========================================
// Detecció de data de factura
// ===========================================

const DATE_PATTERNS = [
  // "Fecha facturación : 06/04/2026" / "Fecha factura: 13/04/2026"
  /fecha\s*(?:de\s+)?(?:facturaci[oó]n|factura|emisi[oó]n)\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  // "Fecha: 13/04/2026" / "Data: 13-04-2026" / "Date: ..."
  /(?:fecha|data|date)\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  // "Data factura: 13/04/2026" / "Data emissió: ..."
  /data\s*(?:de\s+)?(?:factura|emissi[oó])\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  // Format "13.04.2026" o "13.04.26" al costat de paraules clau
  /(?:fecha|data|date|factura)\s*[:\s]\s*(\d{2}\.\d{2}\.\d{2,4})/i,
];

/**
 * Detecta la data de factura dins del text
 * @param {string} text
 * @returns {Date|null}
 */
function detectInvoiceDate(text) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ');

  for (const pattern of DATE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const parts = match[1].split(/[\/.\-]/);
      if (parts.length === 3) {
        let [day, month, year] = parts.map(Number);
        if (year < 100) year += 2000;
        if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000) {
          return new Date(year, month - 1, day);
        }
      }
    }
  }

  return null;
}

// ===========================================
// OCR: Reconeixement òptic de caràcters
// ===========================================

/**
 * Executa OCR sobre un PDF escanejat (sense text natiu)
 * Converteix les pàgines a imatge i usa Tesseract.js
 * @param {string|Buffer} filePathOrBuffer - Camí al fitxer o buffer
 * @returns {string|null} Text reconegut per OCR
 */
async function ocrPdf(filePathOrBuffer) {
  const tesseract = getTesseract();
  if (!tesseract) {
    logger.warn('OCR no disponible: tesseract.js no instal·lat');
    return null;
  }

  try {
    // Obtenir buffer del PDF
    let pdfBuffer;
    if (Buffer.isBuffer(filePathOrBuffer)) {
      pdfBuffer = filePathOrBuffer;
    } else {
      pdfBuffer = fs.readFileSync(filePathOrBuffer);
    }

    // Obtenir nombre de pàgines
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const uint8Array = new Uint8Array(pdfBuffer);
    const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    const numPages = Math.min(doc.numPages, 3); // Màx 3 pàgines
    await doc.destroy();

    // Convertir pàgines PDF a imatges PNG
    const pages = [];
    for (let i = 1; i <= numPages; i++) {
      const imgBuffer = await renderPdfPageToImage(pdfBuffer, i, 2.0);
      if (imgBuffer) pages.push(imgBuffer);
    }

    if (pages.length === 0) {
      logger.warn('OCR: No s\'han pogut generar imatges del PDF');
      return null;
    }

    logger.info(`OCR: Processant ${pages.length} pàgines amb Tesseract (spa+cat+eng)...`);

    // Crear worker de Tesseract amb idiomes espanyol, català i anglès
    const worker = await tesseract.createWorker('spa+cat+eng', 1, {
      logger: () => {}, // Silenciar logs de Tesseract
    });

    let fullText = '';

    for (let i = 0; i < pages.length; i++) {
      try {
        // Guardar imatge temporal
        const tmpPath = path.join(os.tmpdir(), `ocr_page_${Date.now()}_${i}.png`);
        fs.writeFileSync(tmpPath, pages[i]);

        const { data } = await worker.recognize(tmpPath);
        fullText += data.text + '\n';

        // Netejar temporal
        try { fs.unlinkSync(tmpPath); } catch {}

        logger.debug(`OCR pàgina ${i + 1}: ${data.text.length} caràcters, confiança: ${Math.round(data.confidence)}%`);
      } catch (pageErr) {
        logger.warn(`OCR: Error a la pàgina ${i + 1}: ${pageErr.message}`);
      }
    }

    await worker.terminate();

    const trimmed = fullText.trim();
    if (trimmed.length > 10) {
      logger.info(`OCR completat: ${trimmed.length} caràcters extrets`);
      return trimmed;
    }

    return null;
  } catch (err) {
    logger.error(`OCR error: ${err.message}`);
    return null;
  }
}

// ===========================================
// Funció principal: analitzar PDF complet
// ===========================================

/**
 * Analitza un PDF i extreu tota la info disponible.
 * Primer prova amb pdf-parse (text natiu).
 * Si no troba text → executa OCR amb Tesseract.
 * @param {string|Buffer} filePathOrBuffer - Camí al fitxer o buffer
 * @returns {Object} { text, invoiceNumber, nifCif, totalAmount, invoiceDate, hasText, ocrUsed }
 */
async function analyzePdf(filePathOrBuffer) {
  let text = null;
  let ocrUsed = false;

  // 1) Intentar extracció de text natiu amb pdf-parse
  if (Buffer.isBuffer(filePathOrBuffer)) {
    text = await extractTextFromBuffer(filePathOrBuffer);
  } else {
    text = await extractText(filePathOrBuffer);
  }

  // 2) Si no hi ha text natiu → OCR
  if (!text || text.trim().length < 10) {
    logger.info('PDF sense text natiu, intentant OCR...');
    text = await ocrPdf(filePathOrBuffer);
    if (text) {
      ocrUsed = true;
      logger.info(`OCR exitós: ${text.length} caràcters`);
    }
  }

  // 3) Si ni pdf-parse ni OCR han funcionat
  if (!text || text.trim().length < 10) {
    return {
      text: null,
      invoiceNumber: null,
      nifCif: [],
      totalAmount: null,
      invoiceDate: null,
      supplierName: null,
      hasText: false,
      ocrUsed: false,
    };
  }

  return {
    text,
    invoiceNumber: detectInvoiceNumber(text),
    nifCif: detectNifCif(text),
    totalAmount: detectTotalAmount(text),
    invoiceDate: detectInvoiceDate(text),
    supplierName: detectSupplierName(text),
    hasText: true,
    ocrUsed,
  };
}

/**
 * Comprova si una factura és duplicada buscant pel número de factura extret
 * @param {string} invoiceNumber - Número de factura detectat
 * @param {string} [supplierId] - ID del proveïdor (opcional, per precisió)
 * @returns {Object|null} Factura existent si és duplicada, null si no
 */
async function checkDuplicateByContent(invoiceNumber, supplierId = null) {
  if (!invoiceNumber) return null;

  const { prisma } = require('../config/database');

  const where = {
    invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' },
  };
  if (supplierId) where.supplierId = supplierId;

  const existing = await prisma.receivedInvoice.findFirst({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      status: true,
      issueDate: true,
      source: true,
      supplier: { select: { name: true } },
    },
  });

  return existing || null;
}

/**
 * Intenta trobar el proveïdor pel NIF/CIF detectat al PDF
 * @param {string[]} nifCifList - Llista de NIFs/CIFs trobats
 * @returns {Object|null} Proveïdor trobat o null
 */
async function findSupplierByNif(nifCifList) {
  if (!nifCifList || nifCifList.length === 0) return null;

  const { prisma } = require('../config/database');

  for (const nif of nifCifList) {
    const supplier = await prisma.supplier.findFirst({
      where: { nif: { equals: nif, mode: 'insensitive' } },
      select: { id: true, name: true, nif: true },
    });
    if (supplier) return supplier;
  }

  return null;
}

/**
 * Intenta trobar el proveïdor pel nom (cerca fuzzy)
 * Útil quan no tenim NIF però sí el nom de l'empresa
 * @param {string} name - Nom del proveïdor detectat
 * @returns {Object|null} Proveïdor trobat o null
 */
async function findSupplierByName(name) {
  if (!name || name.length < 3) return null;

  const { prisma } = require('../config/database');

  // Cerca exacta (case insensitive)
  let supplier = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true, nif: true },
  });
  if (supplier) return supplier;

  // Cerca parcial: el nom del PDF conté el nom del proveïdor o viceversa
  const normalizedName = name.replace(/[.,\s]+/g, ' ').trim().toUpperCase();
  const words = normalizedName.split(' ').filter(w => w.length > 2);

  if (words.length > 0) {
    // Buscar proveïdors que continguin la primera paraula significativa del nom
    const candidates = await prisma.supplier.findMany({
      where: { name: { contains: words[0], mode: 'insensitive' } },
      select: { id: true, name: true, nif: true },
    });

    // Si trobem un candidat que comparteix 2+ paraules, és probablement el mateix
    for (const candidate of candidates) {
      const candidateWords = candidate.name.replace(/[.,\s]+/g, ' ').trim().toUpperCase().split(' ').filter(w => w.length > 2);
      const matches = words.filter(w => candidateWords.includes(w));
      if (matches.length >= 2 || (matches.length >= 1 && words.length <= 2)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Troba o crea un proveïdor a partir de les dades del PDF.
 * Ordre de cerca: NIF → nom → crear nou
 * Evita duplicats usant upsert per NIF.
 * @param {string[]} nifCifList - NIFs/CIFs trobats al PDF
 * @param {string|null} supplierName - Nom detectat al PDF
 * @returns {Object|null} { id, name, nif, created }
 */
async function findOrCreateSupplier(nifCifList, supplierName) {
  const { prisma } = require('../config/database');

  // 1. Buscar per NIF
  const byNif = await findSupplierByNif(nifCifList);
  if (byNif) return { ...byNif, created: false };

  // 2. Buscar per nom
  if (supplierName) {
    const byName = await findSupplierByName(supplierName);
    if (byName) {
      // Si tenim NIF nou i el proveïdor no en té, actualitzar-lo
      if (nifCifList.length > 0 && !byName.nif) {
        await prisma.supplier.update({
          where: { id: byName.id },
          data: { nif: nifCifList[0] },
        });
        byName.nif = nifCifList[0];
      }
      return { ...byName, created: false };
    }
  }

  // 3. Crear nou proveïdor si tenim nom
  if (supplierName && supplierName.length >= 3) {
    try {
      const nif = nifCifList.length > 0 ? nifCifList[0] : null;

      // Usar upsert per NIF si el tenim (evita duplicats per race condition)
      if (nif) {
        const supplier = await prisma.supplier.upsert({
          where: { nif },
          update: {},  // Si ja existeix, no canviar res
          create: { name: supplierName, nif },
          select: { id: true, name: true, nif: true },
        });
        return { ...supplier, created: true };
      }

      // Sense NIF, crear directament
      const supplier = await prisma.supplier.create({
        data: { name: supplierName },
        select: { id: true, name: true, nif: true },
      });
      return { ...supplier, created: true };
    } catch (err) {
      logger.warn(`No s'ha pogut crear proveïdor "${supplierName}": ${err.message}`);
    }
  }

  return null;
}

module.exports = {
  extractText,
  extractTextFromBuffer,
  ocrPdf,
  detectInvoiceNumber,
  detectNifCif,
  detectTotalAmount,
  detectInvoiceDate,
  detectSupplierName,
  analyzePdf,
  checkDuplicateByContent,
  findSupplierByNif,
  findSupplierByName,
  findOrCreateSupplier,
};
