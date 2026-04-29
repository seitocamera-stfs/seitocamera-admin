import { useState, useEffect } from 'react';
import { Zap, Check, X as XIcon, Search, FileText, Eye, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, Brain, Loader2, Undo2, Ban, RotateCcw, EyeOff, RefreshCw } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { StatusBadge } from '../components/shared/StatusBadge';
import { formatCurrency, formatDate } from '../lib/utils';
import ExportButtons from '../components/shared/ExportButtons';
import IssuedInvoiceDetailModal from '../components/shared/IssuedInvoiceDetailModal';
import api from '../lib/api';

// ===========================================
// Pàgina de Conciliació estil Xero
// Layout: Moviments bancaris (esquerra) ↔ Factures candidates (dreta)
// ===========================================

export default function Conciliation() {
  const [tab, setTab] = useState('pending'); // pending, matched, confirmed
  const [page, setPage] = useState(1);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [searchingCandidates, setSearchingCandidates] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [searchType, setSearchType] = useState('auto');
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [selectedCandidates, setSelectedCandidates] = useState([]); // IDs seleccionats per multi-match
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [selectedForAI, setSelectedForAI] = useState([]); // Moviments seleccionats per IA
  const [aiSelectMode, setAiSelectMode] = useState(false);
  const [movementSearch, setMovementSearch] = useState('');
  const [conciliationSearch, setConciliationSearch] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissingId, setDismissingId] = useState(null);
  const [dismissReason, setDismissReason] = useState('');
  const { mutate, loading: mutating } = useApiMutation();

  const isPending = tab === 'pending';

  // Carregar detalls complets d'una factura emesa (per popup)
  const handleViewIssuedDetails = async (id) => {
    try {
      const { data } = await api.get(`/invoices/issued/${id}`);
      setDetailInvoice(data);
    } catch (err) {
      alert('Error carregant detalls: ' + err.message);
    }
  };

  // Dades segons la pestanya
  const pendingQuery = useApiGet('/bank', { conciliated: 'false', page, limit: 15, ...(movementSearch.trim() ? { search: movementSearch.trim() } : {}) });
  const matchedQuery = useApiGet('/conciliation', { status: tab === 'confirmed' ? 'CONFIRMED' : 'AUTO_MATCHED', page, limit: 15, ...(conciliationSearch.trim() && !isPending ? { search: conciliationSearch.trim() } : {}) });
  const dismissedQuery = useApiGet('/bank/dismissed/list', { page: showDismissed ? page : 1, limit: 15 });
  const activeQuery = isPending ? pendingQuery : tab === 'dismissed' ? dismissedQuery : matchedQuery;
  const movements = isPending ? (activeQuery.data?.data || []) : [];
  const conciliations = !isPending ? (activeQuery.data?.data || []) : [];

  // Stats
  const statsQuery = useApiGet('/bank/stats/summary');
  const concCount = useApiGet('/conciliation', { limit: 1 });

  // Quan seleccionem un moviment, buscar candidats automàticament
  useEffect(() => {
    setSelectedCandidates([]);
    if (selectedMovement && isPending) {
      findCandidates(selectedMovement);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMovement, isPending]);

  const findCandidates = async (movement) => {
    setSearchingCandidates(true);
    setCandidates([]);
    const absAmount = Math.abs(parseFloat(movement.amount));
    const isExpense = parseFloat(movement.amount) < 0;
    const rawText = movement.counterparty || movement.description || '';
    const endpoint = isExpense ? '/invoices/received' : '/invoices/issued';

    // Extreure paraules significatives del contrapart per comparar amb noms de proveïdor
    const stopWords = ['s.c.a', 'sca', 'bv', 'nv', 'sa', 'sl', 'slu', 'slne', 'europe', 'international',
      'payments', 'mktp', 'amzn', 'sucursal', 'espana', 'españa', 'domiciliacions', 'targetes',
      'transferencia', 'transfer', 'the', 'and', 'for', 'ltd', 'gmbh', 'inc', 'limited'];
    const words = rawText
      .split(/[\s,.\-/]+/)
      .map(w => w.replace(/[^a-zA-ZÀ-ÿ0-9]/g, ''))
      .filter(w => w.length > 2 && !/^\d+$/.test(w) && !stopWords.includes(w.toLowerCase()));

    // Normalitzar nom: treure sufixos legals (SL, SA, SLU, SCP, SARL, GMBH, LTD, etc.)
    const normalizeName = (name) => {
      if (!name) return '';
      return name.toLowerCase()
        .replace(/\b(s\.?l\.?u?\.?|s\.?a\.?|s\.?c\.?p\.?|s\.?c\.?a\.?|s\.?a\.?r\.?l\.?|gmbh|ltd\.?|inc\.?|limited|b\.?v\.?|n\.?v\.?|plc|co\.?)\b/gi, '')
        .replace(/[,.\-\/()]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Funció per comprovar si el nom de proveïdor coincideix amb el contrapart del moviment
    const matchesSupplier = (supplierName) => {
      if (!supplierName || !rawText) return false;
      const sNorm = normalizeName(supplierName);
      const rNorm = normalizeName(rawText);
      // Coincidència directa (amb noms normalitzats)
      if (rNorm.includes(sNorm) || sNorm.includes(rNorm)) return true;
      // Coincidència per paraules: almenys 1 paraula significativa del proveïdor apareix al moviment
      const supplierWords = sNorm.split(/\s+/).filter(w => w.length > 2);
      return supplierWords.some(w => rNorm.includes(w));
    };

    // Referència del moviment bancari (pot contenir número de factura)
    const reference = movement.reference || '';
    const description = movement.description || '';
    // Extreure possibles números de factura de la referència i descripció
    const refTokens = `${reference} ${description}`
      .split(/[\s,.\-/]+/)
      .filter(t => t.length > 3 && /[0-9]/.test(t));

    // Funció per comprovar si la referència del moviment conté el número de factura
    const matchesReference = (invoiceNumber) => {
      if (!invoiceNumber) return false;
      const invNum = invoiceNumber.toLowerCase().replace(/[\s\-/]/g, '');
      const fullText = `${reference} ${description}`.toLowerCase();
      const fullTextClean = fullText.replace(/[\s\-/]/g, '');
      // 1. Coincidència directa (netejant separadors)
      if (fullTextClean.includes(invNum)) return true;
      // 2. Regex per patrons típics de factura dins el text bancari
      const invoicePatterns = [
        /\b[A-Z]{1,4}[\-\/]?\d{2,4}[\-\/]\d{3,6}\b/gi,   // F2024-0001, INV-9928, FRA/24/089
        /\b#\d{4,}\b/g,                                     // #4521, #12345
        /\bFACT?\.?\s*\d{3,}\b/gi,                          // FACT 1234, FAC.567
        /\b\d{4,}[\-\/]\d{2,}\b/g,                          // 2024-0156, 2024/089
      ];
      for (const pattern of invoicePatterns) {
        const matches = fullText.match(pattern) || [];
        for (const m of matches) {
          const mClean = m.toLowerCase().replace(/[\s\-/#.]/g, '');
          if (mClean.includes(invNum) || invNum.includes(mClean)) return true;
        }
      }
      // 3. Token matching (fallback)
      return refTokens.some(t => {
        const tLower = t.toLowerCase();
        return tLower.includes(invNum) || invNum.includes(tLower);
      });
    };

    // Finestra temporal: ±15 dies respecte la data del moviment
    const movDate = movement.valueDate || movement.date;
    let dateFrom, dateTo;
    if (movDate) {
      const d = new Date(movDate);
      const from = new Date(d); from.setDate(from.getDate() - 15);
      const to = new Date(d); to.setDate(to.getDate() + 15);
      dateFrom = from.toISOString().split('T')[0];
      dateTo = to.toISOString().split('T')[0];
    }

    // Consultes prèvies en paral·lel: memòria contraparts + comissions + recurrència
    let knownSupplierIds = new Set();
    let knownClientIds = new Set();
    let commissionRules = [];
    let recurringPattern = null;

    const preQueries = [];

    if (rawText.trim().length >= 3) {
      preQueries.push(
        api.get('/conciliation/counterparty-suggestions', { params: { counterparty: rawText.trim() } })
          .then(({ data }) => {
            (data.suppliers || []).forEach(s => knownSupplierIds.add(s.id));
            (data.clients || []).forEach(c => knownClientIds.add(c.id));
          }).catch(() => {})
      );
      preQueries.push(
        api.get('/conciliation/recurring-patterns', { params: { counterparty: rawText.trim() } })
          .then(({ data }) => {
            // Buscar si hi ha un patró recurrent amb import similar al moviment
            const match = (data.patterns || []).find(p =>
              Math.abs(p.amount - absAmount) / absAmount < 0.02
            );
            if (match) recurringPattern = match;
          }).catch(() => {})
      );
    }

    preQueries.push(
      api.get('/conciliation/commission-rules')
        .then(({ data }) => { commissionRules = data || []; })
        .catch(() => {})
    );

    await Promise.all(preQueries);

    try {
      const allResults = new Map();
      const addResult = (inv, type) => {
        if (allResults.has(inv.id)) return;
        allResults.set(inv.id, { ...inv, _type: type });
      };

      const baseParams = { conciliated: 'false' };
      if (dateFrom) baseParams.dateFrom = dateFrom;
      if (dateTo) baseParams.dateTo = dateTo;

      const searches = [];

      // Cerca 1: per import (dins finestra temporal)
      if (absAmount > 0) {
        searches.push(
          api.get(endpoint, { params: { ...baseParams, search: absAmount.toFixed(2), limit: 30 } })
            .then(({ data }) => (data.data || []).forEach(inv => addResult(inv, isExpense ? 'received' : 'issued')))
            .catch(() => {})
        );
      }

      // Cerca 2: per nom del contrapart (dins finestra temporal)
      for (const word of words.slice(0, 2)) {
        searches.push(
          api.get(endpoint, { params: { ...baseParams, search: word, limit: 20 } })
            .then(({ data }) => (data.data || []).forEach(inv => addResult(inv, isExpense ? 'received' : 'issued')))
            .catch(() => {})
        );
      }

      // Cerca 3: per referència (sense filtre temporal — la ref és prou forta per si sola)
      for (const token of refTokens.slice(0, 2)) {
        searches.push(
          api.get(endpoint, { params: { search: token, conciliated: 'false', limit: 10 } })
            .then(({ data }) => (data.data || []).forEach(inv => addResult(inv, isExpense ? 'received' : 'issued')))
            .catch(() => {})
        );
      }

      await Promise.all(searches);

      // Classificar cada resultat
      let results = Array.from(allResults.values());
      for (const inv of results) {
        const invAmount = parseFloat(inv.totalAmount);
        const amountDiff = Math.abs(invAmount - absAmount);
        const amountMatch = amountDiff < 0.03;
        // Tolerància dinàmica: <1% de l'import O <3€ (el més generós)
        const tolerancePercent = absAmount * 0.01;
        const toleranceMax = 3;
        const amountClose = amountDiff <= Math.max(tolerancePercent, toleranceMax);
        const supplierName = isExpense ? inv.supplier?.name : inv.client?.name;
        const nameMatch = matchesSupplier(supplierName);
        const refMatch = matchesReference(inv.invoiceNumber);
        // Memòria de contraparts: aquest proveïdor/client ja s'ha conciliat amb aquest contrapart abans?
        const entityId = isExpense ? inv.supplier?.id : inv.client?.id;
        const counterpartyMatch = entityId && (knownSupplierIds.has(entityId) || knownClientIds.has(entityId));

        // Detecció de comissions: import_moviment = import_factura - comissió?
        let commissionMatch = null;
        if (invAmount > absAmount && commissionRules.length > 0) {
          for (const rule of commissionRules) {
            const pct = parseFloat(rule.percentage) / 100;
            const fix = parseFloat(rule.fixedFee);
            const expectedNet = invAmount - (invAmount * pct + fix);
            if (Math.abs(expectedNet - absAmount) < 0.05) {
              commissionMatch = { rule: rule.name, commission: invAmount - absAmount };
              break;
            }
          }
        }

        // Score basat en regles clares:
        let score = 0;
        const reasons = [];

        // La memòria de contraparts reforça el nameMatch
        const entityMatch = nameMatch || counterpartyMatch;
        const entityLabel = counterpartyMatch && !nameMatch ? 'Historial conciliació' : 'Proveïdor';

        if (refMatch && amountMatch) {
          score = 120;
          reasons.push('Referència + import exacte');
        } else if (refMatch && entityMatch) {
          score = 110;
          reasons.push(`Referència + ${entityLabel}`);
        } else if (refMatch && amountClose) {
          score = 95;
          reasons.push('Referència + import proper');
        } else if (refMatch) {
          score = 80;
          reasons.push('Referència bancària coincident');
        } else if (commissionMatch && entityMatch) {
          score = 98;
          reasons.push(`${entityLabel} + comissió ${commissionMatch.rule} (${commissionMatch.commission.toFixed(2)}€)`);
        } else if (commissionMatch) {
          score = 55;
          reasons.push(`Possible comissió ${commissionMatch.rule} (${commissionMatch.commission.toFixed(2)}€)`);
        } else if (amountMatch && entityMatch) {
          score = 100;
          reasons.push(`Import exacte + ${entityLabel}`);
        } else if (counterpartyMatch && amountClose) {
          score = 60;
          reasons.push('Historial conciliació + import proper');
        } else if (amountMatch) {
          score = 50;
          reasons.push('Import exacte');
        } else if (amountClose && entityMatch) {
          score = 45;
          reasons.push(`Import proper + ${entityLabel}`);
        } else if (entityMatch && amountDiff / absAmount < 0.2) {
          score = 30;
          reasons.push(`${entityLabel} + import similar`);
        } else if (entityMatch) {
          score = 10;
          reasons.push(counterpartyMatch ? 'Historial conciliació previ' : 'Mateix proveïdor');
        } else {
          score = 0;
        }

        // Bonus recurrència: si el moviment encaixa amb un patró recurrent detectat
        if (recurringPattern && entityMatch && score > 0) {
          score += 10;
          reasons.push(`Pagament recurrent (dia ~${recurringPattern.avgDayOfMonth} cada mes)`);
        }

        inv._score = score;
        inv._matchReasons = reasons;
        inv._commissionMatch = commissionMatch;
      }

      // Filtrar: no mostrar resultats amb score 0
      results = results.filter(inv => inv._score > 0);

      // ======================================
      // SUBSET-SUM: Buscar combinacions de factures del mateix proveïdor que sumin l'import
      // ======================================
      const combos = [];
      // Agrupar factures per proveïdor/client (només les que no fan match exacte per si soles)
      const byEntity = {};
      for (const inv of results) {
        const eid = isExpense ? inv.supplier?.id : inv.client?.id;
        if (!eid) continue;
        const invAmt = parseFloat(inv.remainingAmount ?? inv.totalAmount);
        if (invAmt >= absAmount - 0.03) continue; // Si ja cobreix sola, no cal combinar
        if (!byEntity[eid]) byEntity[eid] = [];
        byEntity[eid].push(inv);
      }

      // Per cada proveïdor, buscar combinacions (max 6 factures, max 100 iteracions)
      for (const [eid, invoices] of Object.entries(byEntity)) {
        if (invoices.length < 2) continue;
        const sorted = invoices.slice(0, 8).sort((a, b) =>
          parseFloat(b.remainingAmount ?? b.totalAmount) - parseFloat(a.remainingAmount ?? a.totalAmount)
        );

        // Algorisme de backtracking limitat
        const findCombos = (idx, remaining, current, iterations) => {
          if (iterations.count > 100) return;
          if (Math.abs(remaining) < 0.03) {
            if (current.length >= 2) combos.push([...current]);
            return;
          }
          if (remaining < -0.03 || idx >= sorted.length || current.length >= 6) return;
          for (let i = idx; i < sorted.length; i++) {
            iterations.count++;
            if (iterations.count > 100) return;
            const amt = parseFloat(sorted[i].remainingAmount ?? sorted[i].totalAmount);
            if (amt > remaining + 0.03) continue;
            current.push(sorted[i]);
            findCombos(i + 1, remaining - amt, current, iterations);
            current.pop();
          }
        };
        findCombos(0, absAmount, [], { count: 0 });
      }

      // Afegir suggeriments de combinació com a entrada especial al principi
      const comboSuggestions = combos.slice(0, 3).map((combo, i) => {
        const total = combo.reduce((s, inv) => s + parseFloat(inv.remainingAmount ?? inv.totalAmount), 0);
        const entityName = isExpense ? combo[0].supplier?.name : combo[0].client?.name;
        return {
          id: `combo-${i}`,
          _isCombo: true,
          _comboInvoices: combo,
          _comboTotal: total,
          _score: 105,
          _matchReasons: [`${combo.length} factures de ${entityName || '?'} sumen ${total.toFixed(2)}€`],
          _type: isExpense ? 'received' : 'issued',
          invoiceNumber: `${combo.length} factures combinades`,
          totalAmount: total,
          supplier: combo[0].supplier,
          client: combo[0].client,
          issueDate: combo[0].issueDate,
        };
      });

      // Ordenar: score descendent, desempat per diferència d'import
      results.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return Math.abs(parseFloat(a.totalAmount) - absAmount) - Math.abs(parseFloat(b.totalAmount) - absAmount);
      });

      // Inserir combos al principi (després dels 120-110 però abans de la resta)
      const finalResults = [...comboSuggestions, ...results];

      // Re-ordenar tot per score
      finalResults.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return Math.abs(parseFloat(a.totalAmount) - absAmount) - Math.abs(parseFloat(b.totalAmount) - absAmount);
      });

      setCandidates(finalResults);
    } catch (err) {
      console.error(err);
    }
    setSearchingCandidates(false);
  };

  // Cerca manual de factures
  const handleManualSearch = async () => {
    if (!manualSearch.trim() || !selectedMovement) return;
    setSearchingCandidates(true);
    try {
      const isExpense = parseFloat(selectedMovement.amount) < 0;
      const type = searchType === 'auto' ? (isExpense ? 'received' : 'issued') : searchType;
      const endpoint = type === 'received' ? '/invoices/received' : '/invoices/issued';
      const { data } = await api.get(endpoint, { params: { search: manualSearch, limit: 30 } });
      setCandidates((data.data || []).map(inv => ({ ...inv, _type: type })));
    } catch (err) {
      console.error(err);
    }
    setSearchingCandidates(false);
  };

  // Toggle selecció d'una factura candidata (per multi-match)
  const toggleCandidate = (inv) => {
    setSelectedCandidates((prev) => {
      const exists = prev.find((s) => s.id === inv.id);
      if (exists) return prev.filter((s) => s.id !== inv.id);
      return [...prev, { id: inv.id, type: inv._type, totalAmount: parseFloat(inv.totalAmount) }];
    });
  };

  // Suma de les factures seleccionades
  const selectedTotal = selectedCandidates.reduce((sum, s) => sum + s.totalAmount, 0);

  // Conciliar 1 factura directament (clic "OK")
  const handleMatch = async (movement, invoice) => {
    try {
      await mutate('post', '/conciliation/manual', {
        bankMovementId: movement.id,
        receivedInvoiceId: invoice._type === 'received' ? invoice.id : null,
        issuedInvoiceId: invoice._type === 'issued' ? invoice.id : null,
      });
      setSelectedMovement(null);
      setCandidates([]);
      setSelectedCandidates([]);
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error conciliant');
    }
  };

  // Conciliar múltiples factures amb 1 moviment
  const handleMultiMatch = async () => {
    if (!selectedMovement || selectedCandidates.length === 0) return;
    try {
      await mutate('post', '/conciliation/multi', {
        bankMovementId: selectedMovement.id,
        invoices: selectedCandidates.map((s) => ({ id: s.id, type: s.type })),
      });
      setSelectedMovement(null);
      setCandidates([]);
      setSelectedCandidates([]);
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error conciliant múltiples factures');
    }
  };

  // Auto-conciliar tots
  const handleAutoMatch = async () => {
    try {
      const result = await mutate('post', '/conciliation/auto');
      const parts = [
        `Processats: ${result.processed}`,
        `Conciliats: ${result.matched} (${result.autoConfirmed} auto-confirmats, ${result.pendingReview} per revisar)`,
        `Sense match: ${result.unmatched}`,
      ];
      if (result.dismissedTransfers > 0) parts.push(`Transferències internes descartades: ${result.dismissedTransfers}`);
      alert(parts.join('\n'));
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  // Toggle mode selecció per IA
  const toggleAISelectMode = () => {
    if (aiSelectMode) {
      setAiSelectMode(false);
      setSelectedForAI([]);
    } else {
      setAiSelectMode(true);
      setSelectedForAI([]);
      setSelectedMovement(null);
    }
  };

  // Toggle selecció d'un moviment per IA
  const toggleMovementForAI = (id) => {
    setSelectedForAI(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Seleccionar/deseleccionar tots els moviments visibles
  const toggleAllForAI = () => {
    if (selectedForAI.length === movements.length) {
      setSelectedForAI([]);
    } else {
      setSelectedForAI(movements.map(m => m.id));
    }
  };

  // Conciliar amb IA (Claude)
  const handleAIMatch = async () => {
    if (selectedForAI.length === 0) {
      setAiResult({ error: 'Selecciona almenys un moviment per conciliar amb IA' });
      return;
    }
    setAiRunning(true);
    setAiResult(null);
    try {
      const result = await mutate('post', '/conciliation/ai-auto', {
        movementIds: selectedForAI,
      });
      setAiResult(result);
      setAiSelectMode(false);
      setSelectedForAI([]);
      pendingQuery.refetch();
      matchedQuery.refetch();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setAiResult({ error: msg });
    }
    setAiRunning(false);
  };

  // Desfer conciliació confirmada
  const handleUndo = async (id) => {
    if (!confirm('Segur que vols desfer aquesta conciliació? El moviment i la factura tornaran a pendents.')) return;
    try {
      await mutate('patch', `/conciliation/${id}/undo`);
      matchedQuery.refetch();
      pendingQuery.refetch();
      statsQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Error desfent la conciliació');
    }
  };

  // Descartar moviment bancari
  const handleDismiss = async (movementId) => {
    try {
      await mutate('patch', `/bank/${movementId}/dismiss`, {
        reason: dismissReason.trim() || null,
      });
      setDismissingId(null);
      setDismissReason('');
      setSelectedMovement(null);
      setCandidates([]);
      pendingQuery.refetch();
      dismissedQuery.refetch();
      statsQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Error descartant moviment');
    }
  };

  // Recuperar moviment descartat
  const handleUndismiss = async (movementId) => {
    try {
      await mutate('patch', `/bank/${movementId}/undismiss`);
      pendingQuery.refetch();
      dismissedQuery.refetch();
      statsQuery.refetch();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Error recuperant moviment');
    }
  };

  // Confirmar conciliació
  const handleConfirm = async (id) => {
    await mutate('patch', `/conciliation/${id}/confirm`);
    matchedQuery.refetch();
  };

  // Rebutjar conciliació (esborrar vincle) → tornar a "Per conciliar" amb el moviment seleccionat
  const handleReject = async (id, bankMovement) => {
    await mutate('patch', `/conciliation/${id}/reject`);
    matchedQuery.refetch();
    pendingQuery.refetch();
    // Canviar a la pestanya "Per conciliar" i seleccionar el moviment per buscar nous candidats
    if (bankMovement) {
      setTab('pending');
      setPage(1);
      setSelectedMovement(bankMovement);
    }
  };

  // Veure PDF
  const handleViewPdf = async (invoice) => {
    try {
      const response = await api.get(`/invoices/received/${invoice.id}/pdf`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {}
  };

  const pagination = activeQuery.data?.pagination;

  return (
    <div className="p-6">
      {/* Capçalera */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Conciliació bancària</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {statsQuery.data?.unconciliated || 0} moviments pendents de conciliar
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButtons
            endpoint="/export/conciliations"
            filters={{}}
            filenameBase="conciliacions"
          />
          <button onClick={handleAutoMatch} disabled={mutating || aiRunning} className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            <Zap size={16} /> {mutating ? 'Processant...' : 'Auto-conciliar'}
          </button>
          {!aiSelectMode ? (
            <button onClick={toggleAISelectMode} disabled={mutating || aiRunning || !isPending} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
              <Brain size={16} /> Conciliar amb IA
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-violet-700 font-medium">
                {selectedForAI.length} seleccionats
              </span>
              <button onClick={handleAIMatch} disabled={mutating || aiRunning || selectedForAI.length === 0} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                {aiRunning ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
                {aiRunning ? 'IA analitzant...' : `Enviar ${selectedForAI.length} a IA`}
              </button>
              <button onClick={toggleAISelectMode} className="px-3 py-2 rounded-md border text-sm font-medium hover:bg-muted">
                Cancel·lar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Resultat IA */}
      {aiResult && (
        <div className={`mb-4 p-4 rounded-lg border ${aiResult.error ? 'bg-red-50 border-red-200' : 'bg-violet-50 border-violet-200'}`}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {aiResult.error ? (
                <div className="text-red-700 text-sm font-medium">{aiResult.error}</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Brain size={18} className="text-violet-600" />
                    <span className="font-semibold text-violet-800">Resultat IA</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm mb-2">
                    <div>
                      <span className="text-muted-foreground">Processats:</span>{' '}
                      <span className="font-medium">{aiResult.processed}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Conciliats:</span>{' '}
                      <span className="font-medium text-green-700">{aiResult.matched}</span>
                      {aiResult.autoConfirmed > 0 && (
                        <span className="text-xs text-green-600 ml-1">({aiResult.autoConfirmed} auto-confirmats)</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Per revisar:</span>{' '}
                      <span className="font-medium text-amber-700">{aiResult.pendingReview}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sense match:</span>{' '}
                      <span className="font-medium text-gray-600">{aiResult.unmatched}</span>
                    </div>
                  </div>
                  {aiResult.summary && (
                    <p className="text-sm text-violet-700 italic">{aiResult.summary}</p>
                  )}
                  {aiResult.tokens && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Tokens: {aiResult.tokens.input_tokens?.toLocaleString()} entrada + {aiResult.tokens.output_tokens?.toLocaleString()} sortida
                    </p>
                  )}
                  {aiResult.noMatchReasons?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Moviments sense match ({aiResult.noMatchReasons.length})
                      </summary>
                      <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                        {aiResult.noMatchReasons.map((n, i) => (
                          <div key={i} className="text-xs text-muted-foreground">· {n.reason}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
            <button onClick={() => setAiResult(null)} className="text-muted-foreground hover:text-foreground p-1">
              <XIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Pestanyes */}
      <div className="flex border-b mb-4">
        <button onClick={() => { setTab('pending'); setPage(1); setSelectedMovement(null); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'pending' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Per conciliar ({statsQuery.data?.unconciliated || 0})
        </button>
        <button onClick={() => { setTab('matched'); setPage(1); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'matched' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Per confirmar
        </button>
        <button onClick={() => { setTab('confirmed'); setPage(1); }} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'confirmed' ? 'border-teal-600 text-teal-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          Confirmades
        </button>
        <button onClick={() => { setTab('dismissed'); setPage(1); setShowDismissed(true); }} className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-1.5 ${tab === 'dismissed' ? 'border-gray-600 text-gray-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <EyeOff size={14} /> Descartats {dismissedQuery.data?.pagination?.total ? `(${dismissedQuery.data.pagination.total})` : ''}
        </button>
      </div>

      {/* TAB: Per conciliar — Layout Xero */}
      {isPending && (
        <div className="grid grid-cols-2 gap-4">
          {/* ESQUERRA: Moviments bancaris */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Moviments bancaris</h3>
              {aiSelectMode && movements.length > 0 && (
                <button onClick={toggleAllForAI} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                  {selectedForAI.length === movements.length ? 'Deseleccionar tots' : 'Seleccionar tots'}
                </button>
              )}
            </div>
            {/* Buscador de moviments */}
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={movementSearch}
                onChange={(e) => { setMovementSearch(e.target.value); setPage(1); }}
                placeholder="Cercar moviment (nom, concepte, referència)..."
                className="w-full pl-8 pr-8 py-1.5 rounded-md border bg-background text-xs"
              />
              {movementSearch && (
                <button
                  onClick={() => { setMovementSearch(''); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <XIcon size={14} />
                </button>
              )}
            </div>
            {aiSelectMode && (
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-2 mb-2 text-xs text-violet-700">
                Selecciona els moviments que vols conciliar amb IA i clica "Enviar a IA"
              </div>
            )}
            <div className="space-y-2">
              {activeQuery.loading && !selectedMovement ? (
                <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
              ) : movements.length === 0 && !selectedMovement ? (
                <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Tots els moviments estan conciliats!</div>
              ) : (
                // Si el moviment seleccionat no és a la llista (ve d'un rebutjar), afegir-lo al principi
                (selectedMovement && !movements.find(m => m.id === selectedMovement.id)
                  ? [selectedMovement, ...movements]
                  : movements
                ).map((m) => {
                  const isSelected = selectedMovement?.id === m.id;
                  const isExpense = parseFloat(m.amount) < 0;
                  const isAISelected = selectedForAI.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      onClick={() => aiSelectMode ? toggleMovementForAI(m.id) : setSelectedMovement(isSelected ? null : m)}
                      className={`bg-card border rounded-lg p-3 cursor-pointer transition-all ${
                        aiSelectMode && isAISelected ? 'ring-2 ring-violet-400 border-violet-400 bg-violet-50/40' :
                        isSelected ? 'ring-2 ring-teal-500 border-teal-500' :
                        'hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {aiSelectMode && (
                          <input
                            type="checkbox"
                            checked={isAISelected}
                            onChange={() => {}}
                            className="mt-1 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                          />
                        )}
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                {isExpense ? <ArrowUpCircle size={14} className="text-red-500" /> : <ArrowDownCircle size={14} className="text-green-500" />}
                                <span className="font-medium text-sm">{m.counterparty || m.description}</span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1 ml-6">
                                {formatDate(m.date)} {m.reference ? `· ${m.reference}` : ''} {m.accountName ? `· ${m.accountName}` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`font-semibold text-sm ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                                {isExpense ? '-' : '+'}{formatCurrency(Math.abs(parseFloat(m.amount)))}
                              </div>
                              {!aiSelectMode && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDismissingId(dismissingId === m.id ? null : m.id); }}
                                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                  title="Descartar moviment"
                                >
                                  <Ban size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Mini formulari descartar */}
                          {dismissingId === m.id && (
                            <div className="mt-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-2 items-end">
                                <div className="flex-1">
                                  <label className="text-xs text-muted-foreground block mb-1">Motiu (opcional)</label>
                                  <select
                                    value={dismissReason}
                                    onChange={(e) => setDismissReason(e.target.value)}
                                    className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                                  >
                                    <option value="">Sense motiu</option>
                                    <option value="Transferència interna">Transferència interna</option>
                                    <option value="Pagament Hisenda / impostos">Pagament Hisenda / impostos</option>
                                    <option value="Comissió bancària">Comissió bancària</option>
                                    <option value="Pagament nòmina">Pagament nòmina</option>
                                    <option value="Altre">Altre</option>
                                  </select>
                                </div>
                                <button
                                  onClick={() => handleDismiss(m.id)}
                                  disabled={mutating}
                                  className="px-3 py-1 rounded bg-gray-700 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-50"
                                >
                                  Descartar
                                </button>
                                <button
                                  onClick={() => { setDismissingId(null); setDismissReason(''); }}
                                  className="px-2 py-1 rounded border text-xs font-medium hover:bg-muted"
                                >
                                  Cancel·lar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* DRETA: Factures candidates */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              {selectedMovement ? 'Factures candidates' : 'Selecciona un moviment'}
            </h3>

            {selectedMovement ? (
              <div className="space-y-3">
                {/* Cerca manual */}
                <div className="flex gap-2">
                  <select value={searchType} onChange={(e) => setSearchType(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-xs">
                    <option value="auto">Auto</option>
                    <option value="received">Rebudes</option>
                    <option value="issued">Emeses</option>
                  </select>
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                      placeholder="Cercar factura..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-xs"
                    />
                  </div>
                  <button onClick={handleManualSearch} className="px-3 py-1.5 rounded-md bg-muted text-xs font-medium hover:bg-muted/80">
                    Cercar
                  </button>
                </div>

                {/* Candidates */}
                {searchingCandidates ? (
                  <div className="bg-card border rounded-lg p-6 text-center text-muted-foreground text-sm">Cercant factures...</div>
                ) : candidates.length === 0 ? (
                  <div className="bg-card border rounded-lg p-6 text-center text-muted-foreground text-sm">
                    Cap factura candidata trobada. Prova la cerca manual.
                  </div>
                ) : (
                  <>
                    {/* Barra de multi-selecció */}
                    {selectedCandidates.length > 0 && (
                      <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 mb-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">
                            <span className="font-medium">{selectedCandidates.length} factura{selectedCandidates.length > 1 ? 'es' : ''} seleccionada{selectedCandidates.length > 1 ? 'es' : ''}</span>
                            <span className="mx-2">·</span>
                            <span className="font-semibold">{formatCurrency(selectedTotal)}</span>
                            <span className="mx-1 text-muted-foreground">de</span>
                            <span className="font-semibold">{formatCurrency(Math.abs(parseFloat(selectedMovement.amount)))}</span>
                            {Math.abs(selectedTotal - Math.abs(parseFloat(selectedMovement.amount))) < 0.02 ? (
                              <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Suma exacta</span>
                            ) : (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (dif: {formatCurrency(Math.abs(selectedTotal - Math.abs(parseFloat(selectedMovement.amount))))})
                              </span>
                            )}
                          </div>
                          <button
                            onClick={handleMultiMatch}
                            disabled={mutating}
                            className="px-4 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-50"
                          >
                            Conciliar {selectedCandidates.length} factures
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {candidates.map((inv) => {
                        const absMovAmount = Math.abs(parseFloat(selectedMovement.amount));
                        const invAmount = parseFloat(inv.totalAmount);
                        const amountMatch = Math.abs(invAmount - absMovAmount) < 0.02;
                        const entityName = inv._type === 'received' ? inv.supplier?.name : inv.client?.name;
                        const isSelected = selectedCandidates.some((s) => s.id === inv.id);
                        const remaining = inv.remainingAmount != null ? parseFloat(inv.remainingAmount) : null;
                        const isPartial = remaining != null && remaining > 0.02 && remaining < invAmount - 0.02;

                        // Renderitzar suggeriment de combinació
                        if (inv._isCombo) {
                          return (
                            <div key={inv.id} className="bg-violet-50/40 border-2 border-violet-300 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">Combinació suggerida</span>
                                <span className="text-xs text-muted-foreground">{inv._matchReasons?.[0]}</span>
                              </div>
                              <div className="space-y-1 ml-2">
                                {inv._comboInvoices.map((ci) => (
                                  <div key={ci.id} className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{ci.invoiceNumber}</span>
                                    <span className="font-medium">{formatCurrency(ci.remainingAmount ?? ci.totalAmount)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-violet-200">
                                <span className="text-sm font-semibold">Total: {formatCurrency(inv._comboTotal)}</span>
                                <button
                                  onClick={() => {
                                    // Seleccionar totes les factures del combo
                                    const comboItems = inv._comboInvoices.map(ci => ({
                                      id: ci.id, type: inv._type, totalAmount: parseFloat(ci.remainingAmount ?? ci.totalAmount)
                                    }));
                                    setSelectedCandidates(comboItems);
                                  }}
                                  className="px-4 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700"
                                >
                                  Seleccionar combinació
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={inv.id} className={`bg-card border rounded-lg p-3 transition-colors ${amountMatch ? 'border-green-300 bg-green-50/30' : ''} ${isSelected ? 'border-teal-400 bg-teal-50/40 ring-1 ring-teal-300' : ''}`}>
                            <div className="flex items-start gap-2">
                              {/* Checkbox per multi-selecció */}
                              <label className="mt-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleCandidate(inv)}
                                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                />
                              </label>
                              <div className="flex-1">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                                      {amountMatch && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Import coincident</span>}
                                      {inv._matchReasons?.length > 0 && !amountMatch && (
                                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                                          {inv._matchReasons.filter(r => r !== 'import').join(', ')}
                                        </span>
                                      )}
                                      {isPartial && (
                                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                          Parcialment pagada ({formatCurrency(remaining)} pendent)
                                        </span>
                                      )}
                                      {inv._commissionMatch && (
                                        <span className="text-xs bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">
                                          Comissió {inv._commissionMatch.rule}: -{formatCurrency(inv._commissionMatch.commission)}
                                        </span>
                                      )}
                                      {inv._type === 'received' && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Rebuda</span>}
                                      {inv._type === 'issued' && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Emesa</span>}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {entityName || '—'} · {formatDate(inv.issueDate)}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-semibold text-sm">{formatCurrency(inv.totalAmount)}</div>
                                    {isPartial && (
                                      <div className="text-xs text-amber-600">Pendent: {formatCurrency(remaining)}</div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t">
                                  {inv._type === 'received' && (inv.gdriveFileId || inv.hasPdf) && (
                                    <button onClick={() => handleViewPdf(inv)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                      <FileText size={12} /> Veure PDF
                                    </button>
                                  )}
                                  {inv._type === 'issued' && (
                                    <button
                                      onClick={() => handleViewIssuedDetails(inv.id)}
                                      className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                                    >
                                      <Eye size={12} /> Veure detalls
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleMatch(selectedMovement, inv)}
                                    className="px-4 py-1.5 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
                                  >
                                    OK
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
                <Search size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Clica un moviment bancari per veure les factures candidates</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: Per confirmar / Confirmades */}
      {!isPending && tab !== 'dismissed' && (
        <div>
          {/* Botó recalcular (només a Per confirmar) */}
          {tab === 'matched' && (
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">
                Suggeriments automàtics pendents de revisió
              </p>
              <button
                onClick={async () => {
                  if (!confirm(`Vols esborrar ${conciliations.length} suggeriments i re-llançar la conciliació automàtica amb el motor millorat?`)) return;
                  try {
                    // 1. Esborrar AUTO_MATCHED
                    const clearResult = await mutate('post', '/conciliation/recalculate');
                    // 2. Re-llançar auto-conciliació
                    const autoResult = await mutate('post', '/conciliation/auto');
                    alert(`Recalculat!\n${clearResult.cleared} suggeriments anteriors esborrats.\n${autoResult.matched || 0} nous matches trobats (${autoResult.autoConfirmed || 0} auto-confirmats).`);
                    matchedQuery.refetch();
                    pendingQuery.refetch();
                    statsQuery.refetch();
                  } catch (err) {
                    alert(err.response?.data?.error || 'Error recalculant');
                  }
                }}
                disabled={mutating || conciliations.length === 0}
                className="flex items-center gap-2 bg-amber-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                <RefreshCw size={14} /> Recalcular amb motor millorat
              </button>
            </div>
          )}
          {/* Buscador de conciliacions */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={conciliationSearch}
              onChange={(e) => { setConciliationSearch(e.target.value); setPage(1); }}
              placeholder="Cercar conciliació (moviment, factura, proveïdor, client)..."
              className="w-full pl-8 pr-8 py-1.5 rounded-md border bg-background text-xs"
            />
            {conciliationSearch && (
              <button
                onClick={() => { setConciliationSearch(''); setPage(1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground uppercase">Moviment</th>
                <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Import</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground uppercase">Factura vinculada</th>
                <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Import factura</th>
                <th className="text-center p-3 font-medium text-xs text-muted-foreground uppercase">Confiança</th>
                <th className="text-right p-3 font-medium text-xs text-muted-foreground uppercase">Accions</th>
              </tr>
            </thead>
            <tbody>
              {activeQuery.loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
              ) : conciliations.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Cap conciliació en aquest estat.</td></tr>
              ) : (
                conciliations.map((c) => {
                  const invoice = c.receivedInvoice || c.issuedInvoice;
                  const invoiceLabel = c.receivedInvoice
                    ? `${c.receivedInvoice.invoiceNumber} (${c.receivedInvoice.supplier?.name || ''})`
                    : c.issuedInvoice
                      ? `${c.issuedInvoice.invoiceNumber} (${c.issuedInvoice.client?.name || ''})`
                      : '—';

                  return (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{c.bankMovement?.description}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(c.bankMovement?.date)}</div>
                      </td>
                      <td className={`p-3 text-right font-medium ${parseFloat(c.bankMovement?.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(Math.abs(parseFloat(c.bankMovement?.amount || 0)))}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span>{invoice ? invoiceLabel : <span className="text-muted-foreground italic">Sense factura</span>}</span>
                          {c.receivedInvoice && (c.receivedInvoice.gdriveFileId || c.receivedInvoice.filePath) && (
                            <button onClick={() => handleViewPdf(c.receivedInvoice)} className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Veure PDF">
                              <FileText size={14} />
                            </button>
                          )}
                          {c.issuedInvoice && (
                            <button
                              onClick={() => handleViewIssuedDetails(c.issuedInvoice.id)}
                              className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                              title="Veure detalls factura emesa"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right font-medium">
                        {invoice?.totalAmount ? formatCurrency(parseFloat(invoice.totalAmount)) : '—'}
                      </td>
                      <td className="p-3 text-center text-xs">
                        {c.confidence ? `${Math.round(c.confidence * 100)}%` : '—'}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(c.status === 'AUTO_MATCHED' || c.status === 'MANUAL_MATCHED') && (
                            <>
                              <button onClick={() => handleConfirm(c.id)} className="px-2 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700">Confirmar</button>
                              <button onClick={() => handleReject(c.id, c.bankMovement)} className="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200">Rebutjar</button>
                            </>
                          )}
                          {c.status === 'CONFIRMED' && (
                            <button
                              onClick={() => handleUndo(c.id)}
                              disabled={mutating}
                              className="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs font-medium hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1"
                              title="Desfer conciliació"
                            >
                              <Undo2 size={12} /> Desfer
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* TAB: Descartats */}
      {tab === 'dismissed' && (
        <div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 text-sm text-gray-600">
            Moviments bancaris descartats manualment. No apareixen a la llista de pendents de conciliar.
          </div>
          <div className="space-y-2">
            {dismissedQuery.loading ? (
              <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
            ) : (dismissedQuery.data?.data || []).length === 0 ? (
              <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Cap moviment descartat.</div>
            ) : (
              (dismissedQuery.data?.data || []).map((m) => {
                const isExpense = parseFloat(m.amount) < 0;
                return (
                  <div key={m.id} className="bg-card border rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {isExpense ? <ArrowUpCircle size={14} className="text-red-400 opacity-60" /> : <ArrowDownCircle size={14} className="text-green-400 opacity-60" />}
                          <span className="font-medium text-sm text-muted-foreground">{m.counterparty || m.description}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 ml-6">
                          {formatDate(m.date)} {m.reference ? `· ${m.reference}` : ''}
                          {m.dismissReason && (
                            <span className="ml-2 bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{m.dismissReason}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`font-semibold text-sm opacity-60 ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                          {isExpense ? '-' : '+'}{formatCurrency(Math.abs(parseFloat(m.amount)))}
                        </div>
                        <button
                          onClick={() => handleUndismiss(m.id)}
                          disabled={mutating}
                          className="px-2 py-1 rounded bg-teal-100 text-teal-700 text-xs font-medium hover:bg-teal-200 disabled:opacity-50 flex items-center gap-1"
                          title="Recuperar moviment"
                        >
                          <RotateCcw size={12} /> Recuperar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Paginació */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between p-3 text-sm mt-2">
          <span className="text-muted-foreground">{pagination.total} registres</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded border disabled:opacity-50 flex items-center gap-1">
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="px-3 py-1">{page} / {pagination.totalPages}</span>
            <button onClick={() => setPage(Math.min(pagination.totalPages, page + 1))} disabled={page >= pagination.totalPages} className="px-3 py-1 rounded border disabled:opacity-50 flex items-center gap-1">
              Següent <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Popup detalls factura emesa (sense PDF) */}
      <IssuedInvoiceDetailModal
        isOpen={!!detailInvoice}
        onClose={() => setDetailInvoice(null)}
        invoice={detailInvoice}
      />
    </div>
  );
}
