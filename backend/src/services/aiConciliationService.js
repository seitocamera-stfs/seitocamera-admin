/**
 * SERVEI DE CONCILIACIÓ BANCÀRIA AMB IA (Claude Haiku)
 *
 * Envia tots els moviments bancaris pendents i factures no conciliades
 * a Claude perquè trobi les millors parelles de forma intel·ligent.
 *
 * Avantatges respecte l'algorisme de regles:
 *   - Entén conceptes: "AMZN Mktp" → Amazon → factura d'Amazon
 *   - Detecta pagaments agrupats (1 moviment = N factures)
 *   - Tolera diferències d'import (comissions, arrodoniments)
 *   - Reconeix patrons temporals (factura mensual el dia 5, etc.)
 *   - Descarta moviments sense factura possible (nòmines, impostos, etc.)
 */

const { logger } = require('../config/logger');
const aiCostTracker = require('./aiCostTracker');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_CONCILIATION_MODEL || 'claude-haiku-4-5-20251001';

// Límits per no sobrecarregar el context
const MAX_MOVEMENTS = 80;
const MAX_INVOICES = 200;

/**
 * Crida a Claude amb el prompt de conciliació.
 */
async function callClaude(systemPrompt, userMessage) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };

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
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

  // Registrar cost (fire-and-forget)
  aiCostTracker.trackUsage({
    service: 'conciliation',
    model: MODEL,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    success: true,
  }).catch(() => {});

  return { text, usage };
}

/**
 * Formata moviments bancaris per enviar a Claude.
 * Inclou ID, data, import, contrapart i descripció.
 */
function formatMovements(movements) {
  return movements.map((m, i) => {
    const amount = parseFloat(m.amount);
    const type = amount < 0 ? 'DESPESA' : 'INGRÉS';
    return `M${i + 1} | id:${m.id} | ${m.date.toISOString().split('T')[0]} | ${type} ${Math.abs(amount).toFixed(2)}€ | contrapart: "${m.counterparty || '—'}" | desc: "${m.description}" | compte: ${m.accountName || '—'} | cat: ${m.category || '—'} | ref: ${m.reference || '—'}`;
  }).join('\n');
}

/**
 * Formata factures per enviar a Claude.
 */
function formatInvoices(receivedInvoices, issuedInvoices) {
  const lines = [];

  for (let i = 0; i < receivedInvoices.length; i++) {
    const inv = receivedInvoices[i];
    const amount = parseFloat(inv.totalAmount);
    const base = inv.baseAmount ? parseFloat(inv.baseAmount).toFixed(2) : '—';
    lines.push(`FR${i + 1} | id:${inv.id} | type:received | ${inv.issueDate.toISOString().split('T')[0]} | ${amount.toFixed(2)}€ (base: ${base}€) | num: "${inv.invoiceNumber}" | proveïdor: "${inv.supplier?.name || '—'}" (NIF: ${inv.supplier?.nif || '—'}) | concepte: "${inv.description || '—'}"`);
  }

  for (let i = 0; i < issuedInvoices.length; i++) {
    const inv = issuedInvoices[i];
    const amount = parseFloat(inv.totalAmount);
    lines.push(`FE${i + 1} | id:${inv.id} | type:issued | ${inv.issueDate.toISOString().split('T')[0]} | ${amount.toFixed(2)}€ | num: "${inv.invoiceNumber}" | client: "${inv.client?.name || '—'}" (NIF: ${inv.client?.nif || '—'})"`);
  }

  return lines.join('\n');
}

/**
 * Executa la conciliació IA.
 * Retorna un array de matches proposats per Claude.
 */
async function runAIConciliation(movements, receivedInvoices, issuedInvoices) {
  // Limitar per no excedir el context de Haiku
  const limitedMovements = movements.slice(0, MAX_MOVEMENTS);
  const limitedReceived = receivedInvoices.slice(0, MAX_INVOICES);
  const limitedIssued = issuedInvoices.slice(0, MAX_INVOICES);

  const movementsText = formatMovements(limitedMovements);
  const invoicesText = formatInvoices(limitedReceived, limitedIssued);

  const systemPrompt = `Ets un expert comptable que concilia moviments bancaris amb factures. La teva feina és trobar quina factura correspon a cada moviment bancari.

REGLES:
1. Un moviment DESPESA (negatiu) es concilia amb una factura REBUDA (FR).
2. Un moviment INGRÉS (positiu) es concilia amb una factura EMESA (FE).
3. L'import ha de ser molt semblant (tolerància ±5€ per comissions bancàries). Si la diferència és >5€, necessites molt bona raó.
4. Un moviment pot correspondre a MÚLTIPLES factures si la suma coincideix (pagament agrupat).
5. El nom de la contrapart bancària sovint coincideix amb el proveïdor/client però pot estar abreujat (ex: "AMZN MKTP" = Amazon, "VODAFONE ES" = Vodafone España).
6. La data del moviment sol ser posterior a la data de la factura (es paga després de rebre).
7. Si un moviment NO té cap factura possible (nòmines, impostos, quotes, subscripcions sense factura), marca'l com "no_match" amb la raó.
8. Prioritza coincidències d'import exacte + nom similar. Després import similar + data propera.
9. Cada factura NOMÉS es pot assignar a UN moviment (no reutilitzar).
10. Sigues conservador: és millor no proposar un match dubtós que proposar-ne un d'incorrecte.

CONFIANÇA:
- 0.95: Import exacte (±0.05€) + nom coincident
- 0.85: Import exacte + data propera (±15 dies)
- 0.75: Import similar (±2€) + nom coincident
- 0.65: Import exacte però sense coincidència de nom clara
- 0.50: Match probable però amb dubtes (explicar raó)
- NO proposar matches amb confiança <0.50

RESPOSTA en format JSON estricte (sense text addicional, NOMÉS el JSON):
{
  "matches": [
    {
      "movementId": "id_del_moviment",
      "invoices": [
        { "invoiceId": "id_factura", "type": "received" }
      ],
      "confidence": 0.95,
      "reason": "Explicació breu en català"
    }
  ],
  "no_match": [
    {
      "movementId": "id_del_moviment",
      "reason": "Raó per la qual no es pot conciliar (ex: nòmina, impost, subscripció)"
    }
  ],
  "summary": "Resum breu: X matches trobats de Y moviments"
}`;

  const userMessage = `MOVIMENTS BANCARIS PENDENTS DE CONCILIAR (${limitedMovements.length}):
${movementsText}

FACTURES DISPONIBLES PER CONCILIAR (${limitedReceived.length} rebudes + ${limitedIssued.length} emeses):
${invoicesText}

Analitza cada moviment i troba la millor factura (o factures) corresponent. Respon NOMÉS amb JSON.`;

  logger.info(`Conciliació IA: enviant ${limitedMovements.length} moviments i ${limitedReceived.length + limitedIssued.length} factures a Claude ${MODEL}`);

  const result = await callClaude(systemPrompt, userMessage);

  // Parsejar la resposta JSON
  let parsed;
  try {
    // Claude pot enviar markdown code blocks, netejar-los
    let jsonText = result.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(jsonText);
  } catch (err) {
    logger.error(`Conciliació IA: error parsejant resposta JSON: ${err.message}`);
    logger.error(`Resposta raw: ${result.text.substring(0, 500)}`);
    throw new Error('La IA no ha retornat un JSON vàlid. Torna-ho a intentar.');
  }

  // Validar estructura
  if (!parsed.matches || !Array.isArray(parsed.matches)) {
    throw new Error('Resposta IA invàlida: falta array "matches"');
  }

  // Validar que els IDs existeixen
  const movementIds = new Set(limitedMovements.map(m => m.id));
  const receivedIds = new Set(limitedReceived.map(i => i.id));
  const issuedIds = new Set(limitedIssued.map(i => i.id));
  const usedInvoiceIds = new Set();

  const validMatches = [];
  for (const match of parsed.matches) {
    // Validar moviment
    if (!movementIds.has(match.movementId)) {
      logger.warn(`Conciliació IA: moviment ${match.movementId} no trobat, ignorant`);
      continue;
    }

    // Validar factures
    const validInvoices = [];
    let allValid = true;
    for (const inv of (match.invoices || [])) {
      const idSet = inv.type === 'received' ? receivedIds : issuedIds;
      if (!idSet.has(inv.invoiceId)) {
        logger.warn(`Conciliació IA: factura ${inv.invoiceId} no trobada, ignorant match`);
        allValid = false;
        break;
      }
      if (usedInvoiceIds.has(inv.invoiceId)) {
        logger.warn(`Conciliació IA: factura ${inv.invoiceId} ja usada, ignorant match`);
        allValid = false;
        break;
      }
      validInvoices.push(inv);
    }

    if (allValid && validInvoices.length > 0) {
      validInvoices.forEach(inv => usedInvoiceIds.add(inv.invoiceId));
      validMatches.push({
        ...match,
        invoices: validInvoices,
        confidence: Math.min(Math.max(match.confidence || 0.5, 0), 1),
      });
    }
  }

  logger.info(`Conciliació IA: ${validMatches.length} matches vàlids de ${parsed.matches.length} proposats (${parsed.no_match?.length || 0} sense match)`);

  return {
    matches: validMatches,
    noMatch: parsed.no_match || [],
    summary: parsed.summary || '',
    tokens: result.usage,
    movementsSent: limitedMovements.length,
    invoicesSent: limitedReceived.length + limitedIssued.length,
  };
}

module.exports = { runAIConciliation };
