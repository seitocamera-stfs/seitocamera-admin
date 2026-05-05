import { useState, useEffect } from 'react';
import { Settings, Save, Plus, X, AlertCircle } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const FIELDS = [
  { key: 'description', label: 'Descripció', type: 'textarea', placeholder: 'Què fa l\'empresa, en una frase llarga (mín. 30 caràcters)' },
  { key: 'vertical', label: 'Vertical / Indústria', type: 'text', placeholder: 'audiovisual equipment rental' },
  { key: 'language', label: 'Idioma de sortida', type: 'select', options: [['ca', 'Català'], ['es', 'Castellà'], ['en', 'Anglès']] },
  { key: 'goals', label: 'Objectius de negoci', type: 'list', placeholder: 'Captar més clients d\'alta gamma' },
  { key: 'unique_strengths', label: 'Fortaleses úniques', type: 'list', placeholder: 'Una fortalesa per línia' },
  { key: 'target_customers', label: 'Clients objectiu', type: 'list', placeholder: 'Tipus de client (productores, freelancers...)' },
  { key: 'known_competitors', label: 'Competidors coneguts (seeds)', type: 'list', placeholder: 'Servicevision, Napalm Rentals...' },
  { key: 'excluded_segments', label: 'Segments a EXCLOURE', type: 'list', placeholder: 'Quins NO són clients (videoaficionats...)' },
];

export default function MarketingSettings() {
  const { data: initial, loading, refetch } = useApiGet('/marketing/context/business');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial && draft === null) setDraft(initial);
  }, [initial, draft]);

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const addToList = (key) => setDraft((d) => ({ ...d, [key]: [...(d[key] || []), ''] }));
  const removeFromList = (key, idx) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, i) => i !== idx) }));
  const updateListItem = (key, idx, value) => setDraft((d) => ({
    ...d, [key]: d[key].map((v, i) => (i === idx ? value : v)),
  }));

  const save = async () => {
    setSaving(true);
    try {
      // Netejar entrades buides de les llistes
      const clean = { ...draft };
      for (const f of FIELDS) {
        if (f.type === 'list') clean[f.key] = (clean[f.key] || []).filter((v) => v && v.trim());
      }
      await api.patch('/marketing/context/business', clean);
      alert('Context guardat. Els pròxims runs d\'agents marketing usaran aquest context.');
      refetch();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally { setSaving(false); }
  };

  if (loading || !draft) return <div className="p-6">Carregant...</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings size={24} className="text-primary" />
          <h1 className="text-xl font-semibold">Marketing AI · Context d'empresa</h1>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          <Save size={16} />
          {saving ? 'Desant...' : 'Desar'}
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-3 mb-6 flex gap-2">
        <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
        <div>
          Aquest context el llegeixen els agents IA de marketing (Investigator, Strategist...) per analitzar competidors,
          generar estratègies i trobar leads. Com més concret i actualitzat, millors resultats.
        </div>
      </div>

      <div className="space-y-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium mb-1">{f.label}</label>

            {f.type === 'textarea' && (
              <textarea
                value={draft[f.key] || ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                rows={4}
                className="w-full px-3 py-2 border rounded-md text-sm resize-y"
              />
            )}

            {f.type === 'text' && (
              <input
                type="text"
                value={draft[f.key] || ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            )}

            {f.type === 'select' && (
              <select
                value={draft[f.key] || ''}
                onChange={(e) => setField(f.key, e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}

            {f.type === 'list' && (
              <div className="space-y-1">
                {(draft[f.key] || []).map((item, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      value={item}
                      onChange={(e) => updateListItem(f.key, idx, e.target.value)}
                      placeholder={f.placeholder}
                      className="flex-1 px-3 py-1.5 border rounded-md text-sm"
                    />
                    <button
                      onClick={() => removeFromList(f.key, idx)}
                      className="px-2 py-1 rounded border hover:bg-rose-50 hover:text-rose-700"
                      title="Treure"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addToList(f.key)}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted flex items-center gap-1"
                >
                  <Plus size={12} /> Afegir
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
