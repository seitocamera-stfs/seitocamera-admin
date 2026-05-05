/**
 * SERVEI D'AGENT COMPTABLE INTEL·LIGENT
 *
 * Agent expert en comptabilitat espanyola (PGC) que:
 *   1. Classifica factures com a despesa directa o inversió
 *   2. Assigna comptes del Pla General Comptable
 *   3. Detecta anomalies (IVA incorrecte, imports inusuals, etc.)
 *   4. Respon consultes lliures sobre l'estat comptable
 *
 * Usa l'API de Claude (Anthropic) com a motor d'IA.
 */

const { logger } = require('../config/logger');
const { prisma } = require('../config/database');
const company = require('../config/company');
const aiCostTracker = require('./aiCostTracker');
const localLLM = require('./localLLMService');

// ===========================================
// Configuració Claude API
// ===========================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2048;

/**
 * Crida a l'API de Claude
 */
async function callLLM(systemPrompt, messages, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurada. Afegeix-la al fitxer .env');
  }

  const model = options.model || CLAUDE_MODEL;
  const body = {
    model,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages,
  };
  // Permetre temperature explícita (e.g. 0 per classificacions deterministes)
  if (options.temperature !== undefined) body.temperature = options.temperature;

  // Retry amb backoff per a rate limits (429): respecta retry-after header.
  const maxRetries = options.maxRetries ?? 4;
  let response;
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
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

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '15', 10);
      const wait = Math.max(retryAfter, 12) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
      continue;
    }
    break;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  // Registrar cost (fire-and-forget)
  const serviceName = options.trackingService || 'accounting_agent';
  aiCostTracker.trackUsage({
    service: serviceName,
    model,
    inputTokens,
    outputTokens,
    entityType: options.entityType || null,
    entityId: options.entityId || null,
    success: true,
    metadata: options.metadata || null,
  }).catch(() => {});

  return text;
}

/**
 * callLLMLocalFirst — Per tasques no interactives (classificació, detecció
 * d'anomalies, etc.) prova primer Ollama local i només cau a Claude si no
 * està disponible o falla. Estalvia cost i evita rate limits.
 *
 * Per tasques amb tool-use complex (chat CEO, chat Gestor) NO usar — Qwen3
 * no és prou fiable per tool-calling.
 *
 * Es pot desactivar globalment amb LOCAL_LLM_ENABLED=false al .env.
 */
async function callLLMLocalFirst(systemPrompt, messages, options = {}) {
  const useLocal = process.env.LOCAL_LLM_ENABLED !== 'false' && await localLLM.isAvailable();
  if (!useLocal) {
    return callLLM(systemPrompt, messages, options);
  }
  try {
    const localOpts = { ...options, trackingService: (options.trackingService || 'accounting_agent') + '_local' };
    const text = await localLLM.callLLM(systemPrompt, messages, localOpts);
    // Validació opcional: si caller passa `validateJson: true`, comprovem que
    // la resposta contingui JSON parsejable. Sinó cau a Claude.
    if (options.validateJson) {
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('Resposta local sense JSON');
        JSON.parse(m[0]);
      } catch (parseErr) {
        logger.warn(`Local LLM JSON invàlid (${options.trackingService || 'task'}): ${parseErr.message}. Fallback a Claude.`);
        return callLLM(systemPrompt, messages, options);
      }
    }
    return text;
  } catch (err) {
    logger.warn(`Local LLM va fallar (${options.trackingService || 'task'}): ${err.message}. Fallback a Claude.`);
    return callLLM(systemPrompt, messages, options);
  }
}

// ===========================================
// System Prompts
// ===========================================

const SYSTEM_PROMPT_CLASSIFIER = `Ets un expert comptable especialitzat en el Pla General Comptable (PGC) espanyol, treballant per una empresa de ${company.sector} (${company.name}).

El teu treball és classificar factures rebudes (despeses) en:

**TIPUS DE DESPESA:**
- EXPENSE (Despesa directa): despeses corrents del dia a dia
- INVESTMENT (Inversió/Immobilitzat): béns duradors > 300€ amb vida útil > 1 any

**COMPTES PGC HABITUALS per a una empresa d'equips audiovisuals:**

Despeses (grup 6):
- 621: Arrendaments i cànons (lloguer local, lloguer equips)
- 622: Reparacions i conservació
- 623: Serveis professionals independents (assessoria, advocats, comptable)
- 624: Transports
- 625: Primes d'assegurances
- 626: Serveis bancaris i similars
- 627: Publicitat, propaganda i relacions públiques
- 628: Subministraments (llum, aigua, gas, internet, telèfon)
- 629: Altres serveis (hosting, software subscripcions, SaaS)
- 600: Compres de mercaderies (material fungible per revenda)
- 602: Compres d'altres aprovisionaments (consumibles, fungibles no revenda)
- 606: Descomptes sobre compres per pagament anticipat
- 631: Altres tributs (taxes municipals, IAE)
- 640: Sous i salaris
- 642: Seguretat social a càrrec de l'empresa
- 649: Altres despeses socials (formació, menjador)
- 662: Interessos de deutes (préstecs)
- 680: Amortització immobilitzat intangible
- 681: Amortització immobilitzat material

Inversions (grup 2):
- 213: Maquinària (equips de fotografia/vídeo, càmeres, objectius > 300€)
- 214: Utillatge (accessoris tècnics duradors: trípodes, filtres professionals)
- 215: Altres instal·lacions (reforma local, aire condicionat)
- 216: Mobiliari (mobles oficina, estanteries, prestatgeries)
- 217: Equips per a processos d'informació (ordinadors, servidors, discs)
- 206: Aplicacions informàtiques (software llicències perpètues > 300€)

**CRITERIS DE CLASSIFICACIÓ:**
1. Import > 300€ + vida útil > 1 any → probable INVESTMENT
2. Subscripcions mensuals/anuals → sempre EXPENSE (629)
3. Reparacions → EXPENSE (622), encara que siguin cares
4. Material fungible (cables, targetes SD, bateries) → EXPENSE (602)
5. Equip audiovisual > 300€ (càmeres, objectius, focus) → INVESTMENT (213)
6. Software llicència perpètua > 300€ → INVESTMENT (206)
7. Software SaaS/subscripció → EXPENSE (629)

Respon SEMPRE en format JSON:
{
  "accountingType": "EXPENSE" | "INVESTMENT",
  "pgcAccount": "XXX",
  "pgcAccountName": "Nom del compte",
  "confidence": 0.0-1.0,
  "reasoning": "Explicació breu del raonament"
}`;

const SYSTEM_PROMPT_ANOMALY = `Ets un auditor comptable expert revisant factures d'una empresa de ${company.sector} (${company.name}, ${company.city}).

REGLA CRÍTICA — País del proveïdor:
El país de cada factura te'l dono explícitament al camp "País" (codi ISO 2 lletres: ES, DE, FR, NL, BE, IT, PT, etc.). NO infereixis nacionalitat del nom del proveïdor ni del text. Si una factura diu "País: ES" és espanyola, encara que el proveïdor es digui "TODOCERRADURAS GmbH". Si vols afirmar "factura intracomunitària" o "factura d'altre país", el codi NO ha de ser ES.

Busca anomalies en les factures rebudes:

1. **IVA incorrecte**: Espanya general 21%, reduït 10%, superreduït 4%. Si l'IVA no quadra amb l'import, alerta. Per factures NO espanyoles (País != ES) considera intracomunitari (IVA 0% amb inversió subjecte passiu) o exportació.
2. **Imports inusuals**: Si una factura d'un proveïdor habitual té un import molt diferent del normal, alerta.
3. **Dades incompletes**: NIF absent, número de factura sospitós, data futura.
4. **Possibles duplicats**: Factures del mateix proveïdor amb import similar en dates properes.
5. **Proveïdors sense NIF**: Obligatori a Espanya per factures > 400€.

Per cada anomalia, respon en JSON:
{
  "anomalies": [
    {
      "invoiceNumber": "Nº de la factura afectada (exacte, tal com apareix a les dades)",
      "type": "TAX_WARNING" | "ANOMALY" | "MISSING_DATA" | "DUPLICATE",
      "title": "Títol curt",
      "description": "Descripció detallada",
      "severity": "low" | "medium" | "high",
      "confidence": 0.0-1.0
    }
  ]
}

Si no trobes anomalies, respon: { "anomalies": [] }`;

const SYSTEM_PROMPT_CHAT = `Ets un assessor comptable expert, treballant com a assistent intern per ${company.name}, una empresa de ${company.sector} a ${company.city}.

Tens ACCÉS TOTAL i EN TEMPS REAL a TOTES les dades de l'empresa. Cada cop que l'usuari fa una pregunta, reps automàticament les dades rellevants de la base de dades.

DADES A LES QUALS TENS ACCÉS:
- Factures rebudes: imports, dates, proveïdors, estat de pagament, classificació PGC, contingut PDF
- Factures emeses: imports, clients, projectes, estat de cobrament
- Moviments bancaris: ingressos, despeses, transferències, saldos, conciliació
- Conciliació bancària: quines factures estan lligades a quins moviments
- Proveïdors: historial, volum de compres, NIF, dades de contacte
- Clients: historial de facturació, volum de vendes, dades de contacte
- Inventari d'equips: càmeres, objectius, accessoris amb números de sèrie i valor
- Notes i recordatoris interns
- Evolució mensual i trimestral de despeses i ingressos
- Desglossament per comptes del PGC (Pla General Comptable)

RESPONSABILITATS:
- Respondre QUALSEVOL pregunta comptable amb DADES CONCRETES i NÚMEROS REALS
- Classificar factures (despesa vs inversió) i assignar comptes PGC
- Calcular IVA trimestral (IVA repercutit - IVA suportat)
- Calcular benefici/pèrdua, marges, rendibilitat
- Detectar anomalies: imports inusuals, IVA incorrecte, factures duplicades
- Analitzar cash flow i liquiditat
- Aconsellar sobre deduccions, amortitzacions, fiscalitat
- Preparar informació per al comptable extern o per declaracions trimestrals
- Fer comparatives: any vs any, trimestre vs trimestre, proveïdor vs proveïdor
- Analitzar despesa per categoria, per proveïdor, per projecte
- Identificar factures pendents de pagar o cobrar
- Revisar la conciliació bancària i detectar moviments sense factura

REGLES:
- Parla en català, de forma clara i professional però propera
- Quan facis càlculs, mostra els números i el procés
- Quan referencis factures, inclou número, proveïdor/client i import
- Les respostes han de ser PRÀCTIQUES i ACCIONABLES
- MAI diguis que no tens accés a les dades — les tens TOTES
- Si l'usuari demana alguna cosa i les dades apareixen al context, UTILITZA-LES
- Quan donis consells fiscals, especifica la normativa aplicable (llei IVA, IS, IRPF)
- Per càlculs d'IVA trimestral: IVA repercutit (factures emeses) - IVA suportat (factures rebudes)
- Per amortitzacions: aplica les taules oficials d'amortització del PGC`;

// ===========================================
// Funcions de context (obtenir dades de la BD)
// ===========================================

/**
 * Obté un resum comptable per context de l'agent
 */
async function getAccountingSummary(dateFrom, dateTo) {
  const where = {};
  if (dateFrom || dateTo) {
    where.issueDate = {};
    if (dateFrom) where.issueDate.gte = new Date(dateFrom);
    if (dateTo) where.issueDate.lte = new Date(dateTo);
  }

  const [invoices, byType, byAccount, unpaid, totalExpense, totalIncome] = await Promise.all([
    prisma.receivedInvoice.count({ where }),
    prisma.receivedInvoice.groupBy({
      by: ['accountingType'],
      where: { ...where, accountingType: { not: null } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.receivedInvoice.groupBy({
      by: ['pgcAccount', 'pgcAccountName'],
      where: { ...where, pgcAccount: { not: null } },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
    }),
    prisma.receivedInvoice.count({
      where: {
        ...where,
        status: { notIn: ['PAID'] },
        conciliations: { none: { status: { in: ['CONFIRMED', 'MANUAL_MATCHED'] } } },
      },
    }),
    prisma.receivedInvoice.aggregate({
      where,
      _sum: { totalAmount: true },
    }),
    prisma.issuedInvoice.aggregate({
      where: dateFrom || dateTo ? { issueDate: where.issueDate } : {},
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    totalFactures: invoices,
    totalDespesa: totalExpense._sum.totalAmount || 0,
    totalIngressos: totalIncome._sum.totalAmount || 0,
    perTipus: byType.map((t) => ({
      tipus: t.accountingType || 'SENSE_CLASSIFICAR',
      total: t._sum.totalAmount,
      count: t._count,
    })),
    perCompte: byAccount.map((a) => ({
      compte: a.pgcAccount,
      nom: a.pgcAccountName,
      total: a._sum.totalAmount,
      count: a._count,
    })),
    facturesPendentsPagar: unpaid,
  };
}

/**
 * Obté el text complet del PDF d'una factura
 * Primer mira ocrRawData.text, si no descarrega de GDrive
 * @param {Object} invoice - Objecte factura amb ocrRawData i gdriveFileId
 * @returns {string|null} Text del PDF (limitat a 6000 caràcters per no saturar el context)
 */
async function getInvoicePdfText(invoice) {
  const MAX_TEXT = 6000;

  // 1) Intentar amb ocrRawData ja guardat
  if (invoice.ocrRawData?.text) {
    return invoice.ocrRawData.text.substring(0, MAX_TEXT);
  }

  // 2) Si té PDF a GDrive, descarregar i extreure
  if (invoice.gdriveFileId) {
    try {
      const gdrive = require('./gdriveService');
      const pdfExtract = require('./pdfExtractService');
      const path = require('path');
      const fs = require('fs');
      const os = require('os');

      const tmpPath = path.join(os.tmpdir(), `agent-read-${invoice.id}.pdf`);
      await gdrive.downloadFile(invoice.gdriveFileId, tmpPath);
      const analysis = await pdfExtract.analyzePdf(tmpPath);
      try { fs.unlinkSync(tmpPath); } catch {}

      if (analysis.text) {
        // Guardar per futures consultes (no tornar a descarregar)
        try {
          await prisma.receivedInvoice.update({
            where: { id: invoice.id },
            data: {
              ocrRawData: {
                ...(invoice.ocrRawData || {}),
                text: analysis.text.substring(0, 5000),
                hasText: true,
                ocrUsed: analysis.ocrUsed || false,
              },
            },
          });
        } catch {}
        return analysis.text.substring(0, MAX_TEXT);
      }
    } catch (err) {
      logger.warn(`Agent: no s'ha pogut llegir PDF de factura ${invoice.id}: ${err.message}`);
    }
  }

  return null;
}

/**
 * Obté detall d'una factura per context
 */
async function getInvoiceContext(invoiceId) {
  const invoice = await prisma.receivedInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      supplier: true,
      conciliations: {
        include: { bankMovement: { select: { description: true, date: true, amount: true } } },
      },
      agentSuggestions: { where: { status: 'PENDING' } },
    },
  });
  if (!invoice) return null;

  // Historial del proveïdor
  let supplierHistory = null;
  if (invoice.supplierId) {
    const history = await prisma.receivedInvoice.aggregate({
      where: { supplierId: invoice.supplierId, id: { not: invoiceId } },
      _avg: { totalAmount: true },
      _min: { totalAmount: true },
      _max: { totalAmount: true },
      _count: true,
    });
    supplierHistory = {
      totalFactures: history._count,
      importMig: history._avg.totalAmount,
      importMin: history._min.totalAmount,
      importMax: history._max.totalAmount,
    };
  }

  return { invoice, supplierHistory };
}

/**
 * Obté les últimes factures sense classificar
 */
async function getUnclassifiedInvoices(limit = 20) {
  // Aplica scope comptable: no classifiquem factures fora del rang configurat
  const scopeService = require('./accountingScopeService');
  const scope = await scopeService.scopeFilter('issueDate');
  return prisma.receivedInvoice.findMany({
    where: {
      ...scope,
      accountingType: null,
      status: { notIn: ['REJECTED'] },
    },
    include: {
      supplier: { select: { name: true, nif: true } },
    },
    orderBy: { issueDate: 'desc' },
    take: limit,
  });
}

// ===========================================
// Funcions principals de l'agent
// ===========================================

/**
 * Classifica una factura (despesa vs inversió + compte PGC)
 */
async function classifyInvoice(invoiceId) {
  const ctx = await getInvoiceContext(invoiceId);
  if (!ctx) throw new Error(`Factura ${invoiceId} no trobada`);

  const { invoice, supplierHistory } = ctx;

  const invoiceText = `
FACTURA A CLASSIFICAR:
- Número: ${invoice.invoiceNumber}
- Proveïdor: ${invoice.supplier?.name || 'Desconegut'} (NIF: ${invoice.supplier?.nif || 'No disponible'})
- Data: ${invoice.issueDate?.toISOString().split('T')[0]}
- Import total: ${invoice.totalAmount}€ (base: ${invoice.subtotal}€, IVA: ${invoice.taxRate}%)
- Descripció: ${invoice.description || 'Cap'}
- Categoria actual: ${invoice.category || 'Cap'}
- Fitxer: ${invoice.originalFileName || 'Cap'}
${invoice.ocrRawData?.text ? `- Text OCR (fragment): ${invoice.ocrRawData.text.substring(0, 500)}` : ''}
${supplierHistory ? `
HISTORIAL PROVEÏDOR:
- Total factures anteriors: ${supplierHistory.totalFactures}
- Import mitjà: ${supplierHistory.importMig}€
- Rang: ${supplierHistory.importMin}€ - ${supplierHistory.importMax}€` : ''}`;

  // Carregar regles de classificació
  const classRules = await prisma.agentRule.findMany({
    where: { isActive: true, category: { in: ['CLASSIFICATION', 'INVOICES', 'GENERAL'] } },
    orderBy: { priority: 'desc' },
  });
  let classifierPrompt = SYSTEM_PROMPT_CLASSIFIER;
  if (classRules.length > 0) {
    classifierPrompt += '\n\nREGLES ADDICIONALS DEFINIDES PER L\'USUARI (SEGUIR SEMPRE):';
    classRules.forEach((r) => {
      classifierPrompt += `\n- ${r.title}: Quan: ${r.condition} → ${r.action}`;
    });
  }

  // Temperature 0: classificació és tasca determinista; no volem variació
  const response = await callLLMLocalFirst(classifierPrompt, [
    { role: 'user', content: invoiceText },
  ], { trackingService: 'accounting_agent_classify', entityType: 'invoice', entityId: invoiceId, metadata: { invoiceId }, temperature: 0, validateJson: true });

  try {
    // Extreure JSON de la resposta (pot venir amb text extra)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta sense JSON');
    const result = JSON.parse(jsonMatch[0]);

    // Validar pgcAccount real: el LLM a vegades inventa codis ficticis com 000/999.
    // Comprovem que existeix al pla de comptes (provant 3 dígits + variant amb sufix).
    const rawCode = String(result.pgcAccount || '').trim();
    if (!rawCode) {
      throw new Error('pgcAccount buit a la resposta del LLM');
    }
    const candidates = [rawCode, rawCode + '000', rawCode.padEnd(6, '0')];
    const found = await prisma.chartOfAccount.findFirst({
      where: { code: { in: candidates } },
      select: { code: true, name: true },
    });
    if (!found) {
      logger.warn(`Classifier: pgcAccount ${rawCode} no existeix al pla de comptes (factura ${invoiceId})`);
      throw new Error(`pgcAccount inventat: ${rawCode} no existeix al pla de comptes`);
    }

    return {
      accountingType: result.accountingType,
      pgcAccount: result.pgcAccount,
      pgcAccountName: found.name,  // usem nom verídic, no el del LLM (per evitar drift)
      confidence: result.confidence || 0.7,
      reasoning: result.reasoning || '',
    };
  } catch (parseError) {
    logger.error(`Error parsejant resposta classificació: ${parseError.message}`);
    throw new Error(`Error interpretant la classificació: ${response.substring(0, 200)}`);
  }
}

/**
 * Analitza anomalies d'un conjunt de factures
 */
async function analyzeAnomalies(invoiceIds) {
  const invoices = await prisma.receivedInvoice.findMany({
    where: { id: { in: invoiceIds } },
    include: {
      supplier: { select: { name: true, nif: true, country: true } },
    },
  });

  if (invoices.length === 0) return [];

  // Obtenir historial per cada proveïdor
  const supplierIds = [...new Set(invoices.map((i) => i.supplierId).filter(Boolean))];
  const supplierStats = {};
  for (const sid of supplierIds) {
    const stats = await prisma.receivedInvoice.aggregate({
      where: { supplierId: sid },
      _avg: { totalAmount: true },
      _min: { totalAmount: true },
      _max: { totalAmount: true },
      _count: true,
    });
    supplierStats[sid] = stats;
  }

  const invoicesText = invoices.map((inv) => {
    const stats = inv.supplierId ? supplierStats[inv.supplierId] : null;
    const country = inv.supplier?.country || 'ES';
    return `
- Nº ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} (NIF: ${inv.supplier?.nif || 'SENSE NIF'}) | País: ${country}
  Import: ${inv.totalAmount}€ | Base: ${inv.subtotal}€ | IVA: ${inv.taxRate}% (${inv.taxAmount}€)
  Data: ${inv.issueDate?.toISOString().split('T')[0]} | Estat: ${inv.status}
  ${stats ? `Historial proveïdor: ${stats._count} factures, mitjana ${stats._avg?.totalAmount || '?'}€` : ''}`;
  }).join('\n');

  // Carregar regles d'anomalies
  const anomalyRules = await prisma.agentRule.findMany({
    where: { isActive: true, category: { in: ['ANOMALIES', 'INVOICES', 'GENERAL'] } },
    orderBy: { priority: 'desc' },
  });
  let anomalyPrompt = SYSTEM_PROMPT_ANOMALY;
  if (anomalyRules.length > 0) {
    anomalyPrompt += '\n\nREGLES ADDICIONALS DEFINIDES PER L\'USUARI (SEGUIR SEMPRE):';
    anomalyRules.forEach((r) => {
      anomalyPrompt += `\n- ${r.title}: Quan: ${r.condition} → ${r.action}`;
    });
  }

  const response = await callLLMLocalFirst(anomalyPrompt, [
    { role: 'user', content: `Analitza aquestes ${invoices.length} factures:\n${invoicesText}` },
  ], { trackingService: 'accounting_agent_anomalies', maxTokens: 3072, validateJson: true });

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const result = JSON.parse(jsonMatch[0]);
    return result.anomalies || [];
  } catch {
    logger.warn('Error parsejant anomalies:', response.substring(0, 200));
    return [];
  }
}

/**
 * Xat lliure amb l'agent comptable
 */
async function chat(userMessage, chatHistory = [], context = {}) {
  // Construir context amb dades reals
  const contextParts = [];

  // Sempre incloure resum general
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const summary = await getAccountingSummary(startOfYear.toISOString(), now.toISOString());
  contextParts.push(`
DADES REALS DE L'EMPRESA (${now.getFullYear()}):
- Total factures rebudes: ${summary.totalFactures}
- Total despeses: ${summary.totalDespesa}€
- Total ingressos: ${summary.totalIngressos}€
- Factures pendents de pagar: ${summary.facturesPendentsPagar}
${summary.perTipus.length > 0 ? `\nPer tipus:\n${summary.perTipus.map((t) => `  ${t.tipus}: ${t.count} factures, ${t.total}€`).join('\n')}` : ''}
${summary.perCompte.length > 0 ? `\nPer compte PGC (top 10):\n${summary.perCompte.slice(0, 10).map((a) => `  ${a.compte} ${a.nom}: ${a.count} factures, ${a.total}€`).join('\n')}` : ''}`);

  // Si l'usuari pregunta sobre una factura concreta (via context.invoiceId)
  if (context.invoiceId) {
    const ctx = await getInvoiceContext(context.invoiceId);
    if (ctx) {
      const inv = ctx.invoice;
      const pdfText = await getInvoicePdfText(inv);
      const equipment = await prisma.equipment.findMany({
        where: { receivedInvoiceId: inv.id },
        select: { name: true, serialNumber: true, brand: true, model: true, category: true, purchasePrice: true },
      });

      contextParts.push(`
FACTURA EN CONTEXT:
- Nº: ${inv.invoiceNumber}
- Proveïdor: ${inv.supplier?.name || '?'} (NIF: ${inv.supplier?.nif || 'No disponible'})
- Import: ${inv.totalAmount}€ (base: ${inv.subtotal}€, IVA: ${inv.taxRate}%, quota IVA: ${inv.taxAmount}€)
- Data: ${inv.issueDate?.toISOString().split('T')[0]}
- Classificació: ${inv.accountingType || 'Sense classificar'} / ${inv.pgcAccount || '?'} ${inv.pgcAccountName || ''}
- Estat: ${inv.status}
- Fitxer original: ${inv.originalFileName || 'Desconegut'}
${ctx.supplierHistory ? `- Historial proveïdor: ${ctx.supplierHistory.totalFactures} factures, mitjana ${ctx.supplierHistory.importMig}€` : ''}
${equipment.length > 0 ? `\nEQUIPS VINCULATS (${equipment.length}):\n${equipment.map((eq) => `  - ${eq.name}${eq.serialNumber ? ` (S/N: ${eq.serialNumber})` : ''}${eq.purchasePrice ? ` — ${eq.purchasePrice}€` : ''}`).join('\n')}` : ''}
${pdfText ? `\nCONTINGUT COMPLET DE LA FACTURA (text extret del PDF):\n${pdfText}` : '\n(No hi ha text PDF disponible per aquesta factura)'}`);
    }
  }

  // Detecció automàtica: si l'usuari menciona un número de factura o proveïdor, buscar-lo
  if (!context.invoiceId) {
    const invoiceRefMatch = userMessage.match(/(?:factura|fra\.?|invoice)\s*(?:n[ºo°]?\s*)?(\S+)/i);
    const mentionedInvoice = invoiceRefMatch ? invoiceRefMatch[1] : null;

    if (mentionedInvoice || context.query) {
      const searchTerm = mentionedInvoice || context.query;
      const searchResults = await prisma.receivedInvoice.findMany({
        where: {
          OR: [
            { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
            { supplier: { name: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        include: { supplier: { select: { name: true, nif: true } } },
        take: 5,
        orderBy: { issueDate: 'desc' },
      });

      if (searchResults.length > 0) {
        // Si n'hi ha una sola o coincideix exacte, incloure el text PDF
        const exactMatch = searchResults.find((r) =>
          r.invoiceNumber.toLowerCase() === searchTerm.toLowerCase()
        );
        const mainInvoice = exactMatch || (searchResults.length === 1 ? searchResults[0] : null);

        if (mainInvoice) {
          const pdfText = await getInvoicePdfText(mainInvoice);
          const equipment = await prisma.equipment.findMany({
            where: { receivedInvoiceId: mainInvoice.id },
            select: { name: true, serialNumber: true, brand: true, category: true, purchasePrice: true },
          });

          contextParts.push(`
FACTURA TROBADA "${searchTerm}":
- Nº: ${mainInvoice.invoiceNumber}
- Proveïdor: ${mainInvoice.supplier?.name || '?'} (NIF: ${mainInvoice.supplier?.nif || '?'})
- Import: ${mainInvoice.totalAmount}€ (base: ${mainInvoice.subtotal}€, IVA: ${mainInvoice.taxRate}%)
- Data: ${mainInvoice.issueDate?.toISOString().split('T')[0]}
- Estat: ${mainInvoice.status}
- Classificació: ${mainInvoice.accountingType || 'Sense classificar'} / ${mainInvoice.pgcAccount || '?'}
${equipment.length > 0 ? `\nEQUIPS (${equipment.length}):\n${equipment.map((eq) => `  - ${eq.name}${eq.serialNumber ? ` (S/N: ${eq.serialNumber})` : ''}`).join('\n')}` : ''}
${pdfText ? `\nCONTINGUT PDF:\n${pdfText}` : ''}`);
        } else {
          contextParts.push(`
RESULTATS CERCA "${searchTerm}" (${searchResults.length} factures):
${searchResults.map((r) => `- ${r.invoiceNumber} | ${r.supplier?.name || '?'} | ${r.totalAmount}€ | ${r.issueDate?.toISOString().split('T')[0]} | ${r.status}`).join('\n')}`);
        }
      }
    }
  }

  // ===== CONSULTES DINÀMIQUES: detectar què demana l'usuari i carregar dades =====
  const msgLower = userMessage.toLowerCase();

  // --- Deteccions per factures rebudes ---
  const wantsTopByAmount = /(?:m[eé]s\s*(?:car|gran|alt)|top|major|import\s*m[eé]s\s*alt|ordena.*import|per\s*import)/i.test(msgLower);
  const wantsRecent = /(?:darrer|[uú]ltim|recent|nova|m[eé]s\s*recent)/i.test(msgLower);
  const wantsPending = /(?:pendent|sense\s*pagar|no\s*paga|falta\s*pagar|impaga)/i.test(msgLower);
  const wantsUnclassified = /(?:sense\s*classific|no\s*classific|per\s*classific|falta\s*classific)/i.test(msgLower);
  const wantsBySupplier = /(?:per\s*prove|de\s*(?:cada|tots?\s*els)\s*prove|resum.*prove)/i.test(msgLower);
  const wantsExpenses = /(?:despes|gasto|cost|inversio|immobilitz|amortitz)/i.test(msgLower);
  const wantsMonthly = /(?:mensual|per\s*mes|cada\s*mes|mes\s*a\s*mes|evoluc)/i.test(msgLower);
  const wantsDuplicates = /(?:duplica|repetid)/i.test(msgLower);
  const wantsSupplierList = /(?:llista.*prove|quants?\s*prove|tots?\s*(?:els\s*)?prove)/i.test(msgLower);
  const wantsEquipment = /(?:equip|inventari|c[aà]mer|objectiu|material)/i.test(msgLower);
  const wantsAll = /(?:totes?\s*(?:les\s*)?factur|llista.*factur|mostra.*factur)/i.test(msgLower);

  // --- Deteccions per factures emeses ---
  const wantsIssuedInvoices = /(?:emes|emis|factur.*emes|factur.*client|vend|cobr|ingr[eè]s|factur)/i.test(msgLower);
  const wantsClientData = /(?:client|per\s*client|de\s*(?:cada|tots?\s*els)\s*client|quants?\s*client)/i.test(msgLower);

  // --- Deteccions per moviments bancaris ---
  const wantsBankData = /(?:banc|moviment|saldo|compt[ea]\s*banc|qonto|transferen|ingr[eè]s.*banc|rebut)/i.test(msgLower);
  const wantsConciliation = /(?:concili|sense\s*concili|no\s*concili|desconcili|moviment.*sense|factur.*sense.*moviment)/i.test(msgLower);

  // --- Deteccions per IVA/fiscal ---
  const wantsIVA = /(?:iva|trimest|model\s*\d|303|390|fiscal|declaraci|hacienda|liquid)/i.test(msgLower);

  // --- Deteccions per anàlisi ---
  const wantsComparative = /(?:compar|vs|respecte|anterior|any\s*passat|creixe|baixa|puja)/i.test(msgLower);
  const wantsCashFlow = /(?:cash\s*flow|flux.*caixa|liquiditat|tresoreria|solv[eè]ncia)/i.test(msgLower);
  const wantsAnomalies = /(?:anomal|problema|error|rar|estrany|revisa|avís|alerta)/i.test(msgLower);
  const wantsReminders = /(?:recordatori|pendent|venciment|data\s*l[íi]mit|urgent)/i.test(msgLower);

  // Detectar menció d'un proveïdor o client concret
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  const clients = await prisma.client.findMany({ select: { id: true, name: true } });
  const mentionedSupplier = suppliers.find((s) =>
    msgLower.includes(s.name.toLowerCase()) ||
    s.name.toLowerCase().split(/\s+/).some((word) => word.length > 3 && msgLower.includes(word.toLowerCase()))
  );
  const mentionedClient = clients.find((c) =>
    msgLower.includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().split(/\s+/).some((word) => word.length > 3 && msgLower.includes(word.toLowerCase()))
  );

  // ============================================
  // FACTURES REBUDES
  // ============================================

  if (wantsTopByAmount || wantsAll) {
    const topInvoices = await prisma.receivedInvoice.findMany({
      orderBy: { totalAmount: 'desc' },
      take: 25,
      include: { supplier: { select: { name: true } } },
    });
    contextParts.push(`
FACTURES REBUDES PER IMPORT (top 25):
${topInvoices.map((inv, i) => `${i + 1}. ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ (base ${inv.subtotal}€, IVA ${inv.taxAmount}€) | ${inv.issueDate?.toISOString().split('T')[0]} | ${inv.status} | ${inv.accountingType || 'sense classificar'}`).join('\n')}`);
  }

  if (wantsRecent) {
    const recentInvoices = await prisma.receivedInvoice.findMany({
      orderBy: { issueDate: 'desc' },
      take: 20,
      include: { supplier: { select: { name: true } } },
    });
    contextParts.push(`
FACTURES REBUDES RECENTS (últimes 20):
${recentInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | ${inv.issueDate?.toISOString().split('T')[0]} | ${inv.status}`).join('\n')}`);
  }

  if (wantsPending) {
    const pendingReceived = await prisma.receivedInvoice.findMany({
      where: { status: { notIn: ['PAID', 'REJECTED'] } },
      orderBy: [{ dueDate: 'asc' }, { totalAmount: 'desc' }],
      take: 30,
      include: { supplier: { select: { name: true } } },
    });
    const pendingIssued = await prisma.issuedInvoice.findMany({
      where: { status: { notIn: ['PAID', 'REJECTED'] } },
      orderBy: [{ dueDate: 'asc' }, { totalAmount: 'desc' }],
      take: 30,
      include: { client: { select: { name: true } } },
    });
    contextParts.push(`
FACTURES REBUDES PENDENTS DE PAGAR (${pendingReceived.length}):
${pendingReceived.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | Data: ${inv.issueDate?.toISOString().split('T')[0]} | Venciment: ${inv.dueDate?.toISOString().split('T')[0] || 'sense'} | ${inv.status}`).join('\n')}

FACTURES EMESES PENDENTS DE COBRAR (${pendingIssued.length}):
${pendingIssued.map((inv) => `- ${inv.invoiceNumber} | ${inv.client?.name || '?'} | ${inv.totalAmount}€ | Data: ${inv.issueDate?.toISOString().split('T')[0]} | Venciment: ${inv.dueDate?.toISOString().split('T')[0] || 'sense'} | ${inv.status}`).join('\n')}`);
  }

  if (wantsUnclassified) {
    const unclassifiedInvoices = await prisma.receivedInvoice.findMany({
      where: { accountingType: null, status: { notIn: ['REJECTED'] } },
      orderBy: { totalAmount: 'desc' },
      take: 30,
      include: { supplier: { select: { name: true } } },
    });
    contextParts.push(`
FACTURES SENSE CLASSIFICAR (${unclassifiedInvoices.length}):
${unclassifiedInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | ${inv.issueDate?.toISOString().split('T')[0]}`).join('\n')}`);
  }

  // ============================================
  // PROVEÏDORS
  // ============================================

  if (wantsBySupplier || wantsSupplierList) {
    const supplierStats = await prisma.receivedInvoice.groupBy({
      by: ['supplierId'],
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 25,
    });
    const supplierMap = {};
    suppliers.forEach((s) => { supplierMap[s.id] = s.name; });
    contextParts.push(`
RESUM PER PROVEÏDOR (top 25):
${supplierStats.map((s, i) => `${i + 1}. ${supplierMap[s.supplierId] || 'Desconegut'}: ${s._count} factures, total ${s._sum.totalAmount}€`).join('\n')}

TOTAL PROVEÏDORS REGISTRATS: ${suppliers.length}`);
  }

  if (mentionedSupplier) {
    const supplierInvoices = await prisma.receivedInvoice.findMany({
      where: { supplierId: mentionedSupplier.id },
      orderBy: { issueDate: 'desc' },
      take: 30,
      include: { supplier: { select: { name: true, nif: true, email: true, phone: true } } },
    });
    const supplierEquipment = await prisma.equipment.findMany({
      where: { supplierId: mentionedSupplier.id },
      select: { name: true, serialNumber: true, brand: true, category: true, purchasePrice: true, status: true },
    });
    const supplierTotal = supplierInvoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmount || 0), 0);
    contextParts.push(`
PROVEÏDOR: ${mentionedSupplier.name.toUpperCase()}
${supplierInvoices[0]?.supplier?.nif ? `NIF: ${supplierInvoices[0].supplier.nif}` : ''}
${supplierInvoices[0]?.supplier?.email ? `Email: ${supplierInvoices[0].supplier.email}` : ''}
Total facturat: ${supplierTotal.toFixed(2)}€ en ${supplierInvoices.length} factures

FACTURES:
${supplierInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.totalAmount}€ (base ${inv.subtotal}€, IVA ${inv.taxAmount}€) | ${inv.issueDate?.toISOString().split('T')[0]} | ${inv.status} | ${inv.accountingType || 'sense classificar'} ${inv.pgcAccount || ''}`).join('\n')}
${supplierEquipment.length > 0 ? `\nEQUIPS D'AQUEST PROVEÏDOR (${supplierEquipment.length}):\n${supplierEquipment.map((eq) => `- ${eq.name} | S/N: ${eq.serialNumber || '—'} | ${eq.category} | ${eq.purchasePrice ? eq.purchasePrice + '€' : '—'} | ${eq.status}`).join('\n')}` : ''}`);
  }

  // ============================================
  // FACTURES EMESES + CLIENTS
  // ============================================

  if (wantsIssuedInvoices && !wantsPending) {
    const issuedInvoices = await prisma.issuedInvoice.findMany({
      orderBy: { issueDate: 'desc' },
      take: 25,
      include: { client: { select: { name: true } } },
    });
    const issuedTotal = await prisma.issuedInvoice.aggregate({ _sum: { totalAmount: true }, _count: true });
    contextParts.push(`
FACTURES EMESES (${issuedTotal._count} total, últimes 25):
Total facturat: ${issuedTotal._sum.totalAmount || 0}€

${issuedInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.client?.name || '?'} | ${inv.totalAmount}€ (base ${inv.subtotal}€, IVA ${inv.taxAmount}€) | ${inv.issueDate?.toISOString().split('T')[0]} | ${inv.status}${inv.projectName ? ` | Projecte: ${inv.projectName}` : ''}`).join('\n')}`);
  }

  if (wantsClientData) {
    const clientStats = await prisma.issuedInvoice.groupBy({
      by: ['clientId'],
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 25,
    });
    const clientMap = {};
    clients.forEach((c) => { clientMap[c.id] = c.name; });
    contextParts.push(`
RESUM PER CLIENT (top 25):
${clientStats.map((c, i) => `${i + 1}. ${clientMap[c.clientId] || 'Desconegut'}: ${c._count} factures, total ${c._sum.totalAmount}€`).join('\n')}

TOTAL CLIENTS REGISTRATS: ${clients.length}`);
  }

  if (mentionedClient) {
    const clientInvoices = await prisma.issuedInvoice.findMany({
      where: { clientId: mentionedClient.id },
      orderBy: { issueDate: 'desc' },
      take: 30,
      include: { client: { select: { name: true, nif: true, email: true, phone: true } } },
    });
    const clientTotal = clientInvoices.reduce((sum, inv) => sum + parseFloat(inv.totalAmount || 0), 0);
    contextParts.push(`
CLIENT: ${mentionedClient.name.toUpperCase()}
${clientInvoices[0]?.client?.nif ? `NIF: ${clientInvoices[0].client.nif}` : ''}
${clientInvoices[0]?.client?.email ? `Email: ${clientInvoices[0].client.email}` : ''}
Total facturat: ${clientTotal.toFixed(2)}€ en ${clientInvoices.length} factures

FACTURES EMESES:
${clientInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.totalAmount}€ (base ${inv.subtotal}€, IVA ${inv.taxAmount}€) | ${inv.issueDate?.toISOString().split('T')[0]} | ${inv.status}${inv.projectName ? ` | ${inv.projectName}` : ''}`).join('\n')}`);
  }

  // ============================================
  // MOVIMENTS BANCARIS + CONCILIACIÓ
  // ============================================

  if (wantsBankData) {
    const bankSummary = await prisma.$queryRaw`
      SELECT
        type,
        COUNT(*)::int as count,
        SUM(amount)::float as total,
        "bankAccount"
      FROM "bank_movements"
      GROUP BY type, "bankAccount"
      ORDER BY "bankAccount", type
    `;
    const lastMovements = await prisma.bankMovement.findMany({
      orderBy: { date: 'desc' },
      take: 20,
    });
    const lastBalance = lastMovements[0]?.balance || 0;
    const unconciliated = await prisma.bankMovement.count({ where: { isConciliated: false } });

    contextParts.push(`
MOVIMENTS BANCARIS:
Saldo actual: ${lastBalance}€
Moviments sense conciliar: ${unconciliated}

Resum per tipus i compte:
${bankSummary.map((b) => `- ${b.bankAccount || '?'} | ${b.type}: ${b.count} moviments, total ${parseFloat(b.total || 0).toFixed(2)}€`).join('\n')}

ÚLTIMS 20 MOVIMENTS:
${lastMovements.map((m) => `- ${m.date?.toISOString().split('T')[0]} | ${m.type} | ${m.amount}€ | ${m.description?.substring(0, 60) || '?'} | Saldo: ${m.balance}€ | ${m.isConciliated ? '✅ Conciliat' : '❌ Sense conciliar'}`).join('\n')}`);
  }

  if (wantsConciliation) {
    const unconciliatedMovements = await prisma.bankMovement.findMany({
      where: { isConciliated: false },
      orderBy: { date: 'desc' },
      take: 25,
    });
    const unconciliatedInvoices = await prisma.receivedInvoice.findMany({
      where: {
        status: { notIn: ['PAID', 'REJECTED'] },
        conciliations: { none: {} },
      },
      orderBy: { totalAmount: 'desc' },
      take: 25,
      include: { supplier: { select: { name: true } } },
    });
    contextParts.push(`
CONCILIACIÓ BANCÀRIA — PENDENTS:

Moviments bancaris sense conciliar (${unconciliatedMovements.length}):
${unconciliatedMovements.map((m) => `- ${m.date?.toISOString().split('T')[0]} | ${m.type} | ${m.amount}€ | ${m.description?.substring(0, 60) || '?'}`).join('\n')}

Factures rebudes sense moviment bancari (${unconciliatedInvoices.length}):
${unconciliatedInvoices.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | ${inv.issueDate?.toISOString().split('T')[0]}`).join('\n')}`);
  }

  // ============================================
  // IVA TRIMESTRAL / FISCAL
  // ============================================

  if (wantsIVA) {
    const currentYear = now.getFullYear();
    const quarters = [
      { q: 'T1', from: `${currentYear}-01-01`, to: `${currentYear}-03-31` },
      { q: 'T2', from: `${currentYear}-04-01`, to: `${currentYear}-06-30` },
      { q: 'T3', from: `${currentYear}-07-01`, to: `${currentYear}-09-30` },
      { q: 'T4', from: `${currentYear}-10-01`, to: `${currentYear}-12-31` },
    ];

    const ivaData = [];
    for (const q of quarters) {
      const [ivaSuportat, ivaRepercutit] = await Promise.all([
        prisma.receivedInvoice.aggregate({
          where: { issueDate: { gte: new Date(q.from), lte: new Date(q.to) } },
          _sum: { taxAmount: true, subtotal: true, totalAmount: true },
          _count: true,
        }),
        prisma.issuedInvoice.aggregate({
          where: { issueDate: { gte: new Date(q.from), lte: new Date(q.to) } },
          _sum: { taxAmount: true, subtotal: true, totalAmount: true },
          _count: true,
        }),
      ]);
      const suportat = parseFloat(ivaSuportat._sum.taxAmount || 0);
      const repercutit = parseFloat(ivaRepercutit._sum.taxAmount || 0);
      ivaData.push({
        ...q,
        factRebudes: ivaSuportat._count,
        baseRebudes: ivaSuportat._sum.subtotal || 0,
        ivaSuportat: suportat,
        totalRebut: ivaSuportat._sum.totalAmount || 0,
        factEmeses: ivaRepercutit._count,
        baseEmeses: ivaRepercutit._sum.subtotal || 0,
        ivaRepercutit: repercutit,
        totalEmes: ivaRepercutit._sum.totalAmount || 0,
        liquidacio: repercutit - suportat,
      });
    }
    contextParts.push(`
IVA TRIMESTRAL ${currentYear} (Model 303):
${ivaData.map((q) => `
${q.q} (${q.from} a ${q.to}):
  Factures emeses: ${q.factEmeses} | Base: ${q.baseEmeses}€ | IVA repercutit: ${q.ivaRepercutit.toFixed(2)}€
  Factures rebudes: ${q.factRebudes} | Base: ${q.baseRebudes}€ | IVA suportat: ${q.ivaSuportat.toFixed(2)}€
  LIQUIDACIÓ IVA: ${q.liquidacio.toFixed(2)}€ ${q.liquidacio > 0 ? '(A INGRESSAR a Hisenda)' : '(A COMPENSAR/RETORNAR)'}`).join('\n')}

RESUM ANUAL:
  Total IVA repercutit: ${ivaData.reduce((s, q) => s + q.ivaRepercutit, 0).toFixed(2)}€
  Total IVA suportat: ${ivaData.reduce((s, q) => s + q.ivaSuportat, 0).toFixed(2)}€
  Liquidació anual: ${ivaData.reduce((s, q) => s + q.liquidacio, 0).toFixed(2)}€`);
  }

  // ============================================
  // EVOLUCIÓ MENSUAL + COMPARATIVES
  // ============================================

  if (wantsMonthly || wantsComparative) {
    const [monthlyExpenses, monthlyIncome] = await Promise.all([
      prisma.$queryRaw`
        SELECT TO_CHAR("issueDate", 'YYYY-MM') as month, COUNT(*)::int as count,
               SUM("totalAmount")::float as total, SUM("taxAmount")::float as iva,
               SUM("subtotal")::float as base
        FROM "received_invoices" WHERE "issueDate" IS NOT NULL
        GROUP BY TO_CHAR("issueDate", 'YYYY-MM') ORDER BY month DESC LIMIT 24
      `,
      prisma.$queryRaw`
        SELECT TO_CHAR("issueDate", 'YYYY-MM') as month, COUNT(*)::int as count,
               SUM("totalAmount")::float as total, SUM("taxAmount")::float as iva,
               SUM("subtotal")::float as base
        FROM "issued_invoices" WHERE "issueDate" IS NOT NULL
        GROUP BY TO_CHAR("issueDate", 'YYYY-MM') ORDER BY month DESC LIMIT 24
      `,
    ]);
    contextParts.push(`
EVOLUCIÓ MENSUAL — DESPESES (factures rebudes, últims 24 mesos):
${monthlyExpenses.map((m) => `- ${m.month}: ${m.count} fact. | Base: ${parseFloat(m.base || 0).toFixed(2)}€ | IVA: ${parseFloat(m.iva || 0).toFixed(2)}€ | Total: ${parseFloat(m.total || 0).toFixed(2)}€`).join('\n')}

EVOLUCIÓ MENSUAL — INGRESSOS (factures emeses, últims 24 mesos):
${monthlyIncome.map((m) => `- ${m.month}: ${m.count} fact. | Base: ${parseFloat(m.base || 0).toFixed(2)}€ | IVA: ${parseFloat(m.iva || 0).toFixed(2)}€ | Total: ${parseFloat(m.total || 0).toFixed(2)}€`).join('\n')}`);
  }

  // DESPESES / INVERSIONS / PGC
  if (wantsExpenses) {
    const expenseBreakdown = await prisma.receivedInvoice.groupBy({
      by: ['accountingType', 'pgcAccount', 'pgcAccountName'],
      where: { accountingType: { not: null } },
      _sum: { totalAmount: true, subtotal: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
    });
    contextParts.push(`
DESGLOSSAMENT DESPESES/INVERSIONS PER COMPTE PGC:
${expenseBreakdown.map((e) => `- [${e.accountingType}] ${e.pgcAccount || '?'} ${e.pgcAccountName || '?'}: ${e._count} factures, base ${e._sum.subtotal}€, total ${e._sum.totalAmount}€`).join('\n')}`);
  }

  // CASH FLOW / LIQUIDITAT
  if (wantsCashFlow) {
    const [totalIncome, totalExpense, bankBalance] = await Promise.all([
      prisma.issuedInvoice.aggregate({ _sum: { totalAmount: true } }),
      prisma.receivedInvoice.aggregate({ _sum: { totalAmount: true } }),
      prisma.bankMovement.findFirst({ orderBy: { date: 'desc' }, select: { balance: true, date: true } }),
    ]);
    const pendingToCollect = await prisma.issuedInvoice.aggregate({
      where: { status: { notIn: ['PAID', 'REJECTED'] } },
      _sum: { totalAmount: true },
      _count: true,
    });
    const pendingToPay = await prisma.receivedInvoice.aggregate({
      where: { status: { notIn: ['PAID', 'REJECTED'] } },
      _sum: { totalAmount: true },
      _count: true,
    });
    contextParts.push(`
CASH FLOW / TRESORERIA:
  Saldo bancari actual: ${bankBalance?.balance || '?'}€ (a ${bankBalance?.date?.toISOString().split('T')[0] || '?'})
  Total facturat (emès): ${totalIncome._sum.totalAmount || 0}€
  Total despesa (rebut): ${totalExpense._sum.totalAmount || 0}€
  Marge brut: ${(parseFloat(totalIncome._sum.totalAmount || 0) - parseFloat(totalExpense._sum.totalAmount || 0)).toFixed(2)}€

  Pendent de cobrar: ${pendingToCollect._count} factures, ${pendingToCollect._sum.totalAmount || 0}€
  Pendent de pagar: ${pendingToPay._count} factures, ${pendingToPay._sum.totalAmount || 0}€
  Posició neta previsió: ${(parseFloat(bankBalance?.balance || 0) + parseFloat(pendingToCollect._sum.totalAmount || 0) - parseFloat(pendingToPay._sum.totalAmount || 0)).toFixed(2)}€`);
  }

  // DUPLICATS
  if (wantsDuplicates) {
    const duplicates = await prisma.receivedInvoice.findMany({
      where: { isDuplicate: true },
      include: { supplier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    contextParts.push(`
FACTURES DUPLICADES (${duplicates.length}):
${duplicates.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | ${inv.description?.substring(0, 80) || ''}`).join('\n')}`);
  }

  // INVENTARI D'EQUIPS
  if (wantsEquipment) {
    const equipment = await prisma.equipment.findMany({
      include: {
        supplier: { select: { name: true } },
        receivedInvoice: { select: { invoiceNumber: true } },
      },
      orderBy: { purchasePrice: 'desc' },
      take: 50,
    });
    const equipStats = await prisma.equipment.aggregate({
      _count: true,
      _sum: { purchasePrice: true },
    });
    contextParts.push(`
INVENTARI D'EQUIPS (${equipStats._count} total, valor: ${equipStats._sum.purchasePrice || 0}€):
${equipment.map((eq) => `- ${eq.name}${eq.brand ? ` (${eq.brand} ${eq.model || ''})` : ''} | S/N: ${eq.serialNumber || '—'} | ${eq.category} | ${eq.purchasePrice ? eq.purchasePrice + '€' : '—'} | ${eq.status} | Prov: ${eq.supplier?.name || '—'} | Fra: ${eq.receivedInvoice?.invoiceNumber || '—'}`).join('\n')}`);
  }

  // ANOMALIES / ALERTES
  if (wantsAnomalies) {
    // Factures amb IVA estrany (no 21%, no 10%, no 4%, no 0%)
    const oddTaxInvoices = await prisma.receivedInvoice.findMany({
      where: { taxRate: { notIn: [0, 4, 10, 21] } },
      include: { supplier: { select: { name: true } } },
      take: 10,
    });
    // Factures amb import 0 o negatiu
    const zeroInvoices = await prisma.receivedInvoice.findMany({
      where: { totalAmount: { lte: 0 } },
      include: { supplier: { select: { name: true } } },
      take: 10,
    });
    // Factures sense proveïdor
    const noSupplier = await prisma.receivedInvoice.count({ where: { supplierId: null } });
    contextParts.push(`
ANOMALIES DETECTADES:
  Factures sense proveïdor assignat: ${noSupplier}
  Factures amb IVA no estàndard (no 0/4/10/21%): ${oddTaxInvoices.length}
${oddTaxInvoices.map((inv) => `    - ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | IVA ${inv.taxRate}% | ${inv.totalAmount}€`).join('\n')}
  Factures amb import ≤ 0: ${zeroInvoices.length}
${zeroInvoices.map((inv) => `    - ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€`).join('\n')}`);
  }

  // RECORDATORIS / VENCIMENTS
  if (wantsReminders) {
    const pendingReminders = await prisma.reminder.findMany({
      where: { isCompleted: false },
      orderBy: { dueAt: 'asc' },
      take: 20,
      include: { author: { select: { name: true } } },
    });
    // Factures que vencen aviat (pròxims 30 dies)
    const soonDue = await prisma.receivedInvoice.findMany({
      where: {
        dueDate: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
        status: { notIn: ['PAID', 'REJECTED'] },
      },
      orderBy: { dueDate: 'asc' },
      take: 15,
      include: { supplier: { select: { name: true } } },
    });
    contextParts.push(`
RECORDATORIS PENDENTS (${pendingReminders.length}):
${pendingReminders.map((r) => `- ${r.dueAt?.toISOString().split('T')[0]} | [${r.priority}] ${r.title} | ${r.description?.substring(0, 60) || ''}`).join('\n')}

FACTURES AMB VENCIMENT PRÒXIMS 30 DIES (${soonDue.length}):
${soonDue.map((inv) => `- ${inv.invoiceNumber} | ${inv.supplier?.name || '?'} | ${inv.totalAmount}€ | Venciment: ${inv.dueDate?.toISOString().split('T')[0]}`).join('\n')}`);
  }

  // ============================================
  // REGLES DE L'AGENT (sempre)
  // ============================================

  const activeRules = await prisma.agentRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: 'desc' }, { category: 'asc' }],
  });

  if (activeRules.length > 0) {
    const rulesByCategory = {};
    activeRules.forEach((r) => {
      if (!rulesByCategory[r.category]) rulesByCategory[r.category] = [];
      rulesByCategory[r.category].push(r);
    });

    let rulesText = '\n\nREGLES CONFIGURADES PER L\'USUARI (SEGUIR SEMPRE):';
    for (const [cat, rules] of Object.entries(rulesByCategory)) {
      rulesText += `\n\n[${cat}]`;
      rules.forEach((r) => {
        rulesText += `\n- ${r.title}: Quan: ${r.condition} → Acció: ${r.action}${r.priority >= 2 ? ' ⚠️ PRIORITAT ALTA' : ''}`;
      });
    }
    contextParts.push(rulesText);

    // Actualitzar comptador d'ús (async, no esperem)
    const ruleIds = activeRules.map((r) => r.id);
    prisma.agentRule.updateMany({
      where: { id: { in: ruleIds } },
      data: { timesApplied: { increment: 1 }, lastAppliedAt: new Date() },
    }).catch(() => {});
  }

  // ============================================
  // CONTEXT PERMANENT (sempre)
  // ============================================

  // Suggeriments pendents
  const pendingSuggestions = await prisma.agentSuggestion.count({ where: { status: 'PENDING' } });
  if (pendingSuggestions > 0) {
    contextParts.push(`\n⚠️ Hi ha ${pendingSuggestions} suggeriments pendents de revisar.`);
  }

  // Factures sense classificar (count)
  const unclassified = await prisma.receivedInvoice.count({
    where: { accountingType: null, status: { notIn: ['REJECTED'] } },
  });
  if (unclassified > 0) {
    contextParts.push(`📋 ${unclassified} factures sense classificar.`);
  }

  const systemWithContext = SYSTEM_PROMPT_CHAT + '\n\n---\n' + contextParts.join('\n');

  // Convertir historial al format Claude
  const claudeMessages = [
    ...chatHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await callLLM(systemWithContext, claudeMessages, { maxTokens: 4096, trackingService: 'accounting_agent_chat' });
  return response;
}

/**
 * Classifica un lot de factures i crea suggeriments
 */
async function batchClassify(invoiceIds) {
  const results = [];

  for (const id of invoiceIds) {
    try {
      const classification = await classifyInvoice(id);

      // Crear suggeriment
      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: id,
          type: 'CLASSIFICATION',
          title: `${classification.accountingType === 'INVESTMENT' ? 'Inversió' : 'Despesa'}: ${classification.pgcAccount} ${classification.pgcAccountName}`,
          description: classification.reasoning,
          suggestedValue: {
            accountingType: classification.accountingType,
            pgcAccount: classification.pgcAccount,
            pgcAccountName: classification.pgcAccountName,
          },
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        },
      });

      results.push({ id, success: true, classification });
    } catch (err) {
      logger.error(`Error classificant factura ${id}: ${err.message}`);
      results.push({ id, success: false, error: err.message });
    }
  }

  return results;
}

/**
 * Aplica un suggeriment acceptat a la factura.
 *
 * Casos:
 *   - CLASSIFICATION / PGC_ACCOUNT sobre factura SENSE journalEntryId →
 *     només actualitza camps de la factura.
 *   - CLASSIFICATION / PGC_ACCOUNT sobre factura JA comptabilitzada (té
 *     journalEntryId) → reclassificació real: anul·la l'assentament actual,
 *     actualitza la factura amb el nou compte, i re-comptabilitza.
 *
 * Per fer la reclassificació necessitem un userId (per registrar audit/reverse).
 * Si no es passa, prova de resoldre un admin del sistema.
 */
async function applySuggestion(suggestionId, { userId, reason } = {}) {
  const suggestion = await prisma.agentSuggestion.findUnique({
    where: { id: suggestionId },
  });

  if (!suggestion) throw new Error('Suggeriment no trobat');
  if (suggestion.status !== 'PENDING') throw new Error('Suggeriment ja resolt');

  const updateData = {};

  if (suggestion.type === 'CLASSIFICATION' || suggestion.type === 'PGC_ACCOUNT') {
    const val = suggestion.suggestedValue || {};
    if (val.accountingType) updateData.accountingType = val.accountingType;
    if (val.pgcAccount) updateData.pgcAccount = val.pgcAccount;
    if (val.pgcAccountName) updateData.pgcAccountName = val.pgcAccountName;
    if (val.accountId) updateData.accountId = val.accountId;
    updateData.classifiedBy = 'AGENT_AUTO';
    updateData.classifiedAt = new Date();
  }

  let reclassified = false;

  if (Object.keys(updateData).length > 0) {
    // Comprovar si la factura ja està comptabilitzada
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: suggestion.receivedInvoiceId },
      select: { id: true, journalEntryId: true, accountId: true },
    });

    const changingAccount = updateData.accountId && invoice?.accountId && updateData.accountId !== invoice.accountId;

    if (invoice?.journalEntryId && changingAccount) {
      // Reclassificació de factura ja comptabilitzada → unpost + update + repost
      const invoicePostingService = require('./invoicePostingService');
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const admin = await prisma.user.findFirst({
          where: { role: 'ADMIN' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        resolvedUserId = admin?.id;
      }
      if (!resolvedUserId) throw new Error('No s\'ha trobat cap usuari ADMIN per registrar la reclassificació');

      await invoicePostingService.unpostInvoice('RECEIVED', invoice.id, {
        userId: resolvedUserId,
        reason: reason || `Reclassificació: aplicació de suggeriment ${suggestionId}`,
      });
      await prisma.receivedInvoice.update({
        where: { id: invoice.id },
        data: updateData,
      });
      await invoicePostingService.postReceivedInvoice(invoice.id, { userId: resolvedUserId });
      reclassified = true;
    } else {
      // Cas simple: només actualitzar la factura
      await prisma.receivedInvoice.update({
        where: { id: suggestion.receivedInvoiceId },
        data: updateData,
      });
    }
  }

  // Marcar suggeriment com acceptat
  await prisma.agentSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: 'ACCEPTED',
      resolvedBy: userId ? 'user' : 'auto',
      resolvedAt: new Date(),
    },
  });

  return { applied: updateData, reclassified };
}

/**
 * classifyForAccount(invoiceId) — wrapper sobre classifyInvoice que també
 * resol el subcompte real (FK a ChartOfAccount), guarda el resultat a la
 * factura i crea un AgentSuggestion (perquè quedi registrat per repassar).
 *
 * Usat per invoicePostingService quan la factura no porta accountId resolt
 * però l'usuari ha clicat "Comptabilitzar" (decisió 1: opció B amb registre).
 *
 * Retorna { accountId, suggestionId } o null si no s'ha pogut resoldre.
 */
async function classifyForAccount(invoiceId) {
  const company = await prisma.company.findFirst();
  if (!company) return null;

  const result = await classifyInvoice(invoiceId);
  if (!result?.pgcAccount) return null;

  // Provar codi exacte i +"000" per resoldre el subcompte real
  const candidates = [String(result.pgcAccount).trim(), String(result.pgcAccount).trim() + '000'];
  let account = null;
  for (const code of candidates) {
    const found = await prisma.chartOfAccount.findUnique({
      where: { companyId_code: { companyId: company.id, code } },
    });
    if (found?.isLeaf) { account = found; break; }
  }
  if (!account) return null;

  // Guardar a la factura (FK + camps legacy per compatibilitat)
  await prisma.receivedInvoice.update({
    where: { id: invoiceId },
    data: {
      accountId: account.id,
      pgcAccount: result.pgcAccount,
      pgcAccountName: result.pgcAccountName,
      accountingType: result.accountingType,
      classifiedBy: 'AGENT_AUTO',
      classifiedAt: new Date(),
    },
  });

  // Registrar suggeriment perquè l'usuari el pugui repassar al supervisor
  const suggestion = await prisma.agentSuggestion.create({
    data: {
      receivedInvoiceId: invoiceId,
      type: 'PGC_ACCOUNT',
      status: 'PENDING',
      title: `Compte assignat per agent: ${account.code} ${account.name}`,
      description: `L'agent ha resolt el subcompte ${account.code} (${account.name}) automàticament al moment de comptabilitzar la factura. Confiança: ${(result.confidence * 100).toFixed(0)}%.`,
      suggestedValue: {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountingType: result.accountingType,
        pgcAccount: result.pgcAccount,
        pgcAccountName: result.pgcAccountName,
      },
      confidence: result.confidence,
      reasoning: result.reasoning,
    },
  });

  return { accountId: account.id, suggestionId: suggestion.id };
}

module.exports = {
  classifyInvoice,
  classifyForAccount,
  analyzeAnomalies,
  chat,
  batchClassify,
  applySuggestion,
  getUnclassifiedInvoices,
  getAccountingSummary,
  callLLMLocalFirst,  // exposat per altres serveis (e.g. aiReviewService)
};
