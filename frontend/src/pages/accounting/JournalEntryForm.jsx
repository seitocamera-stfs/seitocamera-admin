import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save, CheckCircle } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const TYPE_OPTIONS = [
  ['OTHER', 'Manual / Altre'],
  ['ADJUSTMENT', 'Ajust'],
  ['PAYMENT', 'Pagament'],
  ['COLLECTION', 'Cobrament'],
  ['BANK_TRANSFER', 'Transferència interna'],
  ['BANK_FEE', 'Comissió'],
  ['TAX_PAYMENT', 'Pagament d\'impost'],
];

const emptyLine = () => ({ accountId: '', description: '', debit: '', credit: '', sortOrder: 0 });

export default function JournalEntryForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const { data: company } = useApiGet('/companies');
  const { data: accounts } = useApiGet(company ? '/chart-of-accounts' : null, company ? { companyId: company.id, leafOnly: 'true' } : {});
  const { data: existing } = useApiGet(isEdit ? `/journal/${id}` : null);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    type: 'OTHER',
    lines: [emptyLine(), emptyLine()],
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm({
        date: existing.date.slice(0, 10),
        description: existing.description,
        type: existing.type,
        lines: existing.lines.map((l) => ({
          id: l.id,
          accountId: l.accountId,
          description: l.description || '',
          debit: Number(l.debit) || '',
          credit: Number(l.credit) || '',
          sortOrder: l.sortOrder,
        })),
      });
    }
  }, [existing]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of form.lines) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
    }
    return { debit: Math.round(d * 100) / 100, credit: Math.round(c * 100) / 100, diff: Math.round((d - c) * 100) / 100 };
  }, [form.lines]);

  const isBalanced = Math.abs(totals.diff) < 0.01 && totals.debit > 0;

  const updateLine = (idx, patch) => {
    const next = [...form.lines];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, lines: next });
  };

  const addLine = () => setForm({ ...form, lines: [...form.lines, emptyLine()] });
  const removeLine = (idx) => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) });

  const submit = async (postAfter = false) => {
    setBusy(true); setError(null);
    try {
      const payload = {
        companyId: company.id,
        date: new Date(form.date).toISOString(),
        description: form.description,
        type: form.type,
        lines: form.lines
          .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l, idx) => ({
            accountId: l.accountId,
            description: l.description || null,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            sortOrder: idx,
          })),
      };
      let entry;
      if (isEdit) {
        const { data } = await api.put(`/journal/${id}`, payload);
        entry = data;
      } else {
        const { data } = await api.post('/journal', payload);
        entry = data;
      }
      if (postAfter) {
        await api.patch(`/journal/${entry.id}/post`);
      }
      navigate(`/journal/${entry.id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!company || !accounts) return <div className="p-6">Carregant...</div>;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-xl font-semibold">{isEdit ? `Editar assentament #${existing?.entryNumber || ''}` : 'Nou assentament'}</h1>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">{error}</div>}

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Data</span>
            <input type="date" className="input-field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs text-muted-foreground">Concepte</span>
            <input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripció breu de l'assentament" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Tipus</span>
            <select className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Línies</h3>
            <button onClick={addLine} type="button" className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border hover:bg-muted">
              <Plus size={12} /> Afegir línia
            </button>
          </div>

          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1">Compte</th>
                <th className="text-left px-2 py-1">Concepte de la línia</th>
                <th className="text-right px-2 py-1 w-28">Deure</th>
                <th className="text-right px-2 py-1 w-28">Haver</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-1 py-1">
                    <select className="input-field" value={l.accountId} onChange={(e) => updateLine(idx, { accountId: e.target.value })}>
                      <option value="">— Compte —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input className="input-field" value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} />
                  </td>
                  <td className="px-1 py-1">
                    <input className="input-field text-right" type="number" step="0.01" value={l.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                  </td>
                  <td className="px-1 py-1">
                    <input className="input-field text-right" type="number" step="0.01" value={l.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                  </td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removeLine(idx)} className="p-1 text-rose-600 hover:bg-rose-50 rounded">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td colSpan={2} className="px-2 py-2 text-right font-semibold text-sm">Totals</td>
                <td className="px-2 py-2 text-right font-mono">{totals.debit.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono">{totals.credit.toFixed(2)}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={2} className="px-2 py-1 text-right text-sm">Diferència</td>
                <td colSpan={2} className={`px-2 py-1 text-right font-mono font-semibold ${isBalanced ? 'text-green-700' : 'text-rose-700'}`}>
                  {isBalanced ? '0,00 ✓ (Quadra)' : totals.diff.toFixed(2) + ' ✗'}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button type="button" onClick={() => navigate('/journal')} className="px-4 py-2 rounded-md text-sm border">Cancel·lar</button>
          <button type="button" onClick={() => submit(false)} disabled={busy || !form.description}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm border disabled:opacity-50">
            <Save size={14} /> Guardar com a esborrany
          </button>
          <button type="button" onClick={() => submit(true)} disabled={busy || !isBalanced || !form.description}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <CheckCircle size={14} /> Guardar i comptabilitzar
          </button>
        </div>
      </div>
    </div>
  );
}
