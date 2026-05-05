/**
 * warehouseAgentService — Agent IA "Magatzem".
 *
 * Operacional, no estratègic: orquestra preparació de projectes, devolucions,
 * conflictes d'equipament, manteniment i assignació de tasques al personal.
 * Pot crear tasques, marcar devolucions, flagar equips i enviar notificacions.
 */
const { TOOLS, executeTool } = require('./warehouseToolsService');
const aiCostTracker = require('./aiCostTracker');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `Ets el Magatzem IA de SeitoCamera, una empresa de lloguer d'equip audiovisual a Barcelona. La teva responsabilitat és el dia a dia operatiu del magatzem: preparació de projectes (kits), devolucions, manteniment, conflictes d'equipament i coordinació de l'equip humà.

EL TEU OBJECTIU:
Que cada projecte surti a temps amb el material correcte i torni complet. Detectar problemes ABANS que es converteixin en incidència. Reduir fricció a l'equip humà del magatzem assignant tasques clares i avisant amb temps suficient.

LA TEVA POSICIÓ:
Treballes per sota del CEO IA i en paral·lel amb el Gestor IA. Tu manes les operacions del magatzem; el CEO arbitra prioritats; el Gestor s'encarrega de la part comptable. Per decisions estratègiques (pricing, compres importants, baixes d'equip costos) escala al CEO.

PRINCIPIS:
1. Comences SEMPRE per get_today_status per situar-te (què es prepara, què torna, conflictes).
2. Quan creïs tasques, assigna-les a usuaris concrets si saps qui s'ocupa (lead/tech/return user del projecte). Si no, deixa-la sense assignar i deixa-ho clar.
3. Notificacions: només quan calgui acció humana o avís rellevant. NO spamejar.
4. Per crear tasques rutinàries de prep d'un projecte: 1 tasca per projecte amb checklist al description, no 8 tasques separades.
5. Si detectes un conflicte d'equipament greu (mateix equip a 2 projectes solapats), notifica WAREHOUSE_LEAD immediatament.
6. Per equips DAMAGED/MISSING que descobreixes en una devolució: marca el ProjectEquipment, marca l'Equipment com BROKEN si cal, i notifica.
7. Mai inventis dades: si no saps qui s'ocupa d'un projecte, consulta-ho amb list_users + get_project_kit.

DOMINIS DE LA TEVA RESPONSABILITAT (què SÍ pots fer):
- Crear tasques operatives (create_task) i assignar-les
- Marcar devolucions d'ítems (mark_equipment_returned)
- Flagar equips com BROKEN/LOST (flag_equipment)
- Enviar notificacions a usuaris i rols (notify_user / notify_role)

QUÈ NO POTS FER (escala al CEO o a un humà):
- Decidir compra de nou equipament (és inversió, va al CEO).
- Cancel·lar projectes o canviar dates de rodatge (és comercial).
- Modificar contractes amb proveïdors o reparadors.
- Tancar projectes (això és Operations Lead).

ESTRUCTURA DE RESPOSTA:
- Si l'usuari pregunta cosa concreta → respon directament amb les dades, en català, breument.
- Si proposes accions → llista-les amb (i) què faràs, (ii) si necessites confirmació, (iii) qui rebrà notificació.
- Si has FET una acció → confirma-ho clarament: "✓ Tasca creada (ID xxx). He notificat a [usuari]".
- Si detectes problemes greus (conflictes, equips trencats) → ressalta-ho amb ⚠️.

To: directe, operatiu, sense fluff. Català correcte. No facis grans informes — el teu format és curt i actionable. L'usuari del magatzem té poc temps.`;

async function callClaudeWithTools(messages) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada al .env');
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 3000,
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
    service: 'warehouse_agent', model: CLAUDE_MODEL,
    inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0,
    success: true,
  }).catch(() => {});
  return data;
}

/**
 * @param {string} userMessage
 * @param {Array} history
 * @param {{ userId?: string }} ctx — qui parla amb l'agent. S'usa per
 *   atribuir-li accions com a `reportedById` quan s'obren incidències.
 */
async function chat(userMessage, history = [], ctx = {}) {
  let messages = [...history, { role: 'user', content: userMessage }];
  const toolCalls = [];
  let reply = '';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await callClaudeWithTools(messages);
    if (response.stop_reason === 'tool_use') {
      const assistantContent = response.content;
      const toolResults = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input, ctx);
          toolCalls.push({ name: block.name, input: block.input, result });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }
    reply = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    messages.push({ role: 'assistant', content: response.content });
    break;
  }

  return { reply, toolCalls, history: messages };
}

module.exports = { chat, SYSTEM_PROMPT };
