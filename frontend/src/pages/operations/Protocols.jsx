import { useState, useRef, useCallback } from 'react';
import {
  BookOpen, Edit2, Save, X, Loader2, ChevronDown, ChevronRight, Plus, Trash2,
  GripVertical, Search, Sparkles, MessageCircle, FolderPlus,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';
import useAuthStore from '../../stores/authStore';

const DEFAULT_CATEGORY_LABELS = {
  daily: 'Protocol Diari',
  departure: 'Preparació de Sortides',
  return: 'Devolucions',
  incident: "Gestió d'Incidències",
  maintenance: 'Manteniment',
};

const CATEGORY_COLORS = {
  daily: 'bg-blue-100 text-blue-700',
  departure: 'bg-green-100 text-green-700',
  return: 'bg-purple-100 text-purple-700',
  incident: 'bg-red-100 text-red-700',
  maintenance: 'bg-amber-100 text-amber-700',
};

// Assignar color per categories noves
const EXTRA_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
  'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-700',
  'bg-rose-100 text-rose-700',
];

function getCategoryColor(cat, allCategories) {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  const extraCats = allCategories.filter(c => !CATEGORY_COLORS[c]);
  const idx = extraCats.indexOf(cat);
  return EXTRA_COLORS[idx % EXTRA_COLORS.length] || 'bg-gray-100 text-gray-700';
}

function getCategoryLabel(cat) {
  return DEFAULT_CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
}

export default function Protocols() {
  const { data: protocols, loading, error, refetch } = useApiGet('/operations/protocols');
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newForm, setNewForm] = useState({ title: '', category: 'daily', content: '' });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'ADMIN';

  // Drag & drop
  const [dragItem, setDragItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const [reordering, setReordering] = useState(false);

  // IA Search
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState(null);

  const selected = protocols?.find(p => p.id === selectedId);

  // Agrupar per categoria mantenint ordre
  const allCategories = [];
  const byCategory = (protocols || []).reduce((acc, p) => {
    if (!acc[p.category]) {
      acc[p.category] = [];
      allCategories.push(p.category);
    }
    acc[p.category].push(p);
    return acc;
  }, {});

  // Obtenir totes les categories per al selector (inclou default + les existents)
  const availableCategories = [...new Set([
    ...Object.keys(DEFAULT_CATEGORY_LABELS),
    ...allCategories,
  ])];

  const handleSelect = (protocol) => {
    setSelectedId(protocol.id);
    setEditing(false);
    setEditContent(protocol.content);
  };

  const handleEdit = () => {
    setEditing(true);
    setEditContent(selected?.content || '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/operations/protocols/${selectedId}`, { content: editContent });
      setEditing(false);
      refetch();
    } catch (err) {
      alert('Error guardant');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!newForm.title.trim()) return alert('El títol és obligatori');
    setCreating(true);
    try {
      const res = await api.post('/operations/protocols', newForm);
      setShowNew(false);
      setNewForm({ title: '', category: 'daily', content: '' });
      await refetch();
      setSelectedId(res.data.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Error creant protocol');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Eliminar el protocol "${selected.title}"?`)) return;
    setDeleting(true);
    try {
      await api.delete(`/operations/protocols/${selected.id}`);
      setSelectedId(null);
      refetch();
    } catch (err) {
      alert('Error eliminant');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const slug = newCategoryName.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setNewForm({ ...newForm, category: slug });
    setShowNewCategory(false);
    setNewCategoryName('');
    setShowNew(true);
  };

  // Drag & drop handlers
  const handleDragStart = useCallback((e, protocol, category) => {
    setDragItem({ protocol, category });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.currentTarget.style.opacity = '1';
    setDragItem(null);
    setDragOverItem(null);
  }, []);

  const handleDragOver = useCallback((e, protocol, category) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverItem({ protocol, category });
  }, []);

  const handleDrop = useCallback(async (e, targetProtocol, targetCategory) => {
    e.preventDefault();
    if (!dragItem) return;
    setDragOverItem(null);

    const sourceProtocol = dragItem.protocol;
    if (sourceProtocol.id === targetProtocol.id) return;

    // Obtenir la llista de protocols de la categoria destí
    const catProtos = [...(byCategory[targetCategory] || [])];

    // Si ve d'una altra categoria, l'afegim
    if (dragItem.category !== targetCategory) {
      catProtos.push(sourceProtocol);
    }

    // Reordenar: treure l'element arrossegat i posar-lo a la posició del target
    const filtered = catProtos.filter(p => p.id !== sourceProtocol.id);
    const targetIdx = filtered.findIndex(p => p.id === targetProtocol.id);
    filtered.splice(targetIdx, 0, sourceProtocol);

    // Generar items per l'API
    const items = filtered.map((p, i) => ({
      id: p.id,
      sortOrder: i,
      ...(p.id === sourceProtocol.id && dragItem.category !== targetCategory
        ? { category: targetCategory }
        : {}),
    }));

    // Si ve d'una altra categoria, recalcular sortOrder de l'origen
    if (dragItem.category !== targetCategory) {
      const sourceProtos = (byCategory[dragItem.category] || []).filter(p => p.id !== sourceProtocol.id);
      sourceProtos.forEach((p, i) => {
        items.push({ id: p.id, sortOrder: i });
      });
    }

    setReordering(true);
    try {
      await api.put('/operations/protocols/reorder', { items });
      await refetch();
    } catch (err) {
      alert('Error reordenant');
    } finally {
      setReordering(false);
      setDragItem(null);
    }
  }, [dragItem, byCategory, refetch]);

  // IA Search
  const handleAsk = async () => {
    if (!askQuestion.trim()) return;
    setAskLoading(true);
    setAskAnswer(null);
    try {
      const { data } = await api.post('/operations/protocols/ask', { question: askQuestion });
      setAskAnswer(data);
    } catch (err) {
      setAskAnswer({ answer: err.response?.data?.error || 'Error consultant la IA', sources: [] });
    } finally {
      setAskLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  // Renderitzar Markdown bàsic
  const renderMarkdown = (text) => {
    if (!text) return null;
    const lines = text.split('\n');
    const elements = [];
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (tableRows.length > 0) {
        const headerCells = tableRows[0].split('|').filter(c => c.trim());
        const dataRows = tableRows.slice(2);
        elements.push(
          <div key={`table-${elements.length}`} className="overflow-x-auto my-3">
            <table className="w-full text-sm border">
              <thead className="bg-muted/50">
                <tr>{headerCells.map((c, i) => <th key={i} className="p-2 border text-left font-medium">{c.trim()}</th>)}</tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => {
                  const cells = row.split('|').filter(c => c.trim());
                  return <tr key={ri}>{cells.map((c, ci) => <td key={ci} className="p-2 border">{c.trim()}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>
        );
        tableRows = [];
        inTable = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('|')) { inTable = true; tableRows.push(line); continue; }
      else if (inTable) { flushTable(); }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-lg font-semibold mt-3 mb-2">{line.slice(3)}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(4)}</h3>);
      } else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-primary/30 pl-4 py-1 my-2 text-muted-foreground italic">{line.slice(2)}</blockquote>
        );
      } else if (/^\d+\.\s/.test(line)) {
        const text = line.replace(/^\d+\.\s/, '');
        elements.push(
          <div key={i} className="flex gap-2 ml-4 my-0.5">
            <span className="text-muted-foreground font-medium">{line.match(/^\d+/)[0]}.</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(text) }} />
          </div>
        );
      } else if (line.startsWith('- ')) {
        elements.push(
          <div key={i} className="flex gap-2 ml-4 my-0.5">
            <span className="text-muted-foreground mt-1.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />
          </div>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(<p key={i} className="my-0.5" dangerouslySetInnerHTML={{ __html: boldify(line) }} />);
      }
    }
    flushTable();
    return elements;
  };

  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const boldify = (text) => {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen size={28} className="text-primary" />
          <h1 className="text-2xl font-bold">Protocols Operatius</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Botó buscar amb IA */}
          <button
            onClick={() => setAskOpen(!askOpen)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border transition-colors ${
              askOpen ? 'bg-violet-100 text-violet-700 border-violet-300' : 'hover:bg-accent'
            }`}
          >
            <Sparkles size={16} /> Pregunta a la IA
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setShowNewCategory(!showNewCategory)}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border hover:bg-accent"
              >
                <FolderPlus size={16} /> Nova categoria
              </button>
              <button
                onClick={() => setShowNew(!showNew)}
                className="flex items-center gap-1.5 text-sm bg-primary text-primary-foreground px-3 py-2 rounded-md hover:bg-primary/90"
              >
                <Plus size={16} /> Nou protocol
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">{error}</div>}

      {/* Buscador IA */}
      {askOpen && (
        <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={18} className="text-violet-600" />
            <h3 className="font-semibold text-violet-800 text-sm">Assistent de Protocols</h3>
            <span className="text-xs text-violet-500">Pregunta qualsevol dubte sobre els protocols</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={askQuestion}
              onChange={e => setAskQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAsk()}
              placeholder="Ex: Com es gestiona una devolució? Quin és el procés per a clients internacionals?"
              className="flex-1 rounded-md border border-violet-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              onClick={handleAsk}
              disabled={askLoading || !askQuestion.trim()}
              className="px-4 py-2 bg-violet-600 text-white text-sm rounded-md hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {askLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {askLoading ? 'Consultant...' : 'Preguntar'}
            </button>
          </div>
          {askAnswer && (
            <div className="mt-3 bg-white rounded-lg border border-violet-200 p-4">
              <div className="flex items-start gap-2">
                <MessageCircle size={16} className="text-violet-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm leading-relaxed prose-sm max-w-none">
                  {renderMarkdown(askAnswer.answer)}
                </div>
              </div>
              {askAnswer.sources?.length > 0 && (
                <div className="mt-3 pt-2 border-t border-violet-100">
                  <span className="text-xs text-violet-500">Fonts: </span>
                  {askAnswer.sources.map((s, i) => (
                    <span key={i} className="text-xs text-violet-600 font-medium">
                      {s.title}{i < askAnswer.sources.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Nova categoria */}
      {showNewCategory && (
        <div className="bg-card border rounded-lg p-4 mb-4">
          <h3 className="font-semibold mb-3">Nova categoria</h3>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Nom de la categoria (ex: Manteniment, Formació...)"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim()}
              className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              Crear i afegir protocol
            </button>
            <button onClick={() => setShowNewCategory(false)} className="text-sm text-muted-foreground hover:underline px-3">
              Cancel·lar
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Es crearà la categoria i s&apos;obrirà el formulari per afegir el primer protocol.
          </p>
        </div>
      )}

      {/* Nou protocol */}
      {showNew && (
        <div className="bg-card border rounded-lg p-4 mb-4">
          <h3 className="font-semibold mb-3">Nou protocol</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              placeholder="Títol del protocol"
              value={newForm.title}
              onChange={e => setNewForm({ ...newForm, title: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm col-span-2"
            />
            <select
              value={newForm.category}
              onChange={e => setNewForm({ ...newForm, category: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              {availableCategories.map(k => (
                <option key={k} value={k}>{getCategoryLabel(k)}</option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Contingut del protocol (Markdown)..."
            value={newForm.content}
            onChange={e => setNewForm({ ...newForm, content: e.target.value })}
            className="w-full min-h-[120px] border rounded-md p-3 text-sm bg-background font-mono mb-3"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="text-sm text-muted-foreground hover:underline px-3 py-1.5">Cancel·lar</button>
            <button onClick={handleCreate} disabled={creating}
              className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50">
              {creating ? 'Creant...' : 'Crear protocol'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Sidebar: llista de protocols */}
        <div className="w-72 flex-shrink-0 space-y-1">
          {reordering && (
            <div className="text-xs text-center text-muted-foreground py-1 flex items-center justify-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Guardant ordre...
            </div>
          )}
          {Object.entries(byCategory).map(([cat, protos]) => (
            <div key={cat}>
              <button
                onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent text-sm"
              >
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(cat, allCategories)}`}>
                  {getCategoryLabel(cat)}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{protos.length}</span>
                  {expandedCategory === cat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
              </button>
              {(expandedCategory === cat || expandedCategory === null) && (
                <div className="ml-2 space-y-0.5">
                  {protos.map(p => (
                    <div
                      key={p.id}
                      draggable={isAdmin}
                      onDragStart={e => handleDragStart(e, p, cat)}
                      onDragEnd={handleDragEnd}
                      onDragOver={e => handleDragOver(e, p, cat)}
                      onDrop={e => handleDrop(e, p, cat)}
                      className={`flex items-center gap-1 rounded-md transition-colors ${
                        dragOverItem?.protocol?.id === p.id
                          ? 'border-2 border-dashed border-primary/50 bg-primary/5'
                          : ''
                      }`}
                    >
                      {isAdmin && (
                        <GripVertical size={14} className="text-muted-foreground/40 cursor-grab flex-shrink-0 hover:text-muted-foreground" />
                      )}
                      <button
                        onClick={() => handleSelect(p)}
                        className={`flex-1 text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedId === p.id
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent text-muted-foreground'
                        }`}
                      >
                        {p.title}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Contingut */}
        <div className="flex-1 bg-card border rounded-lg min-h-[500px]">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <BookOpen size={48} className="mx-auto mb-3 opacity-30" />
                <p>Selecciona un protocol per veure&apos;l</p>
              </div>
            </div>
          ) : (
            <div>
              {/* Capçalera */}
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(selected.category, allCategories)}`}>
                    {getCategoryLabel(selected.category)}
                  </span>
                </div>
                {!editing ? (
                  isAdmin && (
                    <div className="flex items-center gap-3">
                      <button onClick={handleEdit}
                        className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                        <Edit2 size={14} /> Editar
                      </button>
                      <button onClick={handleDelete} disabled={deleting}
                        className="flex items-center gap-1.5 text-sm text-red-500 hover:underline disabled:opacity-50">
                        <Trash2 size={14} /> {deleting ? 'Eliminant...' : 'Eliminar'}
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(false)}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
                      <X size={14} /> Cancel·lar
                    </button>
                    <button onClick={handleSave} disabled={saving}
                      className="flex items-center gap-1 text-sm bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50">
                      <Save size={14} /> {saving ? 'Guardant...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>

              {/* Contingut */}
              <div className="p-6">
                {editing ? (
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full min-h-[400px] border rounded-md p-4 text-sm bg-background font-mono"
                    placeholder="Escriu el contingut del protocol en Markdown..."
                  />
                ) : (
                  <div className="prose-sm max-w-none text-sm leading-relaxed">
                    {renderMarkdown(selected.content)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
