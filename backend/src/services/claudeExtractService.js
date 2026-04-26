/**
 * SERVEI D'EXTRACCIÓ DE FACTURES AMB CLAUDE API
 *
 * Usa l'API de Claude (Anthropic) per analitzar text extret de PDFs
 * i extreure dades estructurades amb alta precisió:
 *   - Número de factura
 *   - NIF/CIF del proveïdor
 *   - Nom del proveïdor
 *   - Import total, base imposable, IVA, IRPF
 *   - Data de factura
 *   - Tipus de document
 *
 * Avantatges respecte regex:
 *   - Entén context i semàntica
 *   - Funciona amb qualsevol format/idioma
 *   - No cal mantenir centenars de patrons
 *   - Millor amb OCR de baixa qualitat
 */

const { logger } = require('../config/logger');
const aiCostTracker = require('./aiCostTracker');
const company = require('../config/company');

// ===========================================
// Configuració Claude API
// ===========================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Haiku per extracció: ràpid, barat, suficient per a dades estructurades
const EXTRACT_MODEL = process.env.CLAUDE_EXTRACT_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

/**
 * Crida a l'API de Claude.
 * Retorna { text, usage: { input_tokens, output_tokens } } o null si falla.
 */
async function callClaude(systemPrompt, userMessage, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    return null; // Silenciós — fallback a regex
  }

  const model = options.model || EXTRACT_MODEL;
  const body = {
    model,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn(`Claude API error (${response.status}): ${error}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || null;
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

    return { text, usage, model };
  } catch (err) {
    logger.warn(`Claude API call failed: ${err.message}`);
    return null;
  }
}

// ===========================================
// Prompt d'extracció
// ===========================================

const SYSTEM_PROMPT = `Ets un expert en extracció de dades de factures. Analitza el text d'un PDF de factura i extreu les dades en format JSON.

IMPORTANT:
- Retorna NOMÉS el JSON, sense explicacions ni markdown.
- Si un camp no es pot determinar, usa null.
- Els imports han de ser números (float), NO strings.
- La data ha de ser format ISO: "YYYY-MM-DD".
- El NIF/CIF espanyol té format: lletra + 7 dígits + lletra/dígit (empreses: B12345678) o 8 dígits + lletra (persones: 12345678A).
- Exclou els NIFs ${company.allNifs.join(', ')} (són l'empresa receptora, ${company.name}).
- L'empresa receptora pot aparèixer amb noms anteriors: ${company.allNames.join(', ')}. Totes són la mateixa empresa — NO les consideris com a proveïdor.
- Si el document NO és una factura (és un albarà, pressupost, rebut, contracte, etc.), indica-ho al camp documentType.

Format de resposta (JSON estricte):
{
  "invoiceNumber": "string o null — número de factura exacte tal com apareix",
  "supplierName": "string o null — nom de l'empresa emissora",
  "supplierNif": "string o null — NIF/CIF de l'empresa emissora (NO els de ${company.allNames[0]}: ${company.allNifs.join(', ')})",
  "issueDate": "YYYY-MM-DD o null — data d'emissió de la factura",
  "dueDate": "YYYY-MM-DD o null — data de venciment (fecha de vencimiento, due date, payment date)",
  "totalAmount": 0.00,
  "baseAmount": 0.00,
  "taxRate": 21,
  "taxAmount": 0.00,
  "irpfRate": 0,
  "irpfAmount": 0.00,
  "documentType": "invoice | receipt | credit_note | delivery | quote | statement | order | contract | unknown",
  "confidence": 0.95,
  "description": "string o null — breu descripció del concepte/servei facturat"
}

Notes sobre imports:
- totalAmount = baseAmount + taxAmount - irpfAmount
- Si veus "Base imposable", "Subtotal", "Neto" → és baseAmount
- Si veus "Total", "Total factura", "Import total", "Amount due" → és totalAmount
- irpfRate sol ser 7% o 15% (retencions a professionals)
- Si no hi ha IRPF, irpfRate i irpfAmount han de ser 0
- dueDate: busca "Fecha de vencimiento", "Vencimiento", "Due date", "Payment due", "Fecha de pago". Si no hi és, null.`;

/**
 * Extreu dades d'una factura usant Claude API
 * @param {string} text - Text extret del PDF (pdf-parse o OCR)
 * @returns {Object|null} Dades extretes o null si falla
 */
async function extractInvoiceData(text) {
  if (!text || text.trim().length < 20) return null;
  if (!ANTHROPIC_API_KEY) return null;

  // Limitar text a ~4000 chars per optimitzar cost/velocitat
  const truncatedText = text.length > 4000 ? text.substring(0, 4000) : text;

  const userMessage = `Analitza aquest text extret d'un PDF i extreu les dades de la factura:\n\n---\n${truncatedText}\n---`;

  try {
    const startTime = Date.now();
    const apiResult = await callClaude(SYSTEM_PROMPT, userMessage);
    const elapsed = Date.now() - startTime;

    if (!apiResult || !apiResult.text) return null;

    // Tracking de costos (fire-and-forget)
    aiCostTracker.trackUsage({
      service: 'invoice_extraction',
      model: apiResult.model,
      inputTokens: apiResult.usage.input_tokens,
      outputTokens: apiResult.usage.output_tokens,
      entityType: 'invoice',
      metadata: { elapsed },
    }).catch(() => {});

    // Parsejar JSON de la resposta
    let parsed;
    try {
      // Netejar possibles backticks o text extra
      const jsonStr = apiResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      logger.warn(`Claude Extract: resposta no és JSON vàlid: ${apiResult.text.substring(0, 200)}`);
      return null;
    }

    // Validar i normalitzar
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
      confidence: parsed.confidence || 0.5,
      description: parsed.description || null,
    };

    logger.info(
      `Claude Extract OK (${elapsed}ms): nº=${result.invoiceNumber}, ` +
      `total=${result.totalAmount}, proveïdor=${result.supplierName}, ` +
      `data=${parsed.issueDate}, confiança=${result.confidence}`
    );

    return result;
  } catch (err) {
    logger.warn(`Claude Extract error: ${err.message}`);
    return null;
  }
}

/**
 * Parseja data ISO "YYYY-MM-DD" → Date (UTC migdia)
 */
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

/**
 * Mapeja el documentType de Claude al format intern
 */
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

/**
 * Comprova si el servei està disponible (clau API configurada)
 */
function isAvailable() {
  return !!ANTHROPIC_API_KEY;
}

module.exports = {
  extractInvoiceData,
  isAvailable,
  callClaude,
  EXTRACT_MODEL,
};
