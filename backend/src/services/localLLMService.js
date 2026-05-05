/**
 * localLLMService — Wrapper sobre Ollama (LLM local).
 *
 * Endpoint: http://localhost:11434/api/chat (compatible OpenAI-like).
 * Per defecte usa el model definit a OLLAMA_MODEL (env) o qwen3:32b.
 *
 * Aquest servei es fa servir per a tasques repetitives i de baix risc
 * (classificació de factures, extracció estructurada, etc.) per estalviar
 * cost i evitar rate limits de la API externa. Per a tasques amb tool-use
 * complex (CEO IA, Gestor IA chat) seguim usant Claude API.
 *
 * Mode "thinking" desactivat per defecte: Qwen3 i altres models recents
 * activen una cadena de raonament interna que genera molts tokens i fa
 * que el camp `response` quedi buit. `think: false` el deshabilita.
 */
const aiCostTracker = require('./aiCostTracker');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:32b';

/**
 * Detecta si Ollama està disponible (per fallback ràpid sense esperar timeouts).
 */
async function isAvailable() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * callLLM(systemPrompt, messages, options) — interfície idèntica a la de
 * Claude perquè es pugui intercanviar fàcilment.
 *
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant',content:string}>} messages
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {number} [options.maxTokens=2048]
 * @param {number} [options.temperature=0.2]
 * @param {boolean} [options.think=false]
 * @returns {Promise<string>} text de la resposta
 */
async function callLLM(systemPrompt, messages, options = {}) {
  const model = options.model || OLLAMA_MODEL;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    stream: false,
    think: options.think ?? false,
    options: {
      temperature: options.temperature ?? 0.2,
      num_predict: options.maxTokens || 2048,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const text = data.message?.content || '';

  // Tracking (token counts són aproximats: Ollama no els reporta sempre)
  aiCostTracker.trackUsage({
    service: options.trackingService || 'local_llm',
    model: `ollama:${model}`,
    inputTokens: data.prompt_eval_count || 0,
    outputTokens: data.eval_count || 0,
    success: true,
    metadata: options.metadata || null,
  }).catch(() => {});

  return text;
}

module.exports = { callLLM, isAvailable, OLLAMA_MODEL };
