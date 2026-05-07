import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageCircle, Plus, Send, Hash, Users as UsersIcon, Settings,
  Paperclip, Image as ImageIcon, FileText, Download, Trash2, X,
  Edit2, Check, Search, ChevronLeft, Loader2, Smile, Copy,
} from 'lucide-react';
import api from '../lib/api';
import { useApiGet } from '../hooks/useApi';
import useAuthStore from '../stores/authStore';

// =============================================================
// Pàgina principal del Xat
// =============================================================
export default function Chat() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  const { data: channelsData, refetch: refetchChannels } = useApiGet('/chat/channels', {}, {
    refetchOnVisible: true,
  });
  const channels = channelsData?.channels || [];

  // Auto-redirect to first channel if none selected
  useEffect(() => {
    if (!channelId && channels.length > 0) {
      navigate(`/chat/${channels[0].id}`, { replace: true });
    }
  }, [channelId, channels, navigate]);

  // Polling de la llista de canals (per actualitzar badges sense llegir)
  useEffect(() => {
    const id = setInterval(refetchChannels, 8000);
    return () => clearInterval(id);
  }, [refetchChannels]);

  const [showCreate, setShowCreate] = useState(false);
  const [showMobileList, setShowMobileList] = useState(true);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-background">
      {/* Sidebar canals (esquerra) */}
      <aside className={`${
        showMobileList || !channelId ? 'flex' : 'hidden'
      } md:flex flex-col w-full md:w-64 border-r bg-card`}>
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MessageCircle size={16} className="text-primary" />
            Xats
          </h2>
          {currentUser?.role === 'ADMIN' && (
            <button
              onClick={() => setShowCreate(true)}
              className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
              title="Nou canal"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {channels.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 px-3">
              No hi ha cap canal disponible.{' '}
              {currentUser?.role === 'ADMIN' && 'Crea\'n un nou.'}
            </p>
          )}
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => {
                navigate(`/chat/${ch.id}`);
                setShowMobileList(false);
              }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-muted/50 transition-colors ${
                ch.id === channelId ? 'bg-muted/70 border-l-2 border-primary' : ''
              }`}
            >
              <Hash size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate font-medium">{ch.name}</span>
              {ch.unreadCount > 0 && (
                <span className="text-[10px] bg-primary text-primary-foreground px-1.5 rounded-full font-semibold">
                  {ch.unreadCount > 99 ? '99+' : ch.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Conversa (dreta) */}
      <main className={`${
        !showMobileList && channelId ? 'flex' : 'hidden'
      } md:flex flex-1 flex-col bg-background min-w-0`}>
        {channelId ? (
          <ChannelView
            key={channelId}
            channelId={channelId}
            onBack={() => setShowMobileList(true)}
            currentUser={currentUser}
            refetchChannels={refetchChannels}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Selecciona un canal per començar
          </div>
        )}
      </main>

      {showCreate && (
        <CreateChannelModal
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            refetchChannels();
            navigate(`/chat/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Vista d'un canal
// =============================================================
function ChannelView({ channelId, onBack, currentUser, refetchChannels }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const { data: channels } = useApiGet('/chat/channels');
  const channel = channels?.channels?.find(c => c.id === channelId);

  const { data: members } = useApiGet(`/chat/channels/${channelId}/members`);

  const loadMessages = useCallback(async () => {
    try {
      const res = await api.get(`/chat/channels/${channelId}/messages`, { params: { limit: 100 } });
      setMessages(res.data);
    } catch (err) {
      console.error('Error carregant missatges:', err);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  // Càrrega inicial + polling
  useEffect(() => {
    setLoading(true);
    loadMessages();
    const id = setInterval(loadMessages, 4000);
    return () => clearInterval(id);
  }, [loadMessages]);

  // Marcar com a llegit en obrir el canal o quan arriben missatges nous
  const lastReadAtRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    const now = Date.now();
    if (now - lastReadAtRef.current < 3000) return; // throttle
    lastReadAtRef.current = now;
    api.post(`/chat/channels/${channelId}/read`).then(() => refetchChannels?.()).catch(() => {});
  }, [messages.length, channelId, refetchChannels]);

  // Auto-scroll quan arriben missatges nous (només si l'usuari està a baix)
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    if (wasAtBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    wasAtBottomRef.current = atBottom;
  };

  const handleSend = async () => {
    if (!text.trim() && !attachment) return;
    setSending(true);
    try {
      await api.post(`/chat/channels/${channelId}/messages`, {
        content: text.trim() || (attachment ? `_(adjunt)_` : ''),
        attachmentId: attachment?.id || null,
      });
      setText('');
      setAttachment(null);
      wasAtBottomRef.current = true;
      await loadMessages();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert('Fitxer massa gran (màx 50 MB)');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/chat/channels/${channelId}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachment(res.data);
    } catch (err) {
      alert(`Error pujant fitxer: ${err.response?.data?.error || err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (msg) => {
    if (!confirm('Esborrar aquest missatge?')) return;
    try {
      await api.delete(`/chat/messages/${msg.id}`);
      loadMessages();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleStartEdit = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
  };

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    try {
      await api.put(`/chat/messages/${editingId}`, { content: editText.trim() });
      setEditingId(null);
      setEditText('');
      loadMessages();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  // @autocomplete
  const [mentionQuery, setMentionQuery] = useState(null); // null o {text, position}
  const handleTextChange = (e) => {
    const value = e.target.value;
    setText(value);

    // Detectar @text al cursor
    const cursor = e.target.selectionStart;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/@([a-zA-Zàèéíòóúïüçñ0-9._-]*)$/i);
    if (match) {
      setMentionQuery({ text: match[1].toLowerCase(), startIdx: cursor - match[1].length - 1 });
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (name) => {
    if (!mentionQuery) return;
    const before = text.slice(0, mentionQuery.startIdx);
    const after = text.slice(mentionQuery.startIdx + mentionQuery.text.length + 1);
    const insert = `@${name.split(/\s+/)[0]} `;
    const newText = before + insert + after;
    setText(newText);
    setMentionQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + insert.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const mentionMatches = useMemo(() => {
    if (!mentionQuery || !members) return [];
    const q = mentionQuery.text;
    const list = members
      .filter(m => m.user)
      .filter(m => {
        const name = m.user.name.toLowerCase();
        return q === '' || name.includes(q) || name.split(/\s+/)[0].includes(q);
      })
      .slice(0, 6);
    return list;
  }, [mentionQuery, members]);

  return (
    <>
      {/* Header */}
      <header className="border-b p-3 flex items-center gap-3 bg-card flex-shrink-0">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold flex items-center gap-1.5 text-sm">
            <Hash size={14} className="text-muted-foreground" />
            <span className="truncate">{channel?.name || '...'}</span>
          </h2>
          {channel?.description && (
            <p className="text-xs text-muted-foreground truncate">{channel.description}</p>
          )}
        </div>
        <button
          onClick={() => setShowMembers(true)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 hover:bg-muted rounded"
        >
          <UsersIcon size={12} />
          {channel?.memberCount || members?.length || 0}
        </button>
      </header>

      {/* Missatges */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-1"
        onScroll={handleScroll}
      >
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            Cap missatge encara. Sigues el primer!
          </div>
        ) : (
          messages.map((m, idx) => {
            const prev = messages[idx - 1];
            const groupWithPrev = prev && prev.userId === m.userId
              && (new Date(m.createdAt) - new Date(prev.createdAt)) < 5 * 60 * 1000;
            return (
              <MessageItem
                key={m.id}
                message={m}
                groupWithPrev={groupWithPrev}
                isOwn={m.userId === currentUser?.id}
                isAdmin={currentUser?.role === 'ADMIN'}
                onEdit={() => handleStartEdit(m)}
                onDelete={() => handleDelete(m)}
                editing={editingId === m.id}
                editText={editText}
                onEditChange={setEditText}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={() => setEditingId(null)}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 bg-card relative flex-shrink-0">
        {attachment && (
          <div className="mb-2 flex items-center gap-2 bg-muted/50 rounded p-2 text-xs">
            <Paperclip size={12} />
            <span className="flex-1 truncate">{attachment.originalName}</span>
            <span className="text-muted-foreground">{(attachment.sizeBytes / 1024).toFixed(0)} KB</span>
            <button
              onClick={() => setAttachment(null)}
              className="text-muted-foreground hover:text-red-500"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* @autocomplete dropdown */}
        {mentionQuery && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {mentionMatches.map(m => (
              <button
                key={m.user.id}
                onClick={() => insertMention(m.user.name)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                  style={{ background: m.user.color || '#888' }}
                >
                  {m.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <span className="font-medium">{m.user.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded disabled:opacity-50"
            title="Adjuntar"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === 'Escape') setMentionQuery(null);
            }}
            placeholder={`Escriu a #${channel?.name || ''}...`}
            rows={1}
            className="flex-1 border rounded-lg px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-32"
            style={{ minHeight: 38 }}
          />
          <button
            onClick={handleSend}
            disabled={sending || (!text.trim() && !attachment)}
            className="p-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50 hover:opacity-90"
            title="Enviar"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Usa <code className="bg-muted px-1 rounded">@nom</code> per mencionar (envia notif Telegram). Enter envia, Shift+Enter salta línia.
        </p>
      </div>

      {showMembers && (
        <MembersModal
          channelId={channelId}
          isAdmin={currentUser?.role === 'ADMIN'}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}

// =============================================================
// MessageItem
// =============================================================
function MessageItem({
  message, groupWithPrev, isOwn, isAdmin,
  onEdit, onDelete, editing, editText, onEditChange, onSaveEdit, onCancelEdit,
}) {
  const time = new Date(message.createdAt).toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
  const initials = message.user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  const att = message.attachment;
  const isImage = att?.mimeType?.startsWith('image/');
  const isPdf = att?.mimeType === 'application/pdf';
  const sizeStr = att && (att.sizeBytes >= 1024 * 1024
    ? `${(att.sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `${(att.sizeBytes / 1024).toFixed(0)} KB`);

  const handleDownload = async (inline = false) => {
    try {
      const res = await api.get(`/chat/attachments/${att.id}/download${inline ? '?inline=1' : ''}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      if (inline) {
        window.open(url, '_blank');
        setTimeout(() => window.URL.revokeObjectURL(url), 30_000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = att.originalName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  // Render contingut amb mencions destacades
  const renderContent = () => {
    if (!message.content) return null;
    const parts = message.content.split(/(@[a-zA-Zàèéíòóúïüçñ0-9._-]+)/g);
    return parts.map((p, i) => {
      if (p.startsWith('@')) {
        return <span key={i} className="bg-primary/15 text-primary font-medium px-1 rounded">{p}</span>;
      }
      return <span key={i}>{p}</span>;
    });
  };

  return (
    <div className={`group hover:bg-muted/30 rounded px-2 py-0.5 ${groupWithPrev ? 'mt-0' : 'mt-3'}`}>
      <div className="flex gap-2.5">
        {!groupWithPrev ? (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0 mt-0.5"
            style={{ background: message.user?.color || '#888' }}
          >
            {initials}
          </div>
        ) : (
          <div className="w-8 flex-shrink-0 text-[10px] text-muted-foreground text-right pt-1 opacity-0 group-hover:opacity-100">
            {time}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {!groupWithPrev && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-semibold text-sm">{message.user?.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {time}
                {message.editedAt && <span className="ml-1">(editat)</span>}
              </span>
            </div>
          )}

          {editing ? (
            <div className="space-y-1">
              <textarea
                value={editText}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                  if (e.key === 'Escape') onCancelEdit();
                }}
                className="w-full border rounded p-2 text-sm bg-background"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={onSaveEdit} className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">Desar</button>
                <button onClick={onCancelEdit} className="text-xs text-muted-foreground hover:text-foreground">Cancel·lar</button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm whitespace-pre-wrap break-words">
                {renderContent()}
              </div>
              {att && (
                <div className="mt-1.5">
                  {isImage ? (
                    <button
                      onClick={() => handleDownload(true)}
                      className="block max-w-xs"
                    >
                      <img
                        src={`/api/chat/attachments/${att.id}/download?inline=1`}
                        alt={att.originalName}
                        className="rounded border max-h-64 object-cover hover:opacity-90 transition-opacity"
                      />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDownload(isPdf)}
                      className="inline-flex items-center gap-2 border rounded px-3 py-2 hover:bg-muted/50 max-w-xs text-left"
                    >
                      {isPdf ? <FileText size={16} className="text-red-500" /> : <Paperclip size={16} className="text-muted-foreground" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{att.originalName}</div>
                        <div className="text-[10px] text-muted-foreground">{sizeStr}</div>
                      </div>
                      <Download size={12} className="text-muted-foreground flex-shrink-0" />
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Accions: edit/delete (només propi/admin) */}
        {!editing && (isOwn || isAdmin) && (
          <div className="opacity-0 group-hover:opacity-100 flex items-start gap-0.5 pt-0.5">
            {isOwn && (
              <button
                onClick={onEdit}
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Editar"
              >
                <Edit2 size={11} />
              </button>
            )}
            <button
              onClick={onDelete}
              className="p-1 text-muted-foreground hover:text-red-500"
              title="Esborrar"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Crear canal (modal)
// =============================================================
function CreateChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const { data: users } = useApiGet('/users');
  const usersList = Array.isArray(users) ? users : (users?.users || []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/chat/channels', {
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds,
      });
      onCreated(res.data);
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleMember = (uid) => {
    setMemberIds(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-lg w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">Crear canal nou</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs font-medium block mb-1">Nom</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="general"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              maxLength={50}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Descripció (opcional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="De què va aquest canal?"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Membres ({memberIds.length})</label>
            <div className="border rounded max-h-48 overflow-y-auto">
              {usersList.filter(u => u.isActive !== false).map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                    style={{ background: u.color || '#888' }}
                  >
                    {u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <span>{u.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-3 py-1.5 hover:bg-muted rounded">Cancel·lar</button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded disabled:opacity-50"
          >
            {saving ? 'Creant...' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Members modal (amb pestanya Telegram bridge)
// =============================================================
function MembersModal({ channelId, isAdmin, onClose }) {
  const [tab, setTab] = useState('members');
  const { data: members, refetch } = useApiGet(`/chat/channels/${channelId}/members`);
  const { data: users } = useApiGet('/users');
  const usersList = Array.isArray(users) ? users : (users?.users || []);
  const [adding, setAdding] = useState(false);

  const memberIds = (members || []).map(m => m.userId);
  const availableUsers = usersList.filter(u => u.isActive !== false && !memberIds.includes(u.id));

  const handleAdd = async (uid) => {
    try {
      await api.post(`/chat/channels/${channelId}/members`, { userIds: [uid] });
      refetch();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };
  const handleRemove = async (uid) => {
    if (!confirm('Treure aquest membre del canal?')) return;
    try {
      await api.delete(`/chat/channels/${channelId}/members/${uid}`);
      refetch();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-lg w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Settings size={16} /> Configuració del canal
          </h2>
          <button onClick={onClose} className="text-muted-foreground"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setTab('members')}
            className={`flex-1 py-2 text-xs font-medium ${tab === 'members' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
          >
            <UsersIcon size={12} className="inline mr-1" /> Membres
          </button>
          <button
            onClick={() => setTab('telegram')}
            className={`flex-1 py-2 text-xs font-medium ${tab === 'telegram' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
          >
            <MessageCircle size={12} className="inline mr-1" /> Telegram
          </button>
        </div>

        {tab === 'members' && (
          <>
            <div className="p-3 space-y-1 overflow-y-auto flex-1">
              {(members || []).map(m => (
                <div key={m.userId} className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded text-sm">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ background: m.user?.color || '#888' }}
                  >
                    {m.user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <span className="flex-1">{m.user?.name}</span>
                  {m.role === 'ADMIN' && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">Admin</span>}
                  {isAdmin && (
                    <button
                      onClick={() => handleRemove(m.userId)}
                      className="text-muted-foreground hover:text-red-500 p-1"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {isAdmin && availableUsers.length > 0 && (
              <div className="border-t p-3">
                <button
                  onClick={() => setAdding(!adding)}
                  className="text-xs flex items-center gap-1 text-primary"
                >
                  <Plus size={12} /> Afegir membre
                </button>
                {adding && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {availableUsers.map(u => (
                      <button
                        key={u.id}
                        onClick={() => handleAdd(u.id)}
                        className="w-full flex items-center gap-2 p-1.5 text-sm hover:bg-muted/50 rounded"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                          style={{ background: u.color || '#888' }}
                        >
                          {u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span>{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'telegram' && (
          <TelegramBridgePanel channelId={channelId} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Telegram bridge — panel dins MembersModal
// =============================================================
function TelegramBridgePanel({ channelId, isAdmin }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await api.get(`/chat/channels/${channelId}/telegram-status`);
      setStatus(res.data);
    } catch (err) {
      console.error('Bridge status error:', err);
    } finally { setLoading(false); }
  }, [channelId]);

  useEffect(() => { reload(); }, [reload]);

  // Polling mentre hi ha codi pendent
  useEffect(() => {
    if (!status?.pendingCode || status.linked) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [status?.pendingCode, status?.linked, reload]);

  const handleStart = async () => {
    setPulling(true);
    try {
      await api.post(`/chat/channels/${channelId}/telegram-link/start`);
      reload();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally { setPulling(false); }
  };

  const handleUnlink = async () => {
    if (!confirm('Desvincular el grup de Telegram?')) return;
    try {
      await api.post(`/chat/channels/${channelId}/telegram-link/cancel`);
      reload();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const copy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div className="p-6 flex justify-center"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>;
  }

  if (!status?.enabled) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Telegram bot no està configurat al servidor.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto flex-1">
      {!isAdmin && (
        <p className="text-xs text-muted-foreground italic">
          Cal ser admin del canal per gestionar el bridge.
        </p>
      )}

      {status.linked && (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
          <p className="font-medium text-green-800">✓ Bridge actiu</p>
          {status.groupTitle && (
            <p className="text-xs text-green-700 mt-1">
              Grup vinculat: <strong>{status.groupTitle}</strong>
            </p>
          )}
          <p className="text-[11px] text-green-600 mt-2">
            Els missatges es repliquen entre l'app i el grup en les dues direccions.
          </p>
          {isAdmin && (
            <button
              onClick={handleUnlink}
              className="mt-3 text-xs text-red-600 hover:underline"
            >
              Desvincular grup
            </button>
          )}
        </div>
      )}

      {!status.linked && status.pendingCode && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <p className="text-xs text-amber-800 font-medium">Esperant la confirmació al grup de Telegram...</p>
            <p className="text-[11px] text-amber-700 mt-1">
              Caduca: {new Date(status.pendingExpires).toLocaleString('ca-ES')}
            </p>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-medium">Pasos:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Crea un grup a Telegram amb els membres del canal</li>
              <li>Afegeix el bot <code className="bg-muted px-1 rounded">@{status.botUsername}</code> al grup (com a <strong>admin</strong> recomanat, perquè llegeixi tots els missatges)</li>
              <li>Envia aquesta comanda al grup:</li>
            </ol>

            <div className="bg-muted/60 rounded p-2 flex items-center gap-2">
              <code className="flex-1 text-xs font-mono">/link {status.pendingCode}</code>
              <button
                onClick={() => copy(`/link ${status.pendingCode}`)}
                className="text-muted-foreground hover:text-foreground p-1"
                title="Copiar"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground italic">
              Quan el bot rebi la comanda, vincularà el grup automàticament.
            </p>
          </div>

          {isAdmin && (
            <button onClick={handleUnlink} className="text-xs text-muted-foreground hover:text-red-500">
              Cancel·lar codi pendent
            </button>
          )}
        </div>
      )}

      {!status.linked && !status.pendingCode && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Aquest canal encara no està vinculat amb cap grup de Telegram.
          </p>
          <p className="text-xs text-muted-foreground">
            El bridge replica missatges en les dues direccions: el que escriviu a l'app arriba al grup, i a l'inrevés.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
            <strong>⚠️ Requisit previ:</strong> al BotFather, desactiva el "Group Privacy" del bot
            (<code className="bg-amber-100 px-1 rounded">/mybots → @{status.botUsername} → Bot Settings → Group Privacy → Turn off</code>),
            o fes el bot admin del grup. Sense això, el bot només llegirà comandes <code className="bg-amber-100 px-1 rounded">/</code>.
          </div>
          {isAdmin && (
            <button
              onClick={handleStart}
              disabled={pulling}
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-3 py-2 rounded disabled:opacity-50"
            >
              {pulling ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
              Connectar grup Telegram
            </button>
          )}
        </div>
      )}
    </div>
  );
}
