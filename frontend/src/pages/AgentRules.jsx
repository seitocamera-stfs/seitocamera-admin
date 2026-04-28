import { useState } from 'react';
import {
  BookOpen, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Search, Filter, Brain, Zap, Shield, X, Save,
  FileText, GitCompare, Truck, AlertTriangle, Calculator, Layers,
} from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import api from '../lib/api';

// ===========================================
// Constants
// ===========================================

const CATEGORIES = [
  { value: 'INVOICES', label: 'Factures', icon: FileText, color: 'bg-blue-50 text-blue-700' },
  { value: 'CLASSIFICATION', label: 'Classificació', icon: Layers, color: 'bg-indigo-50 text-indigo-700' },
  { value: 'CONCILIATION', label: 'Conciliació', icon: GitCompare, color: 'bg-emerald-50 text-emerald-700' },
  { value: 'SUPPLIERS', label: 'Proveïdors', icon: Truck, color: 'bg-amber-50 text-amber-700' },
  { value: 'ANOMALIES', label: 'Anomalies', icon: AlertTriangle, color: 'bg-red-50 text-red-700' },
  { value: 'FISCAL', label: 'Fiscal', icon: Calculator, color: 'bg-purple-50 text-purple-700' },
  { value: 'GENERAL', label: 'General', icon: BookOpen, color: 'bg-gray-100 text-gray-600' },
];

const CATEGORY_MAP = {};
CATEGORIES.forEach((c) => { CATEGORY_MAP[c.value] = c; });

const SOURCE_LABELS = {
  MANUAL: { label: 'Manual', color: 'bg-gray-100 text-gray-600' },
  LEARNED: { label: 'Apresa', color: 'bg-sky-50 text-sky-700' },
  SYSTEM: { label: 'Sistema', color: 'bg-violet-50 text-violet-700' },
};

const PRIORITY_LABELS = {
  0: { label: 'Normal', color: 'text-gray-500' },
  1: { label: 'Alta', color: 'text-amber-600' },
  2: { label: 'Crítica', color: 'text-red-600' },
};

const EMPTY_FORM = {
  title: '',
  condition: '',
  action: '',
  category: 'GENERAL',
  priority: 0,
  examples: '',
};

// ===========================================
// Component principal
// ===========================================

export default function AgentRules() {
  const { data: rules, loading, refetch } = useApiGet('/agent/rules');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [search, setSearch] = useState('');

  const handleOpenCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleOpenEdit = (rule) => {
    setEditing(rule);
    setForm({
      title: rule.title,
      condition: rule.condition,
      action: rule.action,
      category: rule.category,
      priority: rule.priority,
      examples: rule.examples || '',
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/agent/rules/${editing.id}`, form);
      } else {
        await api.post('/agent/rules', form);
      }
      setShowModal(false);
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error guardant la regla');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await api.patch(`/agent/rules/${rule.id}/toggle`);
      refetch();
    } catch {
      alert('Error canviant l\'estat');
    }
  };

  const handleDelete = async (rule) => {
    if (!confirm(`Eliminar la regla "${rule.title}"?`)) return;
    try {
      await api.delete(`/agent/rules/${rule.id}`);
      refetch();
    } catch {
      alert('Error eliminant la regla');
    }
  };

  // Filtrar
  const filtered = (rules || []).filter((r) => {
    if (filterCategory && r.category !== filterCategory) return false;
    if (filterActive === 'true' && !r.isActive) return false;
    if (filterActive === 'false' && r.isActive) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!r.title.toLowerCase().includes(s) && !r.condition.toLowerCase().includes(s) && !r.action.toLowerCase().includes(s)) {
        return false;
      }
    }
    return true;
  });

  const activeCount = (rules || []).filter((r) => r.isActive).length;

  return (
    <div className="p-6">
      {/* Capçalera */}
      <div className="bg-white border rounded-xl mb-5">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: '#e6f3f7' }}
            >
              <Brain size={20} style={{ color: '#00617F' }} />
            </div>
            <div>
              <h1 className="text-lg font-medium text-gray-900">Regles de l'agent</h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {activeCount} regles actives · L'agent les segueix automàticament
              </p>
            </div>
          </div>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white transition-colors"
            style={{ background: '#00617F' }}
          >
            <Plus size={14} />
            Nova regla
          </button>
        </div>

        {/* Filtres */}
        <div className="px-5 pb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Cercar regles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': '#00617F' }}
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-xs border rounded-lg px-3 py-2 text-gray-600"
          >
            <option value="">Totes les categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            className="text-xs border rounded-lg px-3 py-2 text-gray-600"
          >
            <option value="">Totes</option>
            <option value="true">Actives</option>
            <option value="false">Inactives</option>
          </select>
        </div>
      </div>

      {/* Llistat de regles */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200" style={{ borderTopColor: '#00617F' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border rounded-xl px-6 py-12 text-center">
          <BookOpen size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {(rules || []).length === 0 ? 'Cap regla configurada' : 'Cap regla coincideix amb els filtres'}
          </p>
          {(rules || []).length === 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Crea regles perquè l'agent aprengui com vols que processi les teves dades
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => handleOpenEdit(rule)}
              onToggle={() => handleToggle(rule)}
              onDelete={() => handleDelete(rule)}
            />
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl w-full max-w-lg mx-4 shadow-xl">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-900">
                {editing ? 'Editar regla' : 'Nova regla'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Títol</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex: Factures duplicades — preferir l'última"
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  Condició <span className="text-gray-400 font-normal">— Quan passa això...</span>
                </label>
                <textarea
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                  placeholder="Ex: Quan hi ha dues factures del mateix proveïdor amb el mateix número de factura i data però import diferent"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  Acció <span className="text-gray-400 font-normal">— Fer això...</span>
                </label>
                <textarea
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  placeholder="Ex: La factura correcta és sempre l'última rebuda. Marcar l'anterior com a duplicat."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 resize-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Categoria</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Prioritat</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border rounded-lg"
                  >
                    <option value={0}>Normal</option>
                    <option value={1}>Alta</option>
                    <option value={2}>Crítica</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  Exemples <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={form.examples}
                  onChange={(e) => setForm({ ...form, examples: e.target.value })}
                  placeholder="Exemples concrets de quan aplicar aquesta regla..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs border rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  Cancel·lar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg text-white disabled:opacity-50"
                  style={{ background: '#00617F' }}
                >
                  <Save size={13} />
                  {saving ? 'Guardant...' : editing ? 'Guardar canvis' : 'Crear regla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================
// RuleCard
// ===========================================

function RuleCard({ rule, onEdit, onToggle, onDelete }) {
  const cat = CATEGORY_MAP[rule.category] || CATEGORY_MAP.GENERAL;
  const CatIcon = cat.icon;
  const source = SOURCE_LABELS[rule.source] || SOURCE_LABELS.MANUAL;
  const priority = PRIORITY_LABELS[rule.priority] || PRIORITY_LABELS[0];

  return (
    <div className={`bg-white border rounded-xl px-5 py-4 transition-colors ${!rule.isActive ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        {/* Icona categoria */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.color}`}>
          <CatIcon size={16} />
        </div>

        {/* Contingut */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-900">{rule.title}</span>
            {rule.priority >= 1 && (
              <Zap size={12} className={priority.color} />
            )}
          </div>
          <div className="text-xs text-gray-500 mb-1">
            <span className="font-medium text-gray-600">Quan:</span> {rule.condition}
          </div>
          <div className="text-xs text-gray-500 mb-2">
            <span className="font-medium text-gray-600">Acció:</span> {rule.action}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${cat.color}`}>
              {cat.label}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${source.color}`}>
              {source.label}
            </span>
            {rule.timesApplied > 0 && (
              <span className="text-[9px] text-gray-400">
                Usada {rule.timesApplied}x
              </span>
            )}
          </div>
        </div>

        {/* Accions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            title={rule.isActive ? 'Desactivar' : 'Activar'}
          >
            {rule.isActive ? (
              <ToggleRight size={18} style={{ color: '#059669' }} />
            ) : (
              <ToggleLeft size={18} className="text-gray-300" />
            )}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            title="Editar"
          >
            <Pencil size={14} className="text-gray-400" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
            title="Eliminar"
          >
            <Trash2 size={14} className="text-gray-300 hover:text-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
}
