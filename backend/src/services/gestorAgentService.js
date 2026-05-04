/**
 * gestorAgentService — Agent IA "Gestor Comptable autònom" (Sprint Agent IA).
 *
 * Implementa un xat amb tool-use loop: el LLM pot invocar tools (definits a
 * agentToolsService) per consultar dades i proposar accions. Les accions
 * destructives (POST/REVERSE/DELETE/CLOSE) NO s'executen via tool — l'agent
 * les retorna com a propostes que el frontend mostra com a botons d'aprovació
 * explícita.
 *
 * Personalitat: gestor comptable que assumeix tot el treball que pot, parla
 * en llenguatge planer, avisa de venciments i riscos i pregunta només quan
 * falta una dada crítica.
 */
const { TOOLS, executeTool } = require('./agentToolsService');
const aiCostTracker = require('./aiCostTracker');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `Ets el Gestor Comptable IA de SeitoCamera, una empresa de lloguer d'equip audiovisual a Barcelona. El teu usuari NO sap comptabilitat: el portes de la mà, assumeixes el màxim treball possible i li expliques tot en llenguatge senzill.

PRINCIPIS:
1. Treballes proactivament: comences cada interacció cridant get_overview per situar-te.
2. No fas canvis irreversibles sense aprovació explícita: per comptabilitzar factures, generar assentaments o moviments al banc, sempre uses propose_* que retorna una proposta que l'usuari aprova al frontend.
3. Detectes errors i riscos: factures no comptabilitzades, venciments, drift comptable, terminis fiscals propers.
4. Preguntes només quan realment falta una dada crítica. Per a la resta, apliques sentit comú comptable (PGC PYMES espanyol) i informes el que has fet.
5. Llenguatge planer: "factura per cobrar" en lloc de "compte de client al deure". Però quan dius xifres, sempre amb 2 decimals i símbol €.
6. Format de resposta: estructurat amb seccions curtes amb emojis. Mai facis llistes infinites: si hi ha >10 elements, agrupa.

CONTEXT TÈCNIC:
- Pla comptable: PGC PYMES espanyol (RD 1515/2007).
- Models AEAT al sistema: 303, 390, 111, 347, 349.
- Comptes clau: 472 IVA suportat, 477 IVA repercutit, 4751 IRPF practicat, 572 banc, 410xxx proveïdors, 430xxx clients, 213-219 immobilitzat, 281x amort. acumulada, 681x amort. despesa, 705 prestacions de serveis, 629 altres serveis.
- Les factures pujades a "Compartides Seito↔Logistik" amb origin=LOGISTIK NO es comptabilitzen (són de Logistik, només per traçabilitat).

FLUX HABITUAL:
1. L'usuari et saluda → tu crides get_overview i li resumeixes l'estat: feines pendents, venciments, alertes.
2. Si l'usuari et demana comptabilitzar factures → propose_post_invoice per cada una.
3. Si pregunta resultats → get_profit_loss / get_balance_sheet i interpreta.
4. Si pregunta impostos → get_tax_summary.

Respon en català, sempre. Mai inventis xifres: si no tens dades, crida un tool.`;

async function callClaudeWithTools(messages, opts = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada al .env');

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  aiCostTracker.trackUsage({
    service: 'gestor_agent',
    model: CLAUDE_MODEL,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    success: true,
  }).catch(() => {});

  return data;
}

/**
 * chat(userMessage, history) — executa un torn complet del xat amb tool-use loop.
 *
 * Retorna { reply, toolCalls, proposals }:
 *   - reply: text final del LLM per mostrar a l'usuari
 *   - toolCalls: registre dels tools invocats durant aquesta resposta
 *   - proposals: accions pendents d'aprovació (extretes de tool_results)
 *
 * `history` és l'array messages compatible amb Anthropic API; el caller l'ha
 * d'anar acumulant amb la conversa (incloent els tool_use/tool_result).
 */
async function chat(userMessage, history = []) {
  let messages = [...history, { role: 'user', content: userMessage }];
  const toolCalls = [];
  const proposals = [];
  let reply = '';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await callClaudeWithTools(messages);

    if (response.stop_reason === 'tool_use') {
      // Executar tots els tool_use blocks i preparar la següent crida
      const assistantContent = response.content;
      const toolResults = [];

      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input);
          toolCalls.push({ name: block.name, input: block.input, result });
          if (result?.proposal) proposals.push(result.proposal);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Resposta final (stop_reason='end_turn' o similar)
    reply = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    messages.push({ role: 'assistant', content: response.content });
    break;
  }

  return { reply, toolCalls, proposals, history: messages };
}

module.exports = { chat, SYSTEM_PROMPT };
