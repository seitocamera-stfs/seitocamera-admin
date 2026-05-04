import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { formatDate } from '../../lib/utils';

export default function Ledger() {
  const { data: company } = useApiGet('/companies');
  const { data: accounts } = useApiGet(company ? '/chart-of-accounts' : null, company ? { companyId: company.id, leafOnly: 'true' } : {});
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = { ...(company && { companyId: company.id }), ...(accountId && { accountId }), ...(from && { from }), ...(to && { to }) };
  const { data, loading } = useApiGet(accountId ? '/ledger' : null, params);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={24} className="text-primary" />
        <h1 className="text-xl font-semibold">Llibre major</h1>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-muted-foreground">Compte</span>
          <select className="input-field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— Selecciona un compte —</option>
            {(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Des de</span>
            <input className="input-field" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Fins a</span>
            <input className="input-field" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      {!accountId && <div className="text-sm text-muted-foreground p-6 bg-card border rounded-lg text-center">Selecciona un compte per veure els seus apunts.</div>}
      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/20">
            <h2 className="font-semibold">{data.account?.code} · {data.account?.name}</h2>
            <p className="text-xs text-muted-foreground">{data.items.length} apunts · Total deure {data.totals.debit.toFixed(2)} · Total haver {data.totals.credit.toFixed(2)} · Saldo {data.totals.balance.toFixed(2)}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-28">Data</th>
                <th className="text-right px-3 py-2 w-16">Núm.</th>
                <th className="text-left px-3 py-2">Concepte</th>
                <th className="text-right px-3 py-2 w-28">Deure</th>
                <th className="text-right px-3 py-2 w-28">Haver</th>
                <th className="text-right px-3 py-2 w-28">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr key={l.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(l.date)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs"><Link to={`/journal/${l.entryId}`} className="hover:underline">#{l.entryNumber}</Link></td>
                  <td className="px-3 py-2">{l.lineDescription || l.entryDescription}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.debit ? l.debit.toFixed(2) : ''}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.credit ? l.credit.toFixed(2) : ''}</td>
                  <td className={`px-3 py-2 text-right font-mono ${l.balance < 0 ? 'text-rose-700' : ''}`}>{l.balance.toFixed(2)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">Aquest compte no té apunts en el període.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
