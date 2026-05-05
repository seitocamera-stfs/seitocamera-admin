/**
 * aiReviewService — passades puntuals amb IA per trobar casos ambigüus que
 * els crons heurístics no detecten:
 *
 *   - aiDuplicatesReview(): factures amb OCR misreads, numeració similar,
 *     o descripció equivalent (que l'SQL "número exacte" passa per alt).
 *
 *   - aiConciliationReview(): proposa matches banc↔factura quan no hi ha
 *     coincidència exacta d'import (parcials, agrupats, comissions banc).
 *
 * Resultats: AgentSuggestion PENDING per revisió humana al Supervisor IA.
 *
 * Cost: usa Qwen3:32b local (Ollama) → €0. Cau a Claude com a fallback si
 * Ollama no respon. Escalable: processa per lots petits per no saturar context.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const accountingAgent = require('./accountingAgentService');
const scopeService = require('./accountingScopeService');

// =============================================================================
// 1) AI Duplicates Review
// =============================================================================

const DUP_SYSTEM_PROMPT = `Ets un auditor comptable que detecta factures duplicades amb criteri experto.

CRITERIS PER MARCAR COM A DUPLICAT:
1. Mateix proveïdor + mateix número exacte → SEGUR duplicat (confidence 1.0)
2. Mateix proveïdor + número MOLT similar (1-2 caràcters de diferència que poden ser OCR misread, ex: "INV-12345" vs "INV-l2345") + import idèntic + dates ≤ 5 dies → ALTA confidence (0.85)
3. Mateix proveïdor + descripció gairebé idèntica + mateix import + dates ≤ 7 dies → MITJANA confidence (0.70)

NO MARCAR COM A DUPLICAT:
- Subscripcions mensuals (Anthropic, Adobe, etc.) amb mateix import però números seqüencials i dates separades > 25 dies
- Factures recurrents per mateixa quota mensual amb números diferents (KINOLUX 26-0029624, 26-0029525, etc.)
- Imports iguals per causalitat (preu fix de servei) sense altres senyals

Per cada parella sospitosa, respon en JSON:
{
  "duplicates": [
    {
      "invoiceNumber1": "número factura A (exacte tal com apareix)",
      "invoiceNumber2": "número factura B (exacte tal com apareix)",
      "confidence": 0.0-1.0,
      "reason": "Explicació breu en català per què sospitem que són duplicats"
    }
  ]
}

Si no trobes parelles sospitoses, respon: { "duplicates": [] }`;

/**
 * Per cada proveïdor amb 2+ factures dins l'scope comptable, demana a la IA
 * que detecti possibles duplicats no captats per SQL exacte.
 */
async function aiDuplicatesReview({ daysBack = 90, maxSuppliers = 30 } = {}) {
  const scopeFrom = await scopeService.getAccountingScopeFrom();
  const since = new Date(Date.now() - daysBack * 86400000);
  const effectiveFrom = scopeFrom && scopeFrom > since ? scopeFrom : since;

  // Proveïdors amb 2+ factures per revisar
  const groups = await prisma.$queryRawUnsafe(`
    SELECT "supplierId", COUNT(*)::int as n
    FROM received_invoices
    WHERE "deletedAt" IS NULL AND "isDuplicate" = false
      AND "supplierId" IS NOT NULL
      AND "issueDate" >= $1
      AND status NOT IN ('REJECTED')
    GROUP BY "supplierId"
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT $2
  `, effectiveFrom, maxSuppliers);

  const stats = { suppliersChecked: 0, totalInvoicesScanned: 0, suggestionsCreated: 0, errors: 0 };

  for (const g of groups) {
    try {
      const invoices = await prisma.receivedInvoice.findMany({
        where: {
          supplierId: g.supplierId,
          deletedAt: null, isDuplicate: false,
          issueDate: { gte: effectiveFrom },
          status: { notIn: ['REJECTED'] },
        },
        select: {
          id: true, invoiceNumber: true, totalAmount: true, issueDate: true,
          description: true, supplier: { select: { name: true } },
        },
        orderBy: { issueDate: 'asc' },
        take: 50,
      });
      if (invoices.length < 2) continue;
      stats.suppliersChecked++;
      stats.totalInvoicesScanned += invoices.length;

      const supplier = invoices[0].supplier?.name || '?';
      const invoicesText = invoices.map((inv) =>
        `- Nº ${inv.invoiceNumber} | ${Number(inv.totalAmount).toFixed(2)}€ | ${inv.issueDate?.toISOString().slice(0, 10)} | ${(inv.description || '').slice(0, 80)}`
      ).join('\n');

      const userMessage = `Proveïdor: ${supplier}\n\nFactures a revisar:\n${invoicesText}`;

      let response;
      try {
        response = await accountingAgent.callLLMLocalFirst(DUP_SYSTEM_PROMPT, [
          { role: 'user', content: userMessage },
        ], { trackingService: 'ai_duplicates_review', maxTokens: 2048, temperature: 0, validateJson: true });
      } catch (err) {
        logger.warn(`aiDuplicatesReview: LLM falla per supplier ${g.supplierId}: ${err.message}`);
        stats.errors++;
        continue;
      }

      // Parse + crear suggeriments
      const m = response.match(/\{[\s\S]*\}/);
      if (!m) continue;
      let parsed;
      try { parsed = JSON.parse(m[0]); } catch { continue; }
      const dups = parsed.duplicates || [];

      const byNumber = new Map(invoices.map((i) => [i.invoiceNumber, i]));
      for (const d of dups) {
        const a = byNumber.get(d.invoiceNumber1);
        const b = byNumber.get(d.invoiceNumber2);
        if (!a || !b || a.id === b.id) continue;
        const [first, second] = a.id < b.id ? [a, b] : [b, a];

        // Dedup: si ja existeix un suggeriment PENDING per aquesta parella, salta
        const existing = await prisma.agentSuggestion.findFirst({
          where: {
            receivedInvoiceId: second.id,
            type: 'DUPLICATE',
            status: 'PENDING',
            suggestedValue: { path: ['duplicateOfId'], equals: first.id },
          },
        });
        if (existing) continue;

        await prisma.agentSuggestion.create({
          data: {
            receivedInvoiceId: second.id,
            type: 'DUPLICATE',
            title: `IA: possible duplicat ${first.invoiceNumber} ↔ ${second.invoiceNumber} (${supplier})`,
            description: d.reason || `IA detecta similitud entre ${first.invoiceNumber} i ${second.invoiceNumber}.`,
            confidence: Math.min(Math.max(d.confidence || 0.5, 0), 1),
            reasoning: `aiDuplicatesReview: ${d.reason || 'Sense raonament'}`,
            suggestedValue: { duplicateOfId: first.id, source: 'AI_REVIEW', reason: d.reason },
          },
        });
        stats.suggestionsCreated++;
      }
    } catch (err) {
      logger.error(`aiDuplicatesReview: error supplier ${g.supplierId}: ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

// =============================================================================
// 2) AI Conciliation Review
// =============================================================================

const CONC_SYSTEM_PROMPT = `Ets un auditor que proposa matches banc↔factura per casos no captats per matching exacte d'import.

CRITERIS:
- Considera mov bancari pot pagar UNA factura sencera, MULTIPLES factures (suma d'imports), o PARCIALMENT una factura
- Considera comissions bancàries (mov pot ser factura - comissió)
- Considera diferències de pocs cèntims (arrodoniments)
- El proveïdor del mov bancari (counterparty) ha de coincidir amb supplier de la factura
- La data del moviment ha de ser POSTERIOR o IGUAL a la de la factura (es paga després d'emetre)

Per cada match proposat, respon en JSON:
{
  "matches": [
    {
      "movementId": "id del mov bancari",
      "invoiceNumber": "número de la factura proposada",
      "appliedAmount": 123.45,
      "confidence": 0.0-1.0,
      "reason": "Explicació breu en català"
    }
  ]
}

Si no trobes matches plausibles, respon: { "matches": [] }`;

/**
 * Carrega moviments bancaris no conciliats + factures no conciliades dins
 * scope, agrupa per finestres temporals, demana a la IA matches.
 */
async function aiConciliationReview({ daysBack = 60, maxBatches = 5 } = {}) {
  const scopeFrom = await scopeService.getAccountingScopeFrom();
  const since = new Date(Date.now() - daysBack * 86400000);
  const effectiveFrom = scopeFrom && scopeFrom > since ? scopeFrom : since;

  // Moviments no conciliats (només despeses per simplicitat — pagaments)
  const movements = await prisma.bankMovement.findMany({
    where: {
      isConciliated: false,
      isDismissed: false,
      type: 'EXPENSE',
      date: { gte: effectiveFrom },
    },
    select: { id: true, date: true, amount: true, description: true, counterparty: true },
    orderBy: { date: 'desc' },
    take: 100,
  });

  // Factures rebudes no pagades dins scope
  const invoices = await prisma.receivedInvoice.findMany({
    where: {
      deletedAt: null, isDuplicate: false,
      issueDate: { gte: effectiveFrom },
      origin: { not: 'LOGISTIK' },
      status: { notIn: ['PAID', 'REJECTED'] },
    },
    select: {
      id: true, invoiceNumber: true, totalAmount: true, issueDate: true, paidAmount: true,
      supplier: { select: { name: true } },
    },
    orderBy: { issueDate: 'desc' },
    take: 200,
  });
  // Filtrar només factures amb saldo pendent
  const unpaidInvoices = invoices.filter((i) => Number(i.totalAmount) > Number(i.paidAmount || 0));

  if (movements.length === 0 || unpaidInvoices.length === 0) {
    return { matchesProposed: 0, suggestionsCreated: 0, batchesProcessed: 0 };
  }

  // Dividim en lots: per cada bloc de 20 moviments + factures de proveïdors involucrats
  const batchSize = 20;
  const stats = { batchesProcessed: 0, matchesProposed: 0, suggestionsCreated: 0, errors: 0 };

  for (let i = 0; i < Math.min(movements.length, batchSize * maxBatches); i += batchSize) {
    const movBatch = movements.slice(i, i + batchSize);
    const movText = movBatch.map((m) =>
      `- ID ${m.id} | ${m.date.toISOString().slice(0, 10)} | ${Math.abs(Number(m.amount)).toFixed(2)}€ | counterparty="${m.counterparty || '?'}" | desc="${(m.description || '').slice(0, 60)}"`
    ).join('\n');

    // Factures candidatesi (només els proveïdors amb noms similars als counterparties)
    const counterpartyNames = movBatch.map((m) => (m.counterparty || '').toLowerCase()).filter(Boolean);
    const candidateInvoices = unpaidInvoices.filter((inv) => {
      const supName = (inv.supplier?.name || '').toLowerCase();
      return counterpartyNames.some((cp) => supName.includes(cp.slice(0, 4)) || cp.includes(supName.slice(0, 4)));
    }).slice(0, 50);
    if (candidateInvoices.length === 0) continue;

    const invText = candidateInvoices.map((inv) =>
      `- Nº ${inv.invoiceNumber} | ${Number(inv.totalAmount).toFixed(2)}€ (pendent ${(Number(inv.totalAmount) - Number(inv.paidAmount || 0)).toFixed(2)}€) | ${inv.issueDate?.toISOString().slice(0, 10)} | proveïdor="${inv.supplier?.name || '?'}"`
    ).join('\n');

    const userMessage = `MOVIMENTS BANCARIS NO CONCILIATS:\n${movText}\n\nFACTURES PENDENTS DE PAGAR (mateix grup de proveïdors):\n${invText}\n\nProposa matches plausibles.`;

    let response;
    try {
      response = await accountingAgent.callLLMLocalFirst(CONC_SYSTEM_PROMPT, [
        { role: 'user', content: userMessage },
      ], { trackingService: 'ai_conciliation_review', maxTokens: 3072, temperature: 0, validateJson: true });
      stats.batchesProcessed++;
    } catch (err) {
      logger.warn(`aiConciliationReview: LLM falla a batch ${i}: ${err.message}`);
      stats.errors++;
      continue;
    }

    const m = response.match(/\{[\s\S]*\}/);
    if (!m) continue;
    let parsed;
    try { parsed = JSON.parse(m[0]); } catch { continue; }
    const matches = parsed.matches || [];

    const movById = new Map(movBatch.map((mv) => [mv.id, mv]));
    const invByNumber = new Map(candidateInvoices.map((inv) => [inv.invoiceNumber, inv]));

    for (const match of matches) {
      stats.matchesProposed++;
      const mov = movById.get(match.movementId);
      const inv = invByNumber.get(match.invoiceNumber);
      if (!mov || !inv) continue;

      // Dedup
      const existing = await prisma.agentSuggestion.findFirst({
        where: {
          receivedInvoiceId: inv.id,
          type: 'CONCILIATION_MATCH',
          status: 'PENDING',
          suggestedValue: { path: ['movementId'], equals: mov.id },
        },
      });
      if (existing) continue;

      await prisma.agentSuggestion.create({
        data: {
          receivedInvoiceId: inv.id,
          type: 'CONCILIATION_MATCH',
          title: `IA: conciliar ${inv.invoiceNumber} amb mov ${mov.date.toISOString().slice(0, 10)} (${Math.abs(Number(mov.amount)).toFixed(2)}€)`,
          description: match.reason || `Match proposat: ${inv.invoiceNumber} ↔ moviment ${mov.id.slice(0, 8)}…`,
          confidence: Math.min(Math.max(match.confidence || 0.5, 0), 1),
          reasoning: `aiConciliationReview: ${match.reason || 'Sense raonament'}`,
          suggestedValue: {
            movementId: mov.id,
            invoiceId: inv.id,
            appliedAmount: Number(match.appliedAmount) || Number(mov.amount),
            source: 'AI_REVIEW',
          },
        },
      });
      stats.suggestionsCreated++;
    }
  }

  return stats;
}

module.exports = { aiDuplicatesReview, aiConciliationReview };
