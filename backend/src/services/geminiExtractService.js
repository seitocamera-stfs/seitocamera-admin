/**
 * SERVEI D'EXTRACCIÓ DE FACTURES AMB GEMINI 2.0 FLASH
 *
 * Substitueix Claude per a l'extracció automàtica de dades de factures.
 *
 * Avantatges sobre Claude:
 *   - **Multimodal natiu**: passa el PDF directament (no depèn de extracció de
 *     text fràgil). Veu la disposició visual del document, així que pot
 *     interpretar correctament factures amb estructures complexes (etiquetes
 *     a la dreta dels valors, multi-columna, etc).
 *   - **Cost ~50× més baix**: ~$0.001/factura vs ~$0.05 amb Claude Sonnet.
 *   - **JSON estructurat amb schema**: Gemini valida l'output contra el
 *     schema declarat — zero parseig fràgil.
 *   - **Free tier generós**: 15 RPM, 1500 req/dia gratis. Suficient per
 *     al volum de SeitoCamera (~10-30 factures/dia).
 *
 * Variables d'entorn:
 *   GEMINI_API_KEY              — obligatori
 *   GEMINI_EXTRACT_MODEL        — opcional, default 'gemini-2.0-flash'
 *
 * Es manté la mateixa interfície que claudeExtractService:
 *   extractInvoiceData(text) → mateix output shape (per compatibilitat)
 *   extractInvoiceFromPdf(buffer) → nova funció multimodal (recomanada)
 */

const fs = require('fs');
const { logger } = require('../config/logger');
const aiCostTracker = require('./aiCostTracker');
const company = require('../config/company');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 2.0-flash és multimodal i barat. 2.0-flash-lite encara més barat però menor qualitat.
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL || 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Pricing aproximat (Mar 2025) per a tracking de cost
const PRICING_PER_M_TOKENS = {
  'gemini-2.0-flash':       { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-lite':  { input: 0.075, output: 0.30 },
  'gemini-1.5-flash':       { input: 0.075, output: 0.30 },
  'gemini-1.5-flash-8b':    { input: 0.0375, output: 0.15 },
  'gemini-1.5-pro':         { input: 1.25, output: 5.00 },
};

// ===========================================
// Schema de la resposta — Gemini la validarà
// ===========================================
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    invoiceNumber:  { type: 'STRING', nullable: true, description: 'Número de factura tal com apareix' },
    supplierName:   { type: 'STRING', nullable: true, description: 'Nom de l\'empresa emissora' },
    supplierNif:    { type: 'STRING', nullable: true, description: 'NIF/CIF de l\'emissor (NO el del receptor)' },
    issueDate:      { type: 'STRING', nullable: true, description: 'Data d\'emissió en format YYYY-MM-DD' },
    dueDate:        { type: 'STRING', nullable: true, description: 'Data de venciment en format YYYY-MM-DD' },
    totalAmount:    { type: 'NUMBER', nullable: true, description: 'Total a pagar incloent IVA' },
    baseAmount:     { type: 'NUMBER', nullable: true, description: 'Base imposable (subtotal sense IVA)' },
    taxRate:        { type: 'NUMBER', nullable: true, description: 'Tipus IVA en percentatge (ex: 21)' },
    taxAmount:      { type: 'NUMBER', nullable: true, description: 'Import IVA' },
    irpfRate:       { type: 'NUMBER', nullable: true, description: 'Tipus IRPF en percentatge (0 si no aplica)' },
    irpfAmount:     { type: 'NUMBER', nullable: true, description: 'Import IRPF retingut' },
    documentType:   {
      type: 'STRING',
      enum: ['invoice', 'receipt', 'credit_note', 'delivery', 'quote', 'statement', 'order', 'contract', 'unknown'],
      description: 'Tipus de document detectat',
    },
    confidence:     { type: 'NUMBER', description: 'Confiança 0-1 en l\'extracció global' },
    description:    { type: 'STRING', nullable: true, description: 'Concepte/servei facturat resumit' },
  },
  required: ['documentType', 'confidence'],
};

// ===========================================
// Prompt
// ===========================================
const SYSTEM_PROMPT = `Ets un expert en extracció de dades de factures espanyoles. Analitza el PDF (visualment, atenent a la disposició espacial) i extreu les dades estructurades.

REGLES CLAU:
- Atenció a factures on les **etiquetes apareixen DESPRÉS dels valors** (típic en format columna-columna): "Número de factura:" pot venir DESPRÉS del valor en una columna paral·lela. Usa la disposició visual per associar correctament cada etiqueta amb el seu valor.
- Si veus dates múltiples al document, prioritza la "Fecha de emisión" / "Fecha de factura". NO confonguis el període facturat ("Período: 01/04 - 30/04") amb la data d'emissió.
- Si un camp no es pot determinar amb confiança, usa null.
- Imports: format número (no string). totalAmount = baseAmount + taxAmount - irpfAmount.
- Dates: format ISO "YYYY-MM-DD" (NO altres formats).
- NIF/CIF format espanyol: empreses B/A/C/D/E/F/G/H/J/N/P/Q/R/S/U/V/W + 7 dígits + lletra/dígit. Persones: 8 dígits + lletra.

EXCLUSIONS — NO consideris aquests com a proveïdors (són l'empresa receptora):
- Noms: ${company.allNames.join(', ')}
- NIFs: ${company.allNifs.join(', ')}

DOCUMENT TYPES:
- "invoice": factura formal amb número
- "receipt": rebut de pagament/cobrament
- "credit_note": nota d'abonament/devolució (import negatiu)
- "delivery": albarà sense import
- "quote": pressupost (sense compromís de pagament)
- "statement": extracte (consum, balanç, etc.)
- "order": comanda
- "contract": contracte
- "unknown": no s'identifica clarament`;

// ===========================================
// API call
// ===========================================
async function callGemini({ pdfBase64, text, model = EXTRACT_MODEL, maxTokens = 1024 }) {
  if (!GEMINI_API_KEY) return null;

  const url = `${API_BASE}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const parts = [{ text: SYSTEM_PROMPT }];
  if (pdfBase64) {
    parts.push({
      inlineData: { mimeType: 'application/pdf', data: pdfBase64 },
    });
  }
  if (text) {
    parts.push({
      text: `\n\nText extret del PDF (referència, pot estar incomplet):\n---\n${text}\n---`,
    });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn(`Gemini API error (${response.status}): ${error.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();

    // Estructura resposta: { candidates: [{ content: { parts: [{ text: '{...}' }] } }], usageMetadata: {...} }
    const text2 = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text2) {
      logger.warn(`Gemini API: resposta sense text. Raw: ${JSON.stringify(data).slice(0, 300)}`);
      return null;
    }

    const usage = {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata?.totalTokenCount || 0,
    };

    return { text: text2, usage, model };
  } catch (err) {
    logger.warn(`Gemini API call failed: ${err.message}`);
    return null;
  }
}

// ===========================================
// Funcions públiques
// ===========================================

/**
 * Extracció multimodal (recomanada): passa el PDF binari directament a Gemini.
 *
 * @param {Buffer|string} pdfBufferOrPath - Buffer del PDF o path al fitxer
 * @param {Object} opts
 * @param {string} opts.fallbackText - Text del PDF si ja s'ha extret (opcional)
 * @returns {Object|null} Mateix shape que extractInvoiceData (interface compatible)
 */
async function extractInvoiceFromPdf(pdfBufferOrPath, opts = {}) {
  if (!GEMINI_API_KEY) return null;

  let pdfBuffer;
  if (Buffer.isBuffer(pdfBufferOrPath)) {
    pdfBuffer = pdfBufferOrPath;
  } else if (typeof pdfBufferOrPath === 'string') {
    try {
      pdfBuffer = fs.readFileSync(pdfBufferOrPath);
    } catch (err) {
      logger.warn(`Gemini Extract: no es pot llegir fitxer ${pdfBufferOrPath}: ${err.message}`);
      return null;
    }
  } else {
    return null;
  }

  // Límit raonable per evitar pujar PDFs absurds (Gemini accepta fins a ~20MB inline)
  if (pdfBuffer.length > 15 * 1024 * 1024) {
    logger.warn(`Gemini Extract: PDF massa gran (${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB), saltant`);
    return null;
  }

  const startTime = Date.now();
  const apiResult = await callGemini({
    pdfBase64: pdfBuffer.toString('base64'),
    text: opts.fallbackText || null,
  });
  const elapsed = Date.now() - startTime;

  if (!apiResult) return null;

  // Cost tracking
  trackCost(apiResult, elapsed);

  return parseAndValidate(apiResult.text, elapsed, 'pdf');
}

/**
 * Extracció només-text (fallback per compatibilitat amb claudeExtract).
 * NO recomanat — perds l'avantatge multimodal. Useu extractInvoiceFromPdf
 * sempre que tingueu el PDF original.
 */
async function extractInvoiceData(text) {
  if (!text || text.trim().length < 20) return null;
  if (!GEMINI_API_KEY) return null;

  const truncatedText = text.length > 20000 ? text.substring(0, 20000) : text;

  const startTime = Date.now();
  const apiResult = await callGemini({ text: truncatedText });
  const elapsed = Date.now() - startTime;

  if (!apiResult) return null;

  trackCost(apiResult, elapsed);
  return parseAndValidate(apiResult.text, elapsed, 'text');
}

// ===========================================
// Helpers
// ===========================================

function trackCost(apiResult, elapsedMs) {
  // Calcula cost en USD basat en pricing aproximat
  const pricing = PRICING_PER_M_TOKENS[apiResult.model] || PRICING_PER_M_TOKENS['gemini-2.0-flash'];
  const costUsd =
    (apiResult.usage.input_tokens * pricing.input + apiResult.usage.output_tokens * pricing.output) / 1_000_000;

  aiCostTracker.trackUsage({
    service: 'invoice_extraction',
    model: apiResult.model,
    inputTokens: apiResult.usage.input_tokens,
    outputTokens: apiResult.usage.output_tokens,
    entityType: 'invoice',
    metadata: { elapsed: elapsedMs, costUsd, provider: 'gemini' },
  }).catch(() => {});
}

function parseAndValidate(text, elapsedMs, mode) {
  let parsed;
  try {
    // Gemini amb responseSchema retorna JSON net, però per si de cas...
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    logger.warn(`Gemini Extract: resposta no JSON: ${text.substring(0, 200)}`);
    return null;
  }

  const result = {
    invoiceNumber: parsed.invoiceNumber || null,
    supplierName: parsed.supplierName || null,
    nifCif: parsed.supplierNif ? [parsed.supplierNif] : [],
    totalAmount: typeof parsed.totalAmount === 'number' && parsed.totalAmount > 0 ? parsed.totalAmount : null,
    baseAmount: typeof parsed.baseAmount === 'number' && parsed.baseAmount > 0 ? parsed.baseAmount : null,
    taxRate: typeof parsed.taxRate === 'number' ? parsed.taxRate : null,
    taxAmount: typeof parsed.taxAmount === 'number' ? parsed.taxAmount : null,
    irpfRate: typeof parsed.irpfRate === 'number' ? parsed.irpfRate : 0,
    irpfAmount: typeof parsed.irpfAmount === 'number' ? parsed.irpfAmount : 0,
    invoiceDate: parsed.issueDate ? parseISODate(parsed.issueDate) : null,
    dueDate: parsed.dueDate ? parseISODate(parsed.dueDate) : null,
    documentType: mapDocumentType(parsed.documentType),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    description: parsed.description || null,
  };

  logger.info(
    `Gemini Extract OK [${mode}] (${elapsedMs}ms): nº=${result.invoiceNumber}, ` +
    `total=${result.totalAmount}, proveïdor=${result.supplierName}, ` +
    `data=${parsed.issueDate}, confiança=${result.confidence}`
  );

  return result;
}

function parseISODate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1]);
  const month = parseInt(match[2]);
  const day = parseInt(match[3]);
  if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  return null;
}

function mapDocumentType(type) {
  const typeMap = {
    invoice: { type: 'invoice', confidence: 0.95, label: 'Factura' },
    receipt: { type: 'receipt', confidence: 0.95, label: 'Rebut de pagament' },
    credit_note: { type: 'credit_note', confidence: 0.95, label: 'Nota de crèdit' },
    delivery: { type: 'delivery', confidence: 0.95, label: 'Albarà' },
    quote: { type: 'quote', confidence: 0.95, label: 'Pressupost' },
    statement: { type: 'statement', confidence: 0.95, label: 'Extracte' },
    order: { type: 'order', confidence: 0.95, label: 'Comanda' },
    contract: { type: 'contract', confidence: 0.95, label: 'Contracte' },
  };
  return typeMap[type] || { type: 'unknown', confidence: 0.3, label: 'Desconegut' };
}

function isAvailable() {
  return !!GEMINI_API_KEY;
}

module.exports = {
  extractInvoiceFromPdf,   // recomanat (multimodal)
  extractInvoiceData,      // compatibilitat amb claudeExtract (només-text)
  isAvailable,
  callGemini,
  EXTRACT_MODEL,
};
