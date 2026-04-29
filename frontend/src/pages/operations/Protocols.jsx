import { useState } from 'react';
import {
  BookOpen, Edit2, Save, X, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const CATEGORY_LABELS = {
  daily: 'Protocol Diari',
  departure: 'Preparació de Sortides',
  return: 'Devolucions',
  incident: 'Gestió d\'Incidències',
  maintenance: 'Manteniment',
};

const CATEGORY_COLORS = {
  daily: 'bg-blue-100 text-blue-700',
  departure: 'bg-green-100 text-green-700',
  return: 'bg-purple-100 text-purple-700',
  incident: 'bg-red-100 text-red-700',
  maintenance: 'bg-amber-100 text-amber-700',
};

export default function Protocols() {
  const { data: protocols, loading, error, refetch } = useApiGet('/operations/protocols');
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);

  const selected = protocols?.find(p => p.id === selectedId);

  // Agrupar per categoria
  const byCategory = (protocols || []).reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});

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

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  // Renderitzar Markdown bàsic (headers, bold, llistes, taules)
  const renderMarkdown = (text) => {
    if (!text) return null;
    const lines = text.split('\n');
    const elements = [];
    let inTable = false;
    let tableRows = [];

    const flushTable = () => {
      if (tableRows.length > 0) {
        const headerCells = tableRows[0].split('|').filter(c => c.trim());
        const dataRows = tableRows.slice(2); // skip separator
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

      // Table detection
      if (line.trim().startsWith('|')) {
        inTable = true;
        tableRows.push(line);
        continue;
      } else if (inTable) {
        flushTable();
      }

      // Headers
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-lg font-semibold mt-3 mb-2">{line.slice(3)}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(4)}</h3>);
      }
      // Blockquote
      else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-primary/30 pl-4 py-1 my-2 text-muted-foreground italic">
            {line.slice(2)}
          </blockquote>
        );
      }
      // Numbered list
      else if (/^\d+\.\s/.test(line)) {
        const text = line.replace(/^\d+\.\s/, '');
        elements.push(
          <div key={i} className="flex gap-2 ml-4 my-0.5">
            <span className="text-muted-foreground font-medium">{line.match(/^\d+/)[0]}.</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(text) }} />
          </div>
        );
      }
      // Bullet list
      else if (line.startsWith('- ')) {
        elements.push(
          <div key={i} className="flex gap-2 ml-4 my-0.5">
            <span className="text-muted-foreground mt-1.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />
          </div>
        );
      }
      // Empty line
      else if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
      }
      // Normal text
      else {
        elements.push(<p key={i} className="my-0.5" dangerouslySetInnerHTML={{ __html: boldify(line) }} />);
      }
    }
    flushTable();
    return elements;
  };

  const escapeHtml = (str) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const boldify = (text) => {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={28} className="text-primary" />
        <h1 className="text-2xl font-bold">Protocols Operatius</h1>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">{error}</div>}

      <div className="flex gap-6">
        {/* Sidebar: llista de protocols */}
        <div className="w-72 flex-shrink-0 space-y-1">
          {Object.entries(byCategory).map(([cat, protos]) => (
            <div key={cat}>
              <button
                onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent text-sm"
              >
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[cat] || 'bg-gray-100'}`}>
                  {CATEGORY_LABELS[cat] || cat}
                </span>
                {expandedCategory === cat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {(expandedCategory === cat || expandedCategory === null) && (
                <div className="ml-2 space-y-0.5">
                  {protos.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleSelect(p)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedId === p.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent text-muted-foreground'
                      }`}
                    >
                      {p.title}
                    </button>
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
                <p>Selecciona un protocol per veure'l</p>
              </div>
            </div>
          ) : (
            <div>
              {/* Capçalera */}
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded ${CATEGORY_COLORS[selected.category] || 'bg-gray-100'}`}>
                    {CATEGORY_LABELS[selected.category] || selected.category}
                  </span>
                </div>
                {!editing ? (
                  <button onClick={handleEdit}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Edit2 size={14} /> Editar
                  </button>
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
