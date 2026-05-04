import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, BookOpen, Search, Plus } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const TYPE_BADGES = {
  ASSET:     { label: 'Actiu',     className: 'bg-blue-100 text-blue-700' },
  LIABILITY: { label: 'Passiu',    className: 'bg-amber-100 text-amber-700' },
  EQUITY:    { label: 'PN',        className: 'bg-purple-100 text-purple-700' },
  INCOME:    { label: 'Ingrés',    className: 'bg-green-100 text-green-700' },
  EXPENSE:   { label: 'Despesa',   className: 'bg-rose-100 text-rose-700' },
};

export default function ChartOfAccounts() {
  const { data: company } = useApiGet('/companies');
  const { data: tree, loading, refetch } = useApiGet(
    company ? '/chart-of-accounts/tree' : null,
    company ? { companyId: company.id } : {},
  );
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);

  const filteredTree = useMemo(() => {
    if (!tree) return [];
    if (!search && filter === 'ALL') return tree;

    const matches = (n) => {
      if (filter !== 'ALL' && n.type !== filter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return n.code.toLowerCase().includes(s) || n.name.toLowerCase().includes(s);
    };

    const filterNode = (n) => {
      const filteredChildren = (n.children || []).map(filterNode).filter(Boolean);
      if (matches(n) || filteredChildren.length > 0) {
        return { ...n, children: filteredChildren };
      }
      return null;
    };

    return tree.map(filterNode).filter(Boolean);
  }, [tree, search, filter]);

  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const expandAll = () => {
    if (!tree) return;
    const all = new Set();
    const walk = (nodes) => nodes.forEach((n) => { all.add(n.id); if (n.children) walk(n.children); });
    walk(tree);
    setExpanded(all);
  };

  if (loading || !tree) return <div className="p-6">Carregant...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Pla de comptes</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-2 rounded-md text-xs font-medium border hover:bg-muted"
          >
            Expandir tot
          </button>
          <button
            onClick={() => setExpanded(new Set())}
            className="px-3 py-2 rounded-md text-xs font-medium border hover:bg-muted"
          >
            Col·lapsar
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
          >
            <Plus size={16} /> Nou compte
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            placeholder="Cerca per codi o nom..."
            className="input-field pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input-field w-44" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">Tots els tipus</option>
          <option value="ASSET">Actiu</option>
          <option value="LIABILITY">Passiu</option>
          <option value="EQUITY">Patrimoni net</option>
          <option value="INCOME">Ingrés</option>
          <option value="EXPENSE">Despesa</option>
        </select>
      </div>

      <div className="bg-card border rounded-lg p-2">
        {filteredTree.map((node) => (
          <TreeNode key={node.id} node={node} expanded={expanded} onToggle={toggle} depth={0} />
        ))}
        {filteredTree.length === 0 && (
          <div className="text-center text-muted-foreground py-6 text-sm">Cap compte coincideix amb la cerca.</div>
        )}
      </div>

      {showCreate && (
        <CreateAccountModal
          companyId={company?.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch(); }}
        />
      )}
    </div>
  );
}

function TreeNode({ node, expanded, onToggle, depth }) {
  const hasChildren = (node.children || []).length > 0;
  const isOpen = expanded.has(node.id);
  const badge = TYPE_BADGES[node.type] || TYPE_BADGES.ASSET;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 ${node.isLeaf ? '' : 'font-medium'}`}
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        {hasChildren ? (
          <button onClick={() => onToggle(node.id)} className="p-0.5 -ml-1">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="font-mono text-xs text-muted-foreground w-20">{node.code}</span>
        <span className="text-sm flex-1">{node.name}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
        {node.isSystem && <span className="text-[10px] text-muted-foreground">sistema</span>}
        {node.taxBookType && <span className="text-[10px] text-blue-600">{node.taxBookType}</span>}
      </div>
      {isOpen && hasChildren && node.children.map((c) => (
        <TreeNode key={c.id} node={c} expanded={expanded} onToggle={onToggle} depth={depth + 1} />
      ))}
    </div>
  );
}

function CreateAccountModal({ companyId, onClose, onCreated }) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'EXPENSE',
    defaultVatRate: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        companyId,
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        isLeaf: true,
        level: 3,
      };
      if (form.defaultVatRate !== '') payload.defaultVatRate = parseFloat(form.defaultVatRate);
      await api.post('/chart-of-accounts', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Nou compte</h2>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Codi</span>
          <input className="input-field" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Nom</span>
          <input className="input-field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Tipus</span>
          <select className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="ASSET">Actiu</option>
            <option value="LIABILITY">Passiu</option>
            <option value="EQUITY">Patrimoni net</option>
            <option value="INCOME">Ingrés</option>
            <option value="EXPENSE">Despesa</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">IVA per defecte (%) — opcional</span>
          <input className="input-field" type="number" step="0.01" value={form.defaultVatRate} onChange={(e) => setForm({ ...form, defaultVatRate: e.target.value })} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm border">Cancel·lar</button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground disabled:opacity-50">
            {busy ? 'Creant...' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
