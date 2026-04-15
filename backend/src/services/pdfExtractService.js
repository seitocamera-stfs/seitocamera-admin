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

/**
 * Detecta el número de factura dins del text extret d'un PDF.
 * Prova múltiples estratègies per cobrir formats espanyols, catalans i anglesos.
 * @param {string} text - Text complet del PDF
 * @returns {string|null} Número de factura detectat, o null
 */
function detectInvoiceNumber(text) {
  if (!text || text.trim().length < 10) return null;

  // Treballar línia per línia per evitar barrejar camps de columnes diferents
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

  // ESTRATÈGIA 1: Patrons línia per línia (més precís)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    // "Nº Factura: A26 / " → buscar el número a la línia següent si està tallat
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-]*)\s*\/\s*$/i);
    if (m && i + 1 < lines.length) {
      // El número continua a la línia següent: "A26 / \n3275" → buscar número a prop
      const nextLine = lines[i + 1].trim();
      const nextNum = nextLine.match(/^(\w+)/);
      if (nextNum) return m[1] + '/' + nextNum[1];
    }

    // "Nº Factura: A26 / 3275" (tot a la mateixa línia)
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-]*)\s*\/\s*(\w+)/i);
    if (m) return m[1] + '/' + m[2];

    // "Nº Factura: A26 /" (sense res després del /)
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Factura Nº" seguit de número a la mateixa línia
    m = line.match(/factura\s*n[ºúo°]\.?\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Invoice numberUZQPSJGM0002" (Stripe/Anthropic sense espai — capturar TOT incloent números)
    m = line.match(/invoice\s*number\s*([A-Z][A-Z0-9\-]{4,})/i);
    if (m) return cleanInvoiceNumber(m[1]);

    // "Invoice number: XXX" / "Invoice no: XXX"
    m = line.match(/invoice\s*(?:number|no\.?|n[ºo°]\.?|#)\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m) return cleanInvoiceNumber(m[1]);

    // "Factura:20260489" (sense espai) / "Factura: 20260489"
    m = line.match(/^factura\s*:\s*([A-Z0-9][\w\-\/\.]{3,})/i);
    if (m && !isDateLike(m[1]) && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "FACTURA: 26-00265" que pot tenir data enganxada - separar amb regex
    m = line.match(/factura\s*:\s*(\d{2,4}[\-]\d{3,6})(?:\d{2}[\-]\d{2}[\-]\d{2,4})?/i);
    if (m) return cleanInvoiceNumber(m[1]);

    // "Núm : FA2604-0129"
    m = line.match(/^n[ºúo°u]m\.?\s*[:\s]\s*([A-Z][A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isDateLike(m[1]) && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);
  }

  // ESTRATÈGIA 2: Patrons multi-línia — buscar etiquetes seguides del valor a la línia següent
  for (let i = 0; i < lines.length; i++) {
    // "Núm.factura" a una línia i el valor a alguna línia posterior (Aigües BCN)
    // Aigües BCN: "Núm.factura" és una etiqueta de columna, el valor real és unes línies avall
    if (/^n[ºúo°u]m\.?\s*factura$/i.test(lines[i])) {
      // Buscar el primer número llarg (5+ dígits) a les línies properes
      for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
        const numMatch = lines[j].match(/^(\d{5,})$/);
        if (numMatch) return numMatch[1];
      }
    }

    // "Nº Factura: A26 /" on la línia següent és "C/ ..." (adreça, no el número)
    // Buscar el número real a la línia ANTERIOR (JUPE: "3275" està abans de "Nº Factura")
    const jupeMatch = lines[i].match(/n[ºúo°]\.?\s*factura\s*:\s*([A-Z0-9]+)\s*\/\s*$/i);
    if (jupeMatch) {
      // Buscar un número sol a les línies anteriors properes
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prevNum = lines[j].match(/^(\d{3,})$/);
        if (prevNum) return jupeMatch[1] + '/' + prevNum[1];
      }
      // Si no trobem el número anterior, retornar el que tenim
      return jupeMatch[1];
    }

    // "Factura Nº" a una línia, valor a una altra (GRAU format)
    if (/^factura\s*n[ºúo°]/i.test(lines[i])) {
      // Buscar "Referencia" + "X / Y.YYY.YYY" (GRAU usa referència com a número)
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        if (/^referencia$/i.test(lines[j]) && j + 1 < lines.length) {
          const refMatch = lines[j + 1].match(/^(\d+\s*\/\s*[\d.]+)/);
          if (refMatch) return refMatch[1].replace(/\s+/g, '');
        }
      }
    }
  }

  // ESTRATÈGIA 3: Patrons sobre text normalitzat (fallback)
  const fallbackPatterns = [
    // "FRA-XXXX" / "FRA/XXXX"
    /\b(FRA[\-\/][A-Z0-9][\w\-\/\.]+)/i,
    // "Albarà nº: XXX"
    /(?:albar[àa]|albaran)\s*(?:n[ºúo°]\.?|n[uú]m\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,
  ];

  for (const pattern of fallbackPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const num = cleanInvoiceNumber(match[1]);
      if (num && num.length >= 3) return num;
    }
  }

  return null;
}

/**
 * Neteja un número de factura detectat
 */
function cleanInvoiceNumber(num) {
  if (!num) return null;
  let clean = num.trim();
  // Eliminar puntuació final
  clean = clean.replace(/[.,;:\s]+$/, '');
  // Separar número de factura de data enganxada
  // Ex: "26-0026513-04-2026" → el patró és "XX-XXXXX" + "DD-MM-YYYY"
  const dateAtEnd = clean.match(/^(.+?)(\d{2}[\-\/]\d{2}[\-\/]\d{2,4})$/);
  if (dateAtEnd && dateAtEnd[1].length >= 3) {
    clean = dateAtEnd[1].replace(/[\-\/]+$/, '');
  }
  // Eliminar "/" final
  clean = clean.replace(/\/+$/, '');
  // Validar longitud
  if (clean.length >= 3 && clean.length <= 50) return clean;
  return null;
}

/**
 * Comprova si un string sembla una data (no un número de factura)
 */
function isDateLike(str) {
  return /^\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4}$/.test(str);
}

/**
 * Comprova si és una paraula genèrica que no és un número de factura
 */
function isGenericWord(str) {
  const words = ['fecha', 'fechac', 'page', 'pagina', 'total', 'per', 'periodo', 'periode'];
  return words.includes(str.toLowerCase());
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

  // Llista de noms propis de Seito Camera (per excloure)
  const ownNames = ['seito camera', 'seitocamera'];

  function isOwnName(name) {
    const lower = name.toLowerCase();
    return ownNames.some(own => lower.includes(own));
  }

  function isValidSupplierName(name) {
    if (!name || name.length < 3 || name.length > 100) return false;
    if (isOwnName(name)) return false;
    // Descartar línies que són clarament adreces, emails, o dades tècniques
    if (/^(emisor|enviar|cliente|datos|direc|bill\s*to|page\s*\d|qr\s*trib)/i.test(name)) return false;
    if (/^(cif|nif|tel|correo|web|dir|av\.|calle|carrer|c\/|http|www\.|email|e-mail)/i.test(name)) return false;
    if (/^\d{4,}/.test(name)) return false; // Comença amb molts números
    if (/^(veri\*factu|factu\s|registro|protección|powered|qr\s)/i.test(name)) return false;
    if (/^factu\s/i.test(name)) return false; // "FACTU CROMALITE" → treure prefix
    // Ha de contenir lletres
    if (!/[a-zA-ZàáèéìíòóùúÀÁÈÉÌÍÒÓÙÚñÑçÇ]/.test(name)) return false;
    return true;
  }

  // Estratègia 1: Buscar etiquetes directes
  const labelPatterns = [
    /(?:emisor|emitent|proveedor|prove[ïi]dor|empresa|raz[oó]n\s*social)\s*[:\s]\s*(.+)/i,
    /(?:datos?\s*(?:del?\s*)?(?:emisor|proveedor|empresa))\s*[:\s]\s*(.+)/i,
  ];

  for (const pattern of labelPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (isValidSupplierName(name)) return name;
    }
  }

  // Estratègia 2: Buscar la línia just ABANS del primer CIF/NIF (que no sigui el propi)
  for (let i = 0; i < lines.length; i++) {
    const cifMatch = lines[i].match(/(?:CIF|NIF|CIF\/NIF|N\.I\.F\.)\s*[:\s]?\s*(?:ES[\-\s]?)?([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])/i);
    if (cifMatch && cifMatch[1] && !OWN_NIF_LIST.includes(cifMatch[1].toUpperCase())) {
      // Buscar el nom a les línies anteriors (fins a 6 línies amunt per cobrir adreces llargues)
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const candidate = lines[j].trim().replace(/\s+/g, ' ');
        if (isValidSupplierName(candidate)) return candidate;
      }
    }
  }

  // Estratègia 3: Buscar després de "Emisor:" en línies
  for (let i = 0; i < lines.length; i++) {
    if (/^emisor/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        const candidate = lines[j].trim().replace(/\s+/g, ' ');
        if (isValidSupplierName(candidate)) return candidate;
      }
    }
  }

  // Estratègia 4: Buscar "NomEmpresa, S.L." o "NomEmpresa, S.A." a les primeres 15 línies
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i].trim();
    // Patró: "EMPRESA, S.L." / "EMPRESA S.L." / "EMPRESA, S.A." / "EMPRESA SLP"
    // Inclou cas "CROMALITE, SLNIF:B60..." → agafar fins al NIF
    let m = line.match(/^([A-ZÀ-Ú][A-ZÀ-Ú\s&.,]+(?:S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?|S\.?C\.?P\.?))(?:\s*NIF|$)/i);
    if (m && isValidSupplierName(m[1].trim())) {
      return m[1].trim().replace(/\s+/g, ' ');
    }
    // Versió completa línia
    m = line.match(/^([A-ZÀ-Ú][A-ZÀ-Ú\s&.,]+(?:S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?|S\.?C\.?P\.?))$/i);
    if (m && isValidSupplierName(m[1].trim())) {
      return m[1].trim().replace(/\s+/g, ' ');
    }
  }

  // Estratègia 5: Per factures angleses (Anthropic, Stripe, etc.)
  // Buscar la primera línia significativa abans de l'adreça
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/^(invoice|receipt)$/i.test(lines[i])) {
      // Buscar nom empresa després del títol + número
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const line = lines[j].trim();
        // Saltar línies de número/data
        if (/^(invoice|receipt|date|page|bill)/i.test(line)) continue;
        if (/^\d/.test(line)) continue;
        // Primera línia que sembla un nom d'empresa
        if (line.length >= 5 && /[A-Z]/.test(line) && !line.includes('@') && !/^\d/.test(line)) {
          // Comprovar que no és l'adreça
          if (!/^\d+\s/.test(line) && !isOwnName(line)) {
            return line.replace(/\s+/g, ' ');
          }
        }
      }
    }
  }

  // Estratègia 6: Agafar el nom de la primera línia amb format "EMPRESA, S.L." de qualsevol lloc
  const slMatch = text.match(/([A-ZÀ-Ú][A-ZÀ-Ú\s&.,]+(?:S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?))/);
  if (slMatch && isValidSupplierName(slMatch[1].trim()) && !isOwnName(slMatch[1])) {
    return slMatch[1].trim().replace(/\s+/g, ' ');
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
    if (/subtotal/i.test(line)) continue;

    const totalMatch = line.match(/total\s*[:\s]?\s*€?\s*([\d.,]+)/i);
    if (totalMatch && totalMatch[1]) {
      const num = parseEuropeanNumber(totalMatch[1]);
      if (!isNaN(num) && num > 0) amounts.push(num);
    }
  }

  // Estratègia 3: "€XX.XX due" o "€XX.XX paid" (format Stripe/Anthropic)
  const euroPatterns = [
    /€\s*([\d.,]+)\s*(?:due|paid|a pagar)/i,
    /(?:amount\s*due|amount\s*paid|total\s*a\s*pagar)\s*€?\s*([\d.,]+)/i,
    /(?:total\s*€|total\s*eur)\s*([\d.,]+)/i,
    // "25,41TOTAL €" (KINOLUX format: número abans de TOTAL)
    /([\d.,]+)\s*TOTAL\s*€/i,
    // "TOTAL A PAGAR XX,XX €"
    /total\s*a\s*pagar\s*([\d.,]+)\s*€?/i,
    // "IMPORTE LIQUIDO XX,XX"
    /import[e]?\s*l[ií]quid[oa]?\s*([\d.,]+)/i,
  ];

  for (const pattern of euroPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const num = parseEuropeanNumber(match[1]);
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
