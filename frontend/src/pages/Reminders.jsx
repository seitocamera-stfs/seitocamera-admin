import { useState } from 'react';
import { Plus, Bell, Check, Clock } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { PriorityBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatDate } from '../lib/utils';

export default function Reminders() {
  const [showCompleted, setShowCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', priority: 'NORMAL' });

  const { data, loading, refetch } = useApiGet('/reminders', { completed: showCompleted ? undefined : 'false', limit: 50 });
  const { data: pendingData } = useApiGet('/reminders/pending');
  const { mutate } = useApiMutation();

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', '/reminders', {
        ...form,
        dueAt: new Date(form.dueAt).toISOString(),
        mentionUserIds: [],
      });
      setShowModal(false);
      setForm({ title: '', description: '', dueAt: '', priority: 'NORMAL' });
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleComplete = async (id) => {
    await mutate('patch', `/reminders/${id}/complete`);
    refetch();
  };

  const isOverdue = (dueAt) => new Date(dueAt) < new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Recordatoris</h2>
          {pendingData?.count > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingData.count} pendents
            </span>
          )}
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus size={16} /> Nou recordatori
        </button>
      </div>

      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} className="rounded" />
          Mostrar completats
        </label>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Carregant...</div>
        ) : data?.data?.length === 0 ? (
          <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">Cap recordatori trobat</div>
        ) : (
          data?.data?.map((r) => (
            <div key={r.id} className={`bg-card border rounded-lg p-4 flex items-start gap-3 ${r.isCompleted ? 'opacity-50' : ''}`}>
              <button
                onClick={() => !r.isCompleted && handleComplete(r.id)}
                className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${r.isCompleted ? 'bg-green-500 border-green-500 text-white' : 'border-muted-foreground hover:border-green-500'}`}
              >
                {r.isCompleted && <Check size={12} />}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-medium ${r.isCompleted ? 'line-through' : ''}`}>{r.title}</span>
                  <PriorityBadge priority={r.priority} />
                </div>
                {r.description && <p className="text-sm text-muted-foreground mb-1">{r.description}</p>}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className={`flex items-center gap-1 ${!r.isCompleted && isOverdue(r.dueAt) ? 'text-red-500 font-medium' : ''}`}>
                    <Clock size={12} />
                    {formatDate(r.dueAt)}
                    {!r.isCompleted && isOverdue(r.dueAt) && ' (vençut)'}
                  </span>
                  {r.mentions?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Bell size={12} />
                      {r.mentions.map((m) => m.user.name).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nou recordatori">
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Títol *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Descripció</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Data/hora venciment *</label>
              <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Prioritat</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="LOW">Baixa</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
