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

  // ===========================================
  // ESTRATÈGIA 1: Patrons línia per línia (més precís)
  // ===========================================
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    // --- CATALÀ ---
    // "Nº Factura: A26 / " → buscar el número a la línia següent si està tallat
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-]*)\s*\/\s*$/i);
    if (m && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const nextNum = nextLine.match(/^(\w+)/);
      if (nextNum) return m[1] + '/' + nextNum[1];
    }

    // "Nº Factura: A26 / 3275" (tot a la mateixa línia)
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-]*)\s*\/\s*(\w+)/i);
    if (m) return m[1] + '/' + m[2];

    // "Nº Factura: A26 /"
    m = line.match(/n[ºúo°]\.?\s*factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Factura Nº" seguit de número
    m = line.match(/factura\s*n[ºúo°]\.?\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // --- CASTELLÀ ---
    // "Número de factura: XXX" / "Número de la factura: XXX" / "Num. factura: XXX"
    m = line.match(/n[úu]mero\s*(?:de\s+(?:la\s+)?)?factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1]) && !isDateLike(m[1])) return cleanInvoiceNumber(m[1]);

    // "Nro. Factura: XXX" / "Nro de la Factura XXX"
    m = line.match(/nro\.?\s*(?:de\s+(?:la\s+)?)?factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1]) && !isDateLike(m[1])) return cleanInvoiceNumber(m[1]);

    // "Ref. Factura: XXX" / "Referencia de la factura: XXX"
    m = line.match(/ref(?:erencia)?\.?\s*(?:de\s+(?:la\s+)?)?factura\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1]) && !isDateLike(m[1])) return cleanInvoiceNumber(m[1]);

    // --- ANGLÈS ---
    // "Invoice numberUZQPSJGM0002" (Stripe/Anthropic sense espai)
    m = line.match(/invoice\s*number\s*([A-Z][A-Z0-9\-]{4,})/i);
    if (m) return cleanInvoiceNumber(m[1]);

    // "Invoice Number: XXXXXXXXX" / "Invoice number : XXX" / "Invoice No.: XXX"
    // "Invoice no: XXX" / "Invoice #XXX" / "Invoice ID: XXX"
    m = line.match(/invoice\s*(?:number|no\.?|n[ºo°]\.?|#|id)\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Invoice: XXX" (sol)
    m = line.match(/^invoice\s*:\s*([A-Z0-9][\w\-\/\.]{3,})/i);
    if (m && !isDateLike(m[1]) && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Receipt number: XXX" / "Receipt #XXX"
    m = line.match(/receipt\s*(?:number|no\.?|#|id)\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Credit note: XXX" / "Credit memo: XXX"
    m = line.match(/credit\s*(?:note|memo)\s*(?:number|no\.?|#|id)?\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Bill number: XXX" / "Bill no: XXX"
    m = line.match(/bill\s*(?:number|no\.?|#|id)\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "Document number: XXX" / "Document no: XXX" (en/es)
    m = line.match(/document[o]?\s*(?:number|no\.?|n[ºúo°]\.?|#)\s*[:\s]\s*([A-Z0-9][\w\-\/\.]+)/i);
    if (m && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // --- GENÈRICS ---
    // "Factura:20260489" (sense espai) / "Factura: 20260489"
    m = line.match(/^factura\s*:\s*([A-Z0-9][\w\-\/\.]{3,})/i);
    if (m && !isDateLike(m[1]) && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "FACTURA: 26-00265" que pot tenir data enganxada
    m = line.match(/factura\s*:\s*(\d{2,4}[\-]\d{3,6})(?:\d{2}[\-]\d{2}[\-]\d{2,4})?/i);
    if (m) return cleanInvoiceNumber(m[1]);

    // "Núm : FA2604-0129" / "Número: 2026/0489"
    m = line.match(/^n[ºúo°u]m(?:ero)?\.?\s*[:\s]\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isDateLike(m[1]) && !isGenericWord(m[1])) return cleanInvoiceNumber(m[1]);

    // "ADJUNTAMOS FACTURA Nº 20260489" / "su factura nº 123"
    m = line.match(/factura\s*(?:n[ºúo°]\.?|num\.?|número|number)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]{2,})/i);
    if (m && !isGenericWord(m[1]) && !isDateLike(m[1])) return cleanInvoiceNumber(m[1]);
  }

  // ===========================================
  // ESTRATÈGIA 1b: Bloc d'etiquetes + bloc de valors (PDFs amb layout de columnes)
  // Detecta patrons com FedEx on les etiquetes estan agrupades consecutivament
  // i els valors estan en un bloc separat que segueix:
  //   Customer Number:
  //   Invoice Number:      ← etiquetes
  //   Invoice Date:
  //   ...
  //   206864441
  //   213750680            ← valors (mateix ordre)
  //   05/03/2026
  // IMPORTANT: Aquesta estratègia va ABANS de l'Estratègia 2 perquè sinó
  // l'Estratègia 2 agafaria el "Customer Number" com a invoice number.
  // ===========================================
  {
    const labelPatterns = [
      { regex: /^invoice\s*(?:number|no\.?|#|n[ºo°]\.?)\s*:?\s*$/i, type: 'invoice_number' },
      { regex: /^n[ºúo°u]m(?:ero)?\.?\s*(?:de\s+)?factura\s*:?\s*$/i, type: 'invoice_number' },
      { regex: /^factura\s*(?:n[ºúo°]\.?|number)\s*:?\s*$/i, type: 'invoice_number' },
      { regex: /^customer\s*(?:number|no\.?|#)\s*:?\s*$/i, type: 'customer_number' },
      { regex: /^(?:account|acct\.?)\s*(?:number|no\.?|#)\s*:?\s*$/i, type: 'account_number' },
      { regex: /^invoice\s*(?:date|data)\s*:?\s*$/i, type: 'date' },
      { regex: /^invoice\s*(?:amount|import)\s*:?\s*$/i, type: 'amount' },
      { regex: /^amount\s*(?:due|paid)\s*:?\s*$/i, type: 'amount' },
      { regex: /^(?:ship|shipping)\s*date\s*:?\s*$/i, type: 'date' },
      { regex: /^(?:shipment|tracking)\s*(?:number|no\.?|#)?\s*:?\s*$/i, type: 'shipment' },
    ];

    for (let i = 0; i < lines.length - 2; i++) {
      const firstLabel = labelPatterns.find(p => p.regex.test(lines[i]));
      if (!firstLabel) continue;

      // Comptar etiquetes consecutives (permetent gaps d'etiquetes no reconegudes)
      const labelBlock = [{ line: lines[i], type: firstLabel.type, index: i }];
      let gapCount = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        const label = labelPatterns.find(p => p.regex.test(lines[j]));
        if (label) {
          labelBlock.push({ line: lines[j], type: label.type, index: j });
          gapCount = 0;
        } else if (lines[j].trim().length > 0) {
          gapCount++;
          if (/^[A-Za-z\s.]+:?\s*$/.test(lines[j]) && gapCount <= 3) continue;
          if (labelBlock.length >= 2 && gapCount > 3) break;
        }
      }

      // Necessitem almenys 2 etiquetes, una de les quals sigui 'invoice_number'
      const invoiceLabel = labelBlock.find(l => l.type === 'invoice_number');
      if (!invoiceLabel || labelBlock.length < 2) continue;

      const lastLabelIndex = labelBlock[labelBlock.length - 1].index;
      const invoiceLabelPosition = labelBlock.indexOf(invoiceLabel);

      // Buscar valors numèrics/alfanumèrics després de totes les etiquetes
      const values = [];
      for (let j = lastLabelIndex + 1; j < Math.min(lines.length, lastLabelIndex + 20); j++) {
        const val = lines[j].trim();
        if (!val) continue;
        if (labelPatterns.some(p => p.regex.test(val))) continue;
        if (/^[A-Za-z\s.]+:?\s*$/.test(val)) continue;
        if (/^[A-Za-z\s]+$/.test(val)) continue;
        if (/\*{3,}/.test(val)) continue;
        if (/\d/.test(val)) {
          values.push(val);
        }
        if (values.length >= labelBlock.length) break;
      }

      if (values.length > invoiceLabelPosition) {
        const invoiceValue = values[invoiceLabelPosition].trim();
        if (/^[A-Z0-9][\w\-\/\.]{2,}$/i.test(invoiceValue) && !isDateLike(invoiceValue) && !isGenericWord(invoiceValue)) {
          logger.debug(`detectInvoiceNumber: Bloc etiqueta-valor → "${invoiceValue}" (posició ${invoiceLabelPosition})`);
          return cleanInvoiceNumber(invoiceValue);
        }
        if (/^\d{5,}$/.test(invoiceValue)) {
          logger.debug(`detectInvoiceNumber: Bloc etiqueta-valor (numèric) → "${invoiceValue}"`);
          return invoiceValue;
        }
      }
    }
  }

  // ===========================================
  // ESTRATÈGIA 2: Patrons multi-línia — etiqueta + valor a línia següent
  // ===========================================
  for (let i = 0; i < lines.length; i++) {
    // Etiquetes que indiquen número de factura en qualsevol idioma
    // Accepta `:` i espais opcionals al final (ex: "Invoice Number:", "Nº Factura :")
    // Accepta "de la" opcional (ex: "Número de la factura:")
    // Accepta "FACTURA" sola (capçalera de taula)
    const isInvoiceLabel = /^(?:n[ºúo°]\.?\s*(?:de\s+(?:la\s+)?)?factura|n[ºúo°u]m\.?\s*(?:de\s+(?:la\s+)?)?factura|invoice\s*(?:number|no\.?|#)|factura\s*n[ºúo°]\.?|receipt\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?)|n[úu]mero\s*(?:de\s+(?:la\s+)?)?factura|ref\.?\s*(?:de\s+(?:la\s+)?)?factura)\s*:?\s*$/i;

    if (isInvoiceLabel.test(lines[i])) {
      // Buscar valor a les línies properes
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const val = lines[j].trim();
        // Acceptar número alfanumèric (no dates, no paraules genèriques)
        if (/^[A-Z0-9][\w\-\/\.]{2,}$/i.test(val) && !isDateLike(val) && !isGenericWord(val) && !isNifLike(val)) {
          return cleanInvoiceNumber(val);
        }
        // Acceptar número llarg (5+ dígits)
        if (/^\d{5,}$/.test(val)) return val;
      }
    }

    // Capçalera de taula: línia que conté "FACTURA" com a columna
    // Ex: "FECHA  CLIENTE Nº  FACTURA  PÁGINA"
    // El valor numèric alineat sota "FACTURA" està a la línia de valors
    if (/\bFACTURA\b/i.test(lines[i]) && /\b(?:fecha|data|date|client|pàgina|página|page)\b/i.test(lines[i])) {
      const headerLine = lines[i];
      const facturaPos = headerLine.search(/\bFACTURA\b/i);
      if (facturaPos >= 0) {
        // Buscar la línia de valors (la següent que contingui números/text)
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          const valLine = lines[j];
          if (valLine.length < 3) continue;
          // Extreure tots els "tokens" (paraules/números) amb la seva posició dins la línia
          const tokenRegex = /\S+/g;
          let tm;
          const valTokens = [];
          while ((tm = tokenRegex.exec(valLine)) !== null) {
            valTokens.push({ text: tm[0], pos: tm.index });
          }
          // Trobar el token més proper a la posició de "FACTURA" a la capçalera
          let bestToken = null;
          let bestDist = Infinity;
          for (const vt of valTokens) {
            const dist = Math.abs(vt.pos - facturaPos);
            if (dist < bestDist && /^[A-Z0-9][\w\-\/\.]*$/i.test(vt.text)) {
              bestDist = dist;
              bestToken = vt.text;
            }
          }
          if (bestToken && bestToken.length >= 1 && !isDateLike(bestToken) && !isGenericWord(bestToken)) {
            // Per números molt curts (1-2 dígits), només acceptar si la posició coincideix gairebé exacte
            if (bestToken.length <= 2 && bestDist > 5) continue;
            return bestToken;
          }
        }
      }
    }

    // "Nº Factura: A26 /" on la línia següent és "C/ ..." (adreça, no el número)
    const jupeMatch = lines[i].match(/n[ºúo°]\.?\s*factura\s*:\s*([A-Z0-9]+)\s*\/\s*$/i);
    if (jupeMatch) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prevNum = lines[j].match(/^(\d{3,})$/);
        if (prevNum) return jupeMatch[1] + '/' + prevNum[1];
      }
      return jupeMatch[1];
    }

    // "Factura Nº" a una línia, valor a una altra (GRAU format)
    if (/^factura\s*n[ºúo°]/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        if (/^referencia$/i.test(lines[j]) && j + 1 < lines.length) {
          const refMatch = lines[j + 1].match(/^(\d+\s*\/\s*[\d.]+)/);
          if (refMatch) return refMatch[1].replace(/\s+/g, '');
        }
      }
    }
  }

  // ===========================================
  // ESTRATÈGIA 2b: Proximitat — paraula "factura"/"invoice" + número proper
  // Si veiem la paraula clau i a prop hi ha una seqüència alfanumèrica,
  // és molt probablement el número de factura.
  // ===========================================
  {
    // Paraules clau que indiquen "número de factura" (en qualsevol idioma)
    const invoiceKeywords = /\b(?:factura|invoice|receipt|bill|fra\.?)\b/gi;
    // Paraules que acompanyen la keyword i que NO són el número
    const skipWords = /^(?:fecha|data|date|n[ºúo°]|num|número|number|no|id|de|la|del|le|el|al|per|por|for|the|client[ea]?|pàgina|página|page|total|iva|vat|tax|import[e]?|base|pendent[e]?|pagad[ao]|paid|unpaid|adjunt|attached|rebud[ao]|emesa|issued|received)$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      invoiceKeywords.lastIndex = 0;
      const kwMatch = invoiceKeywords.exec(line);
      if (!kwMatch) continue;

      // Buscar tokens alfanumèrics a la MATEIXA línia, DESPRÉS de la keyword
      const afterKeyword = line.slice(kwMatch.index + kwMatch[0].length);
      const tokensAfter = afterKeyword.match(/[A-Z0-9][\w\-\/\.]*[A-Z0-9]/gi) || [];
      for (const token of tokensAfter) {
        if (!isDateLike(token) && !isGenericWord(token) && !isNifLike(token) && !skipWords.test(token)) {
          const cleaned = cleanInvoiceNumber(token);
          if (cleaned) return cleaned;
        }
      }

      // Si no hi ha res vàlid a la mateixa línia, buscar a la línia SEGÜENT
      // (comú en taules: "FACTURA" a capçalera, "569" a la fila de sota)
      if (i + 1 < lines.length) {
        const nextTokens = lines[i + 1].match(/[A-Z0-9][\w\-\/\.]*[A-Z0-9]|\d+/g) || [];
        for (const token of nextTokens) {
          if (token.length >= 1 && !isDateLike(token) && !isGenericWord(token) && !isNifLike(token) && !skipWords.test(token)) {
            // Preferir tokens que semblen números de factura (no pàgines, no anys solts)
            if (/^\d{1,2}$/.test(token)) continue; // Skip "1", "01" (probablement pàgina o quantitat)
            const cleaned = cleanInvoiceNumber(token);
            if (cleaned) return cleaned;
            // Si cleanInvoiceNumber el rebutja per curt, acceptar si >= 3 chars
            if (token.length >= 3) return token;
          }
        }
      }
    }
  }

  // ===========================================
  // ESTRATÈGIA 3: Patrons sobre text normalitzat (fallback)
  // ===========================================
  const fallbackPatterns = [
    // "FRA-XXXX" / "FRA/XXXX" / "FRA.XXXX"
    /\b(FRA[\-\/\.][A-Z0-9][\w\-\/\.]+)/i,
    // "INV-XXXX" / "INV/XXXX"
    /\b(INV[\-\/][A-Z0-9][\w\-\/\.]+)/i,
    // "REC-XXXX" (receipt)
    /\b(REC[\-\/][A-Z0-9][\w\-\/\.]+)/i,
    // "Albarà nº: XXX" / "Albarán nº: XXX"
    /(?:albar[àa]n?)\s*(?:n[ºúo°]\.?|n[uú]m\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,
    // "Pressupost nº: XXX" / "Presupuesto nº: XXX"
    /(?:pressupost|presupuesto)\s*(?:n[ºúo°]\.?|n[uú]m\.?)\s*[:\s]?\s*([A-Z0-9][\w\-\/\.]+)/i,
  ];

  for (const pattern of fallbackPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const num = cleanInvoiceNumber(match[1]);
      if (num && num.length >= 3) return num;
    }
  }

  // ===========================================
  // ESTRATÈGIA 4: Últim recurs — buscar patrons comuns de número de factura
  // Format: YYYY/NNN, YYYY-NNN, XX-NNNNN, XXYY-NNN
  // ATENCIÓ: Exclou patrons coneguts que NO són factures:
  //   - 2006/112 = Directiva EU sobre IVA (apareix a factures Amazon, etc.)
  //   - Anys anteriors a 2020 són sospitosos (probablement referència legal)
  // ===========================================
  const knownNonInvoice = ['2006/112', '2006-112'];

  for (const line of lines) {
    // "2026/0489" o "2026-0489" (any/seqüencial) — però no dates
    // Només anys recents (2020+) per evitar referències legals
    let m = line.match(/\b(20[2-9]\d[\/-]\d{3,6})\b/);
    if (m && !isDateLike(m[1]) && !knownNonInvoice.includes(m[1])) {
      return cleanInvoiceNumber(m[1]);
    }

    // "A26/3275" (lletra + any curt + número) — mínim 3 dígits després del /
    m = line.match(/\b([A-Z]\d{2}[\/-]\d{3,6})\b/);
    if (m) return cleanInvoiceNumber(m[1]);
  }

  return null;
}

/**
 * Comprova si un string sembla un NIF/CIF (per no confondre'l amb número de factura)
 */
function isNifLike(str) {
  return /^[A-Z]\d{7}[A-Z0-9]$/.test(str) || /^\d{8}[A-Z]$/.test(str);
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

  // Rebutjar si acaba en "/X" (una sola lletra) — probablement columna de taula truncada
  // Ex: "A26/C" (on C és una columna), "A26/D" (on D és "Descripció")
  if (/\/[A-Za-z]$/.test(clean)) return null;

  // Rebutjar si és purament una paraula genèrica
  if (isGenericWord(clean)) return null;

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
  const lower = str.toLowerCase();
  const words = [
    'fecha', 'fechac', 'page', 'pagina', 'total', 'per', 'periodo', 'periode',
    'data', 'date', 'from', 'to', 'de', 'del', 'client', 'cliente', 'amount',
    'importe', 'import', 'name', 'nombre', 'nom', 'vencimiento', 'venciment',
    'emision', 'emisio', 'emisión', 'emissió', 'description', 'descripcion',
    'descripcio', 'concepto', 'concepte', 'payment', 'pago', 'pagament',
    'subtotal', 'base', 'iva', 'irpf', 'retencio', 'retencion',
    // Documents fiscals — NO són números de factura
    'nif', 'cif', 'nie', 'dni', 'vat', 'tax', 'fiscal',
    // Paraules que el detector confon amb números
    'factura', 'invoice', 'receipt', 'bill', 'credit', 'debit',
    'numero', 'number', 'num', 'ref', 'referencia', 'reference',
    // Columnes de taula
    'descripció', 'descripcion', 'description', 'detall', 'detalle', 'detail',
    'quantitat', 'cantidad', 'quantity', 'preu', 'precio', 'price',
    'unitat', 'unidad', 'unit', 'servei', 'servicio', 'service',
  ];
  if (words.includes(lower)) return true;
  // Paraules que comencen amb prefix genèric (Descripci..., Referenci...)
  if (/^(descripci|referenci|quantita|cantida|servici)/i.test(lower)) return true;
  return false;
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
// Detecció del tipus de document
// ===========================================

/**
 * Detecta el tipus de document analitzant les primeres línies / capçalera del text.
 * Retorna un objecte { type, confidence, label }.
 *
 * Tipus possibles:
 *   'invoice'     — Factura (el que volem)
 *   'receipt'     — Rebut de pagament / comprovant
 *   'delivery'    — Albarà / nota de lliurament
 *   'quote'       — Pressupost / oferta
 *   'credit_note' — Nota de crèdit / abonament
 *   'statement'   — Extracte / resum
 *   'order'       — Comanda / ordre de compra
 *   'contract'    — Contracte
 *   'unknown'     — No identificat (es tracta com a factura per defecte)
 */
function detectDocumentType(text) {
  if (!text) return { type: 'unknown', confidence: 0, label: 'Desconegut' };

  // Analitzar les primeres 2000 chars (capçalera del document)
  const header = text.substring(0, 2000).toLowerCase();

  // Ordre d'importància: buscar primer els NO-factura, perquè "factura" pot aparèixer dins d'un rebut
  const patterns = [
    // Rebuts / comprovants de pagament
    {
      type: 'receipt',
      label: 'Rebut de pagament',
      patterns: [
        /\brecibo\s+de\s+pago/i,
        /\brecibo\b.*\bpago\b/i,
        /\brebut\s+de\s+pagament/i,
        /\bpayment\s+receipt\b/i,
        /\bcomprovant\s+de\s+pagament/i,
        /\bcomprobante\s+de\s+pago/i,
        /\breceipt\b(?!.*\binvoice\b)/i,  // "receipt" sense "invoice" al costat
        /\bimporte\s+recibido\b/i,
        /\bimport\s+rebut\b/i,
      ],
    },
    // Notes de crèdit / abonament
    {
      type: 'credit_note',
      label: 'Nota de crèdit',
      patterns: [
        /\bnota\s+de\s+cr[eè]dit/i,
        /\bnota\s+de\s+abono/i,
        /\bcredit\s+note\b/i,
        /\babonament\b/i,
        /\brectificativa\b/i,
        /\bfactura\s+rectificativa/i,
      ],
    },
    // Albarans
    {
      type: 'delivery',
      label: 'Albarà',
      patterns: [
        /\balbar[aà][n]?\b/i,
        /\bnota\s+(?:de\s+)?(?:lliurament|entrega|envío)\b/i,
        /\bdelivery\s+note\b/i,
        /\bpacking\s+(?:slip|list)\b/i,
        /\bguia\s+de\s+(?:remissió|remisi[oó]n)\b/i,
      ],
    },
    // Pressupostos / ofertes
    {
      type: 'quote',
      label: 'Pressupost',
      patterns: [
        /\bpressupost\b/i,
        /\bpresupuesto\b/i,
        /\bquotation\b/i,
        /\bquote\b/i,
        /\boferta\b/i,
        /\bproforma\b/i,
        /\bestimation\b/i,
        /\bestimate\b/i,
      ],
    },
    // Extractes / resums de compte
    {
      type: 'statement',
      label: 'Extracte',
      patterns: [
        /\bextracte?\b.*\bcompte?\b/i,
        /\bextracto\b.*\bcuenta\b/i,
        /\baccount\s+statement\b/i,
        /\bbank\s+statement\b/i,
        /\bresum\s+de\s+compte\b/i,
        /\bresumen\s+de\s+cuenta\b/i,
      ],
    },
    // Comandes
    {
      type: 'order',
      label: 'Comanda',
      patterns: [
        /\bordre\s+de\s+compra\b/i,
        /\borden\s+de\s+compra\b/i,
        /\bpurchase\s+order\b/i,
        /\bcomanda\b/i,
        /\bpedido\b/i,
      ],
    },
    // Contractes
    {
      type: 'contract',
      label: 'Contracte',
      patterns: [
        /\bcontracte?\b/i,
        /\bcontract\b/i,
        /\bacord\b/i,
        /\bacuerdo\b/i,
        /\bconveni\b/i,
      ],
    },
  ];

  // Buscar coincidències a la capçalera
  for (const group of patterns) {
    for (const regex of group.patterns) {
      if (regex.test(header)) {
        // Verificar que NO hi ha "factura" com a títol principal (que sobreescriuria)
        // Un rebut pot mencionar "Número de factura" dins la taula, però el títol és "RECIBO"
        const hasInvoiceTitle = /\b(?:factura|invoice)\b/i.test(header.substring(0, 500));
        const isFirstMention = header.search(regex) < header.search(/\b(?:factura|invoice)\b/i);

        if (!hasInvoiceTitle || isFirstMention) {
          logger.debug(`detectDocumentType: ${group.type} (${group.label}) — pattern: ${regex}`);
          return { type: group.type, confidence: 0.9, label: group.label };
        }
      }
    }
  }

  // Si trobem "factura" o "invoice" explícitament
  if (/\b(?:factura|invoice|fra\.)\b/i.test(header)) {
    return { type: 'invoice', confidence: 0.9, label: 'Factura' };
  }

  // Per defecte: desconegut (es tractarà com a factura)
  return { type: 'unknown', confidence: 0.3, label: 'Desconegut' };
}

// ===========================================
// Detecció d'imports
// ===========================================

// Patrons que DEFINITIVAMENT són el total final (amb IVA inclòs)
const DEFINITIVE_TOTAL_PATTERNS = [
  // "Total de la factura: 9,01 €" / "Total factura: 9,01"
  /total\s*(?:de\s*(?:la\s*)?)?factura\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "Total a pagar: 9,01 €" / "Total a cobrar"
  /total\s*a\s*(?:pagar|cobrar)\s*[:\s]?\s*€?\s*([\d.,]+)/i,
  // "TOTAL IVA inclòs: 1.234,56" / "Total amb IVA"
  /total\s*(?:iva\s*incl[oòuú]s|amb\s*iva|iva\s*incl\.?|inc(?:luding)?\s*(?:vat|tax))\s*[:\s]?\s*€?\s*([\d.,]+)/i,
  // "Importe total: 1.234,56" / "Import total:"
  /import[e]?\s*total\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "IMPORTE LIQUIDO XX,XX" / "Import líquid"
  /import[e]?\s*l[ií]quid[oa]?\s*[:\s]?\s*€?\s*([\d.,]+)/i,
  // "Amount due: XX.XX" / "Amount paid"
  /amount\s*(?:due|paid)\s*[:\s]?\s*€?\s*([\d.,]+)/i,
  // "€XX.XX due" / "€XX.XX paid"
  /€\s*([\d.,]+)\s*(?:due|paid)/i,
  // "25,41TOTAL €" (KINOLUX format: número abans de TOTAL)
  /([\d.,]+)\s*TOTAL\s*€/i,
  // "TOTAL A PAGAR XX,XX €"  (duplicat de dalt però per seguretat amb format diferent)
  /total\s*a\s*pagar\s*([\d.,]+)\s*€?/i,
  // "Total general: XX,XX"
  /total\s*general\s*[:\s]\s*€?\s*([\d.,]+)/i,
];

// Patrons que indiquen BASE IMPOSABLE (sense IVA) — els hem d'excloure del total
const BASE_EXCLUSION_PATTERNS = [
  /iva\s*exclu[ií]d[oa]/i,         // "IVA excluido" / "IVA exclòs"
  /sin\s*iva/i,                     // "sin IVA"
  /sense\s*iva/i,                   // "sense IVA"
  /antes?\s*(?:de\s*)?iva/i,        // "antes de IVA"
  /hors?\s*tax[ea]?s?/i,            // "hors taxe" (francès)
  /excl(?:uding|\.?)?\s*(?:vat|tax|iva)/i,  // "excl. VAT", "excluding tax"
  /before\s*(?:vat|tax)/i,          // "before VAT"
  /without\s*(?:vat|tax)/i,         // "without VAT"
  /nett?o/i,                        // "neto" / "netto" (import net = base)
  /base\s*imp/i,                    // "base imposable" / "base imponible"
  /\btaxable\b/i,                   // "taxable amount"
  /\bsubtotal\b/i,                  // "subtotal"
  /iva\s*\d+\s*%/i,                 // "IVA 21%" (parcial d'IVA, no total)
];

// Patrons genèrics de "Total" (menys fiables, poden ser base)
const GENERIC_TOTAL_PATTERNS = [
  // "Total: 1.234,56 €"
  /total\s*[:\s]\s*€?\s*([\d.,]+)/i,
  // "Total1.230,57" o "Total 1.230,57"
  /total\s*([\d.,]+)\s*€?/i,
  // "TOTAL: €1,234.56"
  /total\s*[:\s]\s*€\s*([\d.,]+)/i,
  // "Total € XX" / "Total EUR XX"
  /(?:total\s*€|total\s*eur)\s*([\d.,]+)/i,
];

/**
 * Parseja un string numèric en format europeu a float
 * @param {string} numStr - "1.230,57" o "1230.57" o "1230,57"
 * @returns {number|NaN}
 */
function parseEuropeanNumber(numStr) {
  let s = numStr.trim();
  // Format europeu complet: 1.234,56 → 1234.56
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // Només coma (decimal europeu): 1234,56 → 1234.56
    s = s.replace(',', '.');
  } else if (s.includes('.')) {
    // Només punt: determinar si és separador de milers o decimal
    // Si hi ha múltiples punts → sempre milers: "1.234.567" → "1234567"
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1) {
      s = s.replace(/\./g, '');
    } else {
      // Un sol punt: comprovar si el que hi ha després del punt són exactament 3 dígits
      // "1.234" → milers (1234), "12.34" → decimal (12.34), "1.2" → decimal (1.2)
      const parts = s.split('.');
      if (parts[1] && parts[1].length === 3) {
        // Separador de milers: "1.234" → "1234", "12.345" → "12345"
        s = s.replace('.', '');
      }
      // Si no són 3 dígits, és un decimal anglosaxó: "12.34" → 12.34
    }
  }
  return parseFloat(s);
}

/**
 * Comprova si una línia conté indicadors de base imposable (sense IVA).
 * @param {string} line
 * @returns {boolean}
 */
function isBaseLine(line) {
  return BASE_EXCLUSION_PATTERNS.some((p) => p.test(line));
}

/**
 * Detecta l'import total dins del text.
 * Prioritza patrons definitius (total factura, total a pagar, etc.)
 * sobre patrons genèrics (total + número).
 * Exclou línies que contenen indicadors de base imposable.
 * @param {string} text
 * @returns {number|null}
 */
function detectTotalAmount(text) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ');
  const lines = text.split('\n');

  // ----- PRIORITAT 1: Patrons definitius (total amb IVA segur) -----
  const definitiveAmounts = [];

  // 1a. Patrons definitius sobre text normalitzat
  for (const pattern of DEFINITIVE_TOTAL_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const num = parseEuropeanNumber(match[1]);
      if (!isNaN(num) && num > 0) {
        logger.debug(`detectTotalAmount: definitiu (normalitzat) → ${num} [${pattern}]`);
        definitiveAmounts.push(num);
      }
    }
  }

  // 1b. Patrons definitius per línia (per no barrejar amb altres línies)
  for (const line of lines) {
    if (isBaseLine(line)) continue; // Saltar línies de base

    for (const pattern of DEFINITIVE_TOTAL_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseEuropeanNumber(match[1]);
        if (!isNaN(num) && num > 0) {
          definitiveAmounts.push(num);
        }
      }
    }
  }

  // Si tenim imports definitius, retornar el més gran
  if (definitiveAmounts.length > 0) {
    const result = Math.max(...definitiveAmounts);
    logger.debug(`detectTotalAmount: retornant definitiu → ${result}`);
    return result;
  }

  // ----- PRIORITAT 2: Patrons genèrics "Total" (filtrant base imposable) -----
  const genericAmounts = [];

  for (const line of lines) {
    // Saltar línies que indiquen base imposable
    if (isBaseLine(line)) continue;
    // Saltar "total (base..."
    if (/total\s*\(base/i.test(line)) continue;

    for (const pattern of GENERIC_TOTAL_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseEuropeanNumber(match[1]);
        if (!isNaN(num) && num > 0) {
          logger.debug(`detectTotalAmount: genèric → ${num} [línia: "${line.trim().substring(0, 60)}"]`);
          genericAmounts.push(num);
        }
      }
    }
  }

  if (genericAmounts.length > 0) {
    const result = Math.max(...genericAmounts);
    logger.debug(`detectTotalAmount: retornant genèric (màxim) → ${result}`);
    return result;
  }

  // ----- PRIORITAT 3 (últim recurs): buscar el número amb € més gran del text complet -----
  const allAmounts = [];
  const globalPatterns = [
    /([\d.,]+)\s*€/g,
    /€\s*([\d.,]+)/g,
    /([\d.,]+)\s*EUR\b/gi,
    /USD\s*([\d.,]+)/gi,
    /\$\s*([\d.,]+)/g,
  ];
  for (const gp of globalPatterns) {
    let m;
    while ((m = gp.exec(normalized)) !== null) {
      const num = parseEuropeanNumber(m[1]);
      if (!isNaN(num) && num > 0.5) allAmounts.push(num);
    }
  }
  if (allAmounts.length > 0) {
    const result = Math.max(...allAmounts);
    logger.debug(`detectTotalAmount: últim recurs → ${result} (de ${allAmounts.length} imports trobats)`);
    return result;
  }

  return null;
}

/**
 * Detecta la base imposable (import sense IVA) dins del text.
 * Busca línies amb "Base imposable", "Subtotal", "Precio total (IVA excluido)", etc.
 * @param {string} text
 * @returns {number|null}
 */
function detectBaseAmount(text) {
  if (!text) return null;

  const lines = text.split('\n');
  const amounts = [];

  const basePatterns = [
    // "Base imposable: 7,45 €" / "Base imponible: 7,45"
    /base\s*(?:imposable|imponible)\s*[:\s]\s*€?\s*([\d.,]+)/i,
    // "Subtotal: 7,45"
    /subtotal\s*[:\s]\s*€?\s*([\d.,]+)/i,
    // "Precio total (IVA excluido): 7,45"
    /(?:precio\s*)?total\s*\(?\s*(?:iva\s*exclu[ií]d[oa]|sin\s*iva|sense\s*iva)\s*\)?\s*[:\s]?\s*€?\s*([\d.,]+)/i,
    // "Net amount: 7.45" / "Import net: 7,45"
    /(?:net|nett?o|import[e]?\s*net)\s*(?:amount)?\s*[:\s]\s*€?\s*([\d.,]+)/i,
    // "Total (base): 7,45"
    /total\s*\(\s*base\s*\)\s*[:\s]?\s*€?\s*([\d.,]+)/i,
    // "Taxable amount: 7.45"
    /taxable\s*(?:amount)?\s*[:\s]\s*€?\s*([\d.,]+)/i,
    // "Total antes de IVA: 7,45"
    /total\s*antes?\s*(?:de\s*)?iva\s*[:\s]?\s*€?\s*([\d.,]+)/i,
    // "Excl. VAT: 7.45" / "Excluding VAT"
    /excl(?:uding|\.?)?\s*(?:vat|tax|iva)\s*[:\s]?\s*€?\s*([\d.,]+)/i,
    // "Hors taxe: 7,45" (francès)
    /hors?\s*tax[ea]?s?\s*[:\s]?\s*€?\s*([\d.,]+)/i,
  ];

  for (const line of lines) {
    for (const pattern of basePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const num = parseEuropeanNumber(match[1]);
        if (!isNaN(num) && num > 0) {
          amounts.push(num);
        }
      }
    }
  }

  // Retornar el més gran (per si hi ha múltiples bases, com base 21% + base 10%)
  if (amounts.length > 0) {
    return Math.max(...amounts);
  }
  return null;
}

// ===========================================
// Detecció de data de factura
// ===========================================

// Mapes de mesos textuals → número (0-indexed)
const MONTH_NAMES = {
  // Català
  gener: 0, febrer: 1, març: 2, 'mar\u00e7': 2, abril: 3, maig: 4, juny: 5,
  juliol: 6, agost: 7, setembre: 8, octubre: 9, novembre: 10, desembre: 11,
  // Castellà
  enero: 0, febrero: 1, marzo: 2, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, noviembre: 10, diciembre: 11,
  // Anglès
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  // Abreviatures comunes
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  ene: 0, abr: 3, ago: 7, dic: 11,
  gen: 0, set: 8, des: 11,
};

const MONTH_PATTERN = Object.keys(MONTH_NAMES).join('|');

// Patrons de dates numèriques (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
const DATE_PATTERNS_NUMERIC = [
  // Amb paraula clau davant: "Fecha facturación:", "Fecha factura:", "Fecha emisión:", "Fecha:"
  /fecha\s*(?:de\s+)?(?:facturaci[oó]n|factura|emisi[oó]n)\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  /(?:fecha|data|date)\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  /data\s*(?:de\s+)?(?:factura|emissi[oó])\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  /(?:fecha|data|date|factura|invoice\s*date)\s*[:\s]\s*(\d{2}\.\d{2}\.\d{2,4})/i,
  // "Emissió: 13/01/2026" / "Emisión: 13/01/2026"
  /emissi[oó]n?\s*[:\s]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
];

/**
 * Parseja una cadena de data numèrica DD/MM/YYYY (o DD-MM-YYYY, DD.MM.YYYY) → Date (UTC migdia)
 * Usem UTC 12:00 per evitar problemes de timezone que desplacen la data un dia
 */
function parseNumericDate(dateStr) {
  const parts = dateStr.split(/[\/.\-]/);
  if (parts.length !== 3) return null;
  let [day, month, year] = parts.map(Number);
  if (year < 100) year += 2000;
  if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000 && year <= 2100) {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  return null;
}

/**
 * Detecta la data de factura dins del text
 * Prova múltiples estratègies: numèriques amb paraula clau, textuals, i fallback genèric
 * @param {string} text
 * @returns {Date|null}
 */
function detectInvoiceDate(text) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ');

  // 1) Patrons numèrics amb paraula clau (més fiables)
  for (const pattern of DATE_PATTERNS_NUMERIC) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const date = parseNumericDate(match[1]);
      if (date) return date;
    }
  }

  // 2) Dates textuals: "13 de enero de 2026", "13 gener 2026", "January 13, 2026"
  // Format europeu: DD de MES de YYYY / DD MES YYYY
  const textualEU = new RegExp(
    `(\\d{1,2})\\s*(?:de\\s+|d[''])?\\s*(${MONTH_PATTERN})\\.?\\s*(?:de\\s+|del\\s+|d[''])?\\s*(\\d{4})`,
    'i'
  );
  const matchEU = normalized.match(textualEU);
  if (matchEU) {
    const day = parseInt(matchEU[1]);
    const monthName = matchEU[2].toLowerCase();
    const year = parseInt(matchEU[3]);
    const month = MONTH_NAMES[monthName];
    if (month !== undefined && day > 0 && day <= 31 && year >= 2000 && year <= 2100) {
      return new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
  }

  // Format anglès: "January 13, 2026" / "Jan 13 2026"
  const textualEN = new RegExp(
    `(${MONTH_PATTERN})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`,
    'i'
  );
  const matchEN = normalized.match(textualEN);
  if (matchEN) {
    const monthName = matchEN[1].toLowerCase();
    const day = parseInt(matchEN[2]);
    const year = parseInt(matchEN[3]);
    const month = MONTH_NAMES[monthName];
    if (month !== undefined && day > 0 && day <= 31 && year >= 2000 && year <= 2100) {
      return new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
  }

  // 3) Fallback: primera data DD/MM/YYYY o DD/MM/YY que trobem prop de "factura" o a l'inici del document
  // Busquem totes les dates numèriques al text (accepta anys de 2 o 4 dígits)
  const allDates = [];
  const genericDateRegex = /(\d{1,2})[\/\-.] ?(\d{1,2})[\/\-.] ?(\d{2,4})/g;
  let m;
  while ((m = genericDateRegex.exec(normalized)) !== null) {
    const day = parseInt(m[1]);
    const month = parseInt(m[2]);
    let year = parseInt(m[3]);
    if (year < 100) year += 2000; // 26 → 2026
    if (day > 0 && day <= 31 && month > 0 && month <= 12 && year >= 2000 && year <= 2100) {
      allDates.push({ date: new Date(Date.UTC(year, month - 1, day, 12, 0, 0)), index: m.index });
    }
  }

  if (allDates.length === 1) {
    // Si només hi ha una data al document, és molt probable que sigui la de la factura
    return allDates[0].date;
  }

  if (allDates.length > 1) {
    // Buscar la data més propera a paraules clau de factura
    const keywords = /(?:fecha|data|date|factura|invoice|emissi[oó]n?|emisi[oó]n)/i;
    const keywordMatch = normalized.match(keywords);
    if (keywordMatch) {
      const kwPos = keywordMatch.index;
      // Agafar la data més propera (dins de 100 caràcters) a la paraula clau
      const nearby = allDates
        .filter((d) => Math.abs(d.index - kwPos) < 100)
        .sort((a, b) => Math.abs(a.index - kwPos) - Math.abs(b.index - kwPos));
      if (nearby.length > 0) return nearby[0].date;
    }
    // Si no hi ha paraula clau, agafar la primera data del document
    return allDates[0].date;
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
 *
 * Flux:
 *   1. Extreure text amb pdf-parse (o OCR si escanejat)
 *   2. Enviar text a Claude API per extracció intel·ligent
 *   3. Si Claude no disponible → fallback a regex
 *   4. Combinar resultats: Claude té prioritat, regex omple buits
 *
 * @param {string|Buffer} filePathOrBuffer - Camí al fitxer o buffer
 * @returns {Object} { text, invoiceNumber, nifCif, totalAmount, invoiceDate, hasText, ocrUsed, aiExtracted }
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
      documentType: { type: 'unknown', confidence: 0, label: 'Desconegut' },
      invoiceNumber: null,
      nifCif: [],
      totalAmount: null,
      baseAmount: null,
      invoiceDate: null,
      supplierName: null,
      hasText: false,
      ocrUsed: false,
      aiExtracted: false,
    };
  }

  // 4) Intentar extracció amb Claude API (prioritat)
  let aiResult = null;
  let aiExtracted = false;
  try {
    const claudeExtract = require('./claudeExtractService');
    if (claudeExtract.isAvailable()) {
      aiResult = await claudeExtract.extractInvoiceData(text);
      if (aiResult) {
        aiExtracted = true;
        logger.info('analyzePdf: Extracció amb Claude API completada');
      }
    }
  } catch (err) {
    logger.warn(`analyzePdf: Claude Extract no disponible: ${err.message}`);
  }

  // 5) Fallback a regex per camps que Claude no ha pogut extreure
  const regexResult = {
    documentType: detectDocumentType(text),
    invoiceNumber: detectInvoiceNumber(text),
    nifCif: detectNifCif(text),
    totalAmount: detectTotalAmount(text),
    baseAmount: detectBaseAmount(text),
    invoiceDate: detectInvoiceDate(text),
    supplierName: detectSupplierName(text),
  };

  // 6) Combinar: Claude té prioritat, regex omple buits
  if (aiResult) {
    return {
      text,
      documentType: aiResult.documentType || regexResult.documentType,
      invoiceNumber: aiResult.invoiceNumber || regexResult.invoiceNumber,
      nifCif: aiResult.nifCif?.length > 0 ? aiResult.nifCif : regexResult.nifCif,
      totalAmount: aiResult.totalAmount || regexResult.totalAmount,
      baseAmount: aiResult.baseAmount || regexResult.baseAmount,
      taxRate: aiResult.taxRate,
      taxAmount: aiResult.taxAmount,
      irpfRate: aiResult.irpfRate || 0,
      irpfAmount: aiResult.irpfAmount || 0,
      invoiceDate: aiResult.invoiceDate || regexResult.invoiceDate,
      supplierName: aiResult.supplierName || regexResult.supplierName,
      description: aiResult.description || null,
      confidence: aiResult.confidence || 0.5,
      hasText: true,
      ocrUsed,
      aiExtracted: true,
    };
  }

  // 7) Només regex (Claude no disponible o ha fallat)
  return {
    text,
    ...regexResult,
    hasText: true,
    ocrUsed,
    aiExtracted: false,
  };
}

/**
 * Comprova si una factura és duplicada buscant pel número de factura extret.
 *
 * Regles de duplicat:
 *   1. Si tenim proveïdor: només és duplicat si coincideix nº factura + proveïdor + import similar
 *   2. Si NO tenim proveïdor: només és duplicat si coincideix nº factura + import exacte
 *   3. Si l'import és diferent (>1€ diferència), NO és duplicat (pot ser rectificativa)
 *   4. Si el número de factura és provisional (PROV-), MAI és duplicat
 *   5. Números curts (<4 caràcters) no es consideren fiables per duplicats
 *
 * @param {string} invoiceNumber - Número de factura detectat
 * @param {string} [supplierId] - ID del proveïdor (opcional, per precisió)
 * @param {number} [totalAmount] - Import total detectat (opcional, per verificar)
 * @returns {Object|null} Factura existent si és duplicada, null si no
 */
async function checkDuplicateByContent(invoiceNumber, supplierId = null, totalAmount = null) {
  if (!invoiceNumber) return null;

  // Números provisionals no es consideren per duplicats
  if (invoiceNumber.startsWith('PROV-') || invoiceNumber.startsWith('GDRIVE-')) return null;

  // Números massa curts (1, 01, 001) són poc fiables — molts proveïdors usen seqüències simples
  if (invoiceNumber.replace(/[^a-zA-Z0-9]/g, '').length < 4) return null;

  const { prisma } = require('../config/database');

  // OBLIGATORI: cal proveïdor per detectar duplicat
  // Sense proveïdor, el risc de fals positiu és massa alt
  if (!supplierId) {
    // Excepció: si el número és molt específic (8+ chars alfanumèrics), buscar globalment
    const alphanumLength = invoiceNumber.replace(/[^a-zA-Z0-9]/g, '').length;
    if (alphanumLength < 8) return null;
  }

  const where = {
    invoiceNumber: { equals: invoiceNumber, mode: 'insensitive' },
    isDuplicate: false,  // No comparar amb altres duplicats
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
      supplier: { select: { id: true, name: true } },
    },
  });

  if (!existing) return null;

  // Si tenim imports d'ambdues factures, comparar-los
  // Si la diferència és >1€, probablement NO és duplicat (rectificativa, abonament, etc.)
  if (totalAmount !== null && totalAmount > 0 && existing.totalAmount > 0) {
    const diff = Math.abs(totalAmount - existing.totalAmount);
    if (diff > 1) {
      logger.info(
        `checkDuplicate: Nº ${invoiceNumber} existeix però import diferent ` +
        `(${totalAmount}€ vs ${existing.totalAmount}€, diff: ${diff.toFixed(2)}€) — NO duplicat`
      );
      return null;
    }
  }

  return existing;
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

// ===========================================
// SISTEMA DE PLANTILLES (APRENENTATGE)
// ===========================================

/**
 * Busca un proveïdor per patró del nom de fitxer.
 * Utilitza les plantilles guardades a SupplierTemplate.
 * @param {string} fileName - Nom del fitxer PDF
 * @returns {Object|null} { supplier, template } o null
 */
async function findSupplierByFileName(fileName) {
  if (!fileName) return null;
  const { prisma } = require('../config/database');

  const templates = await prisma.supplierTemplate.findMany({
    where: { filePatterns: { not: null } },
    include: { supplier: { select: { id: true, name: true, nif: true } } },
  });

  const lowerFile = fileName.toLowerCase();
  for (const tmpl of templates) {
    const patterns = tmpl.filePatterns;
    if (!Array.isArray(patterns)) continue;
    for (const pattern of patterns) {
      if (lowerFile.includes(pattern.toLowerCase())) {
        logger.info(`Template: Fitxer "${fileName}" → proveïdor "${tmpl.supplier.name}" (patró: "${pattern}")`);
        return { supplier: tmpl.supplier, template: tmpl };
      }
    }
  }

  return null;
}

/**
 * Busca un proveïdor per NIF usant les plantilles (knownNifs).
 * Complementa findSupplierByNif quan el NIF no està al camp supplier.nif
 * @param {string[]} nifList - NIFs detectats al PDF
 * @returns {Object|null} { supplier, template } o null
 */
async function findSupplierByTemplateNif(nifList) {
  if (!nifList || !nifList.length) return null;
  const { prisma } = require('../config/database');

  const templates = await prisma.supplierTemplate.findMany({
    where: { knownNifs: { not: null } },
    include: { supplier: { select: { id: true, name: true, nif: true } } },
  });

  for (const tmpl of templates) {
    const knownNifs = tmpl.knownNifs;
    if (!Array.isArray(knownNifs)) continue;
    for (const nif of nifList) {
      if (knownNifs.includes(nif)) {
        logger.info(`Template: NIF "${nif}" → proveïdor "${tmpl.supplier.name}"`);
        return { supplier: tmpl.supplier, template: tmpl };
      }
    }
  }

  return null;
}

/**
 * Valida un número de factura detectat contra la plantilla del proveïdor.
 * Si el número no encaixa amb els patrons coneguts, pot ser un error d'extracció.
 * @param {string} invoiceNumber - Número detectat
 * @param {Object} template - SupplierTemplate
 * @returns {{ valid: boolean, confidence: number }}
 */
function validateInvoiceNumber(invoiceNumber, template) {
  if (!invoiceNumber || !template) return { valid: true, confidence: 0 };

  const patterns = template.invoicePatterns;
  if (!Array.isArray(patterns) || !patterns.length) return { valid: true, confidence: 0 };

  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern, 'i').test(invoiceNumber)) {
        return { valid: true, confidence: 0.9 };
      }
    } catch {
      // regex invàlid, ignorar
    }
  }

  // No encaixa amb cap patró — pot ser erroni
  // Però si el prefix coincideix, acceptable
  if (template.invoicePrefix && invoiceNumber.startsWith(template.invoicePrefix)) {
    return { valid: true, confidence: 0.6 };
  }

  return { valid: false, confidence: 0.2 };
}

/**
 * Intenta trobar un número de factura al text usant el prefix del proveïdor.
 * Útil quan l'extracció genèrica falla però sabem quin format esperar.
 * @param {string} text - Text del PDF
 * @param {Object} template - SupplierTemplate
 * @returns {string|null} Número de factura o null
 */
function detectInvoiceNumberWithTemplate(text, template) {
  if (!text || !template) return null;

  // Provar amb el prefix conegut
  if (template.invoicePrefix) {
    const escaped = template.invoicePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRegex = new RegExp(`${escaped}[\\w/\\-]{2,20}`, 'gm');
    const matches = text.match(prefixRegex);
    if (matches && matches.length > 0) {
      // Agafar el primer que sembli un número de factura real
      for (const m of matches) {
        const alphaNum = m.replace(/[^a-zA-Z0-9]/g, '');
        if (alphaNum.length >= 4) {
          logger.info(`Template: Número detectat amb prefix "${template.invoicePrefix}": ${m}`);
          return m.trim();
        }
      }
    }
  }

  // Provar amb els patrons regex
  if (Array.isArray(template.invoicePatterns)) {
    for (const pattern of template.invoicePatterns) {
      try {
        // Convertir el patró d'ancoratge (^...$) a cerca global
        const searchPattern = pattern.replace(/^\^/, '').replace(/\$$/, '');
        const regex = new RegExp(`(${searchPattern})`, 'gm');
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
          logger.info(`Template: Número detectat amb patró "${pattern}": ${matches[0]}`);
          return matches[0].trim();
        }
      } catch {
        // regex invàlid
      }
    }
  }

  return null;
}

/**
 * Anàlisi millorada de PDF que utilitza les plantilles de proveïdor.
 * Flux:
 *   1. Extracció estàndard (analyzePdf)
 *   2. Si tenim plantilla (per fileName o NIF), validar i millorar resultats
 *   3. Si l'extracció estàndard falla, intentar amb patrons del proveïdor
 *
 * @param {string} filePath - Ruta del PDF
 * @param {string} fileName - Nom original del fitxer
 * @returns {Object} Resultat millorat amb camp `templateUsed`
 */
async function analyzePdfWithTemplates(filePath, fileName) {
  // 1. Extracció estàndard
  const result = await analyzePdf(filePath);

  // 2. Buscar plantilla per nom de fitxer
  let templateMatch = await findSupplierByFileName(fileName);

  // 3. Si no trobat per fitxer, buscar per NIF detectat
  if (!templateMatch && result.nifCif.length > 0) {
    templateMatch = await findSupplierByTemplateNif(result.nifCif);
  }

  if (!templateMatch) {
    return { ...result, templateUsed: false, matchedSupplierFromTemplate: null };
  }

  const { supplier, template } = templateMatch;

  // 4. Validar número de factura
  if (result.invoiceNumber) {
    const validation = validateInvoiceNumber(result.invoiceNumber, template);
    if (!validation.valid) {
      // El número detectat no encaixa — intentar trobar-ne un millor
      logger.warn(`Template: Número "${result.invoiceNumber}" no encaixa amb patrons de ${supplier.name}. Buscant alternatiu...`);
      const betterNumber = detectInvoiceNumberWithTemplate(result.text, template);
      if (betterNumber) {
        result.invoiceNumber = betterNumber;
        logger.info(`Template: Número corregit a "${betterNumber}" per ${supplier.name}`);
      }
    }
  } else {
    // No s'ha detectat número — intentar amb plantilla
    const templateNumber = detectInvoiceNumberWithTemplate(result.text, template);
    if (templateNumber) {
      result.invoiceNumber = templateNumber;
      logger.info(`Template: Número trobat amb plantilla de ${supplier.name}: "${templateNumber}"`);
    }
  }

  // 5. Validar import (si l'import és 0 o molt fora de rang, marcar)
  if (template.minAmount && template.maxAmount && result.totalAmount) {
    const min = parseFloat(template.minAmount);
    const max = parseFloat(template.maxAmount);
    const total = result.totalAmount;
    if (total < min * 0.5 || total > max * 2) {
      logger.warn(`Template: Import ${total}€ fora del rang habitual de ${supplier.name} (${min}€-${max}€)`);
      result._amountWarning = `Import fora del rang habitual (${min}€-${max}€)`;
    }
  }

  return {
    ...result,
    templateUsed: true,
    matchedSupplierFromTemplate: supplier,
  };
}

module.exports = {
  extractText,
  extractTextFromBuffer,
  ocrPdf,
  detectInvoiceNumber,
  detectNifCif,
  detectDocumentType,
  detectTotalAmount,
  detectBaseAmount,
  detectInvoiceDate,
  detectSupplierName,
  analyzePdf,
  analyzePdfWithTemplates,
  checkDuplicateByContent,
  findSupplierByNif,
  findSupplierByName,
  findOrCreateSupplier,
  findSupplierByFileName,
  findSupplierByTemplateNif,
  validateInvoiceNumber,
};
