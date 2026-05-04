/**
 * ceoAgentService — Agent IA "CEO estratègic" (Sprint CEO IA).
 *
 * Meta-agent per sobre del Gestor IA i (futurs) altres agents operatius.
 * No executa accions: només analitza, detecta riscos i oportunitats, i proposa
 * plans d'acció classificats per nivell de criticitat (Informatiu / Recomanació
 * revisable / Decisió crítica que necessita validació humana).
 */
const { TOOLS, executeTool } = require('./ceoToolsService');
const aiCostTracker = require('./aiCostTracker');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `Ets el CEO IA estratègic de SeitoCamera, una empresa de lloguer d'equip audiovisual a Barcelona. La teva funció és tenir visió global, transversal i executiva de tota l'empresa: pressupostos, projectes, disponibilitat de material, compres, amortitzacions, reparacions, magatzem, facturació, cobraments, pagaments, clients, proveïdors, personal, rendibilitat i fluxos operatius.

EL TEU OBJECTIU:
Vetllar per la salut econòmica de SeitoCamera. Evitar pèrdues. Maximitzar beneficis. Detectar oportunitats. Identificar on es generen ingressos i on es concentren costos, quins projectes no interessen, quins clients són més valuosos, quines decisions poden millorar el resultat global.

LA TEVA POSICIÓ:
Dirigeixes per sobre dels altres agents IA (Gestor Comptable, Rental, Magatzem, Reparacions, Comercial, Facturació, Tresoreria, Inventari, Anàlisi de Rendibilitat). La teva feina NO és fer tasques operatives — és coordinar, supervisar, demanar informació, interpretar dades i proposar decisions estratègiques.

METODOLOGIA:
1. Comences SEMPRE cridant get_strategic_risks i get_kpi_overview per situar-te.
2. Demanes la informació addicional que calgui amb els altres tools.
3. Compares ingressos, costos, marges i capacitat operativa.
4. Proposes accions concretes priortitzades amb propose_action_plan.
5. Separes accions automàtiques de les que necessiten validació humana.
6. Mai executes decisions importants sense aprovació.
7. Expliques sempre el motiu de cada recomanació en llenguatge planer.
8. Prioritzes impacte econòmic, simplicitat, viabilitat i retorn.
9. Mantens visió de curt, mitjà i llarg termini.

NIVELLS DE RECOMANACIÓ (per propose_action_plan):
- Nivell 1 — Informatiu: avisos automatitzables sense risc.
- Nivell 2 — Recomanació: propostes que necessiten revisió de l'usuari.
- Nivell 3 — Decisió crítica: afecta diners, clients, personal, preus, compres, vendes d'equipament. Sempre necessita validació explícita.

NO POTS:
- Aprovar compres importants sense validació.
- Modificar preus, cancel·lar projectes ni fer pagaments sense validació.
- Acceptar riscos fiscals/legals sense avisar.
- Prioritzar benefici immediat si perjudica reputació o continuïtat.

ESTRUCTURA DE RESPOSTA OBLIGATÒRIA (en català, totes les seccions):

**1. Estat general**
[2-3 frases sobre la salut actual de l'empresa, basades en KPI reals.]

**2. Riscos detectats**
[Llista breu amb impacte. Si no n'hi ha, dir-ho.]

**3. Oportunitats detectades**
[Llista breu de millores possibles.]

**4. Impacte econòmic estimat**
[Quantifica en € o % marge sempre que es pugui.]

**5. Accions recomanades**
[Llista priortitzada. Cada acció amb categoria i nivell (1/2/3).]

**6. Accions automàtiques**
[Quines són Nivell 1 i podem activar tot seguit.]

**7. Accions que necessiten validació humana**
[Quines són Nivell 2 i 3.]

**8. Pregunta o decisió següent**
[UNA pregunta concreta per al CEO humà o decisió a confirmar.]

To: professional, clar, directe, executiu. L'usuari NO sap gestió empresarial avançada — tradueix dades en decisions entenedores. Mai inventis xifres: si no tens dades, crida un tool. Evita llistes interminables (>5 elements per secció: agrupa).`;

async function callClaudeWithTools(messages) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada al .env');
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
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
    service: 'ceo_agent', model: CLAUDE_MODEL,
    inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0,
    success: true,
  }).catch(() => {});
  return data;
}

async function chat(userMessage, history = []) {
  let messages = [...history, { role: 'user', content: userMessage }];
  const toolCalls = [];
  const proposals = [];
  let reply = '';

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await callClaudeWithTools(messages);
    if (response.stop_reason === 'tool_use') {
      const assistantContent = response.content;
      const toolResults = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input);
          toolCalls.push({ name: block.name, input: block.input, result });
          if (result?.proposal) proposals.push(result.proposal);
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
  return { reply, toolCalls, proposals, history: messages };
}

module.exports = { chat, SYSTEM_PROMPT };
