import { useState } from 'react';
import { Plus, Bell, Check, Clock, Repeat, ExternalLink, FileCheck, FileX, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import { PriorityBadge } from '../components/shared/StatusBadge';
import Modal from '../components/shared/Modal';
import { formatDate, formatCurrency } from '../lib/utils';

const MONTH_NAMES = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];

export default function Reminders() {
  const [showCompleted, setShowCompleted] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', priority: 'NORMAL', recurrence: '' });

  // Navegació mensual per la checklist de recollida
  const now = new Date();
  const [collMonth, setCollMonth] = useState(now.getMonth() + 1);
  const [collYear, setCollYear] = useState(now.getFullYear());

  const { data, loading, refetch } = useApiGet('/reminders', { completed: showCompleted ? undefined : 'false', limit: 50 });
  const { data: pendingData } = useApiGet('/reminders/pending');
  const { data: collectionData } = useApiGet('/reminders/invoice-collection', { year: collYear, month: collMonth });
  const { mutate } = useApiMutation();

  const prevMonth = () => {
    if (collMonth === 1) { setCollMonth(12); setCollYear(collYear - 1); }
    else setCollMonth(collMonth - 1);
  };
  const nextMonth = () => {
    if (collMonth === 12) { setCollMonth(1); setCollYear(collYear + 1); }
    else setCollMonth(collMonth + 1);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', '/reminders', {
        ...form,
        dueAt: new Date(form.dueAt).toISOString(),
        recurrence: form.recurrence || null,
        mentionUserIds: [],
      });
      setShowModal(false);
      setForm({ title: '', description: '', dueAt: '', priority: 'NORMAL', recurrence: '' });
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
    <div className="p-6">
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

      {/* Checklist recollida mensual de factures */}
      {collectionData?.total > 0 && (
        <div className="bg-card border rounded-lg mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck size={18} className="text-amber-500" />
              <h3 className="font-semibold">Recollida mensual de factures</h3>
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                {collectionData.collected}/{collectionData.total}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-muted"><ChevronLeft size={16} /></button>
              <span className="text-sm font-medium min-w-[120px] text-center">
                {MONTH_NAMES[collMonth - 1]} {collYear}
              </span>
              <button onClick={nextMonth} className="p-1 rounded hover:bg-muted"><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="divide-y">
            {collectionData.suppliers.map((s) => (
              <div key={s.id} className={`p-3 flex items-center gap-3 ${s.collected ? 'bg-green-50/30' : ''}`}>
                <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${s.collected ? 'bg-green-500 border-green-500 text-white' : 'border-muted-foreground/40'}`}>
                  {s.collected && <Check size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-sm ${s.collected ? 'text-green-700' : ''}`}>{s.name}</span>
                    {s.collected ? (
                      <span className="text-xs text-green-600">
                        {s.invoices.map((inv) => `${inv.invoiceNumber} — ${formatCurrency(inv.totalAmount)}`).join(', ')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <FileX size={12} /> Pendent
                      </span>
                    )}
                  </div>
                </div>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-blue-50 text-blue-600 flex-shrink-0" title="Obrir web del proveïdor">
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                  {r.recurrence && (
                    <span className="flex items-center gap-1 text-blue-600">
                      <Repeat size={12} />
                      {{ DAILY: 'Diari', WEEKLY: 'Setmanal', MONTHLY: 'Mensual', QUARTERLY: 'Trimestral', YEARLY: 'Anual' }[r.recurrence]}
                    </span>
                  )}
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
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Recurrència</label>
              <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">Cap (una sola vegada)</option>
                <option value="DAILY">Diari</option>
                <option value="WEEKLY">Setmanal</option>
                <option value="MONTHLY">Mensual</option>
                <option value="QUARTERLY">Trimestral</option>
                <option value="YEARLY">Anual</option>
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
