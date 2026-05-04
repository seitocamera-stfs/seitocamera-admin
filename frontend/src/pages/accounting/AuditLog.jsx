import { useState } from 'react';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { formatDate } from '../../lib/utils';

const ACTION_COLORS = {
  CREATE: 'text-green-600',
  UPDATE: 'text-blue-600',
  DELETE: 'text-red-600',
  POST:   'text-emerald-600',
  REVERSE:'text-amber-600',
  LOCK:   'text-purple-600',
  UNLOCK: 'text-purple-400',
};

export default function AuditLog() {
  const [filters, setFilters] = useState({
    entityType: '',
    action: '',
    userId: '',
    from: '',
    to: '',
    page: 1,
  });
  const [expanded, setExpanded] = useState(new Set());

  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, v]) => v !== '' && v !== null && v !== undefined),
  );

  const { data, loading } = useApiGet('/audit-logs', cleanFilters);

  const toggle = (id) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Search size={24} className="text-primary" />
        <h1 className="text-xl font-semibold">Auditoria</h1>
      </div>

      <div className="bg-card border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <FilterField label="Entitat">
          <input className="input-field" placeholder="ChartOfAccount, FiscalYear..." value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value, page: 1 })} />
        </FilterField>
        <FilterField label="Acció">
          <select className="input-field" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}>
            <option value="">Totes</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="POST">POST</option>
            <option value="REVERSE">REVERSE</option>
            <option value="LOCK">LOCK</option>
            <option value="UNLOCK">UNLOCK</option>
          </select>
        </FilterField>
        <FilterField label="Des de">
          <input className="input-field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })} />
        </FilterField>
        <FilterField label="Fins a">
          <input className="input-field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })} />
        </FilterField>
        <FilterField label="ID entitat">
          <input className="input-field" placeholder="ID exacte" value={filters.entityId || ''} onChange={(e) => setFilters({ ...filters, entityId: e.target.value, page: 1 })} />
        </FilterField>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Carregant...</div>}

      {data && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-8"></th>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Usuari</th>
                <th className="text-left px-3 py-2">Acció</th>
                <th className="text-left px-3 py-2">Entitat</th>
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Camps modificats</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((log) => (
                <RowGroup key={log.id} log={log} expanded={expanded.has(log.id)} onToggle={() => toggle(log.id)} />
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-6">Sense entrades amb aquests filtres.</td></tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t text-sm">
              <span className="text-muted-foreground">{data.total} entrades · pàgina {filters.page} de {totalPages}</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="px-3 py-1 rounded border disabled:opacity-50">Anterior</button>
                <button disabled={filters.page >= totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="px-3 py-1 rounded border disabled:opacity-50">Següent</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function RowGroup({ log, expanded, onToggle }) {
  return (
    <>
      <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={onToggle}>
        <td className="px-2">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-3 py-2 text-muted-foreground">{formatDate(log.createdAt)}</td>
        <td className="px-3 py-2">{log.user?.name || log.userEmail || log.userId}</td>
        <td className={`px-3 py-2 font-mono text-xs ${ACTION_COLORS[log.action] || ''}`}>{log.action}</td>
        <td className="px-3 py-2">{log.entityType}</td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{log.entityId.slice(0, 8)}…</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{(log.changedFields || []).join(', ') || '—'}</td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/10">
          <td></td>
          <td colSpan={6} className="p-3">
            <DiffView before={log.beforeData} after={log.afterData} changedFields={log.changedFields || []} />
          </td>
        </tr>
      )}
    </>
  );
}

function DiffView({ before, after, changedFields }) {
  if (!before && !after) return <div className="text-xs text-muted-foreground">Sense detall</div>;
  if (!before) return <pre className="text-xs">{JSON.stringify(after, null, 2)}</pre>;
  if (!after) return <pre className="text-xs">{JSON.stringify(before, null, 2)}</pre>;

  return (
    <div className="grid grid-cols-2 gap-4 text-xs">
      <div>
        <div className="font-semibold mb-1">Abans</div>
        <pre className="bg-rose-50 border border-rose-100 rounded p-2 overflow-auto max-h-64">
{changedFields.length ? JSON.stringify(Object.fromEntries(changedFields.map(f => [f, before[f]])), null, 2) : JSON.stringify(before, null, 2)}
        </pre>
      </div>
      <div>
        <div className="font-semibold mb-1">Després</div>
        <pre className="bg-green-50 border border-green-100 rounded p-2 overflow-auto max-h-64">
{changedFields.length ? JSON.stringify(Object.fromEntries(changedFields.map(f => [f, after[f]])), null, 2) : JSON.stringify(after, null, 2)}
        </pre>
      </div>
    </div>
  );
}
