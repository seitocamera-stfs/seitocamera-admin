import { useState } from 'react';
import { Plus, Edit2, Trash2, Key, ShieldCheck, ShieldAlert, Eye } from 'lucide-react';
import { useApiGet, useApiMutation } from '../hooks/useApi';
import Modal from '../components/shared/Modal';
import { formatDate } from '../lib/utils';
import useAuthStore from '../stores/authStore';

const roleConfig = {
  ADMIN: { label: 'Administrador', icon: ShieldAlert, className: 'bg-red-100 text-red-800', description: 'Accés total: crear usuaris, eliminar, configurar' },
  EDITOR: { label: 'Comptable', icon: ShieldCheck, className: 'bg-blue-100 text-blue-800', description: 'Crear i editar factures, proveïdors, clients. No pot eliminar ni gestionar usuaris.' },
  VIEWER: { label: 'Col·laborador', icon: Eye, className: 'bg-gray-100 text-gray-800', description: 'Només lectura. Pot afegir notes i recordatoris.' },
};

export default function Users() {
  const currentUser = useAuthStore((s) => s.user);
  const [showModal, setShowModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'VIEWER' });
  const [newPassword, setNewPassword] = useState('');

  const { data: users, loading, refetch } = useApiGet('/users');
  const { mutate } = useApiMutation();

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await mutate('put', `/users/${editing}`, { name: form.name, role: form.role, isActive: form.isActive });
      } else {
        await mutate('post', '/users', form);
      }
      setShowModal(false);
      setEditing(null);
      refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = (user) => {
    setEditing(user.id);
    setForm({ name: user.name, email: user.email, role: user.role, isActive: user.isActive });
    setShowModal(true);
  };

  const handleDeactivate = async (id) => {
    if (!confirm('Desactivar aquest usuari?')) return;
    await mutate('delete', `/users/${id}`);
    refetch();
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    try {
      await mutate('post', `/users/${showResetModal}/reset-password`, { newPassword });
      setShowResetModal(null);
      setNewPassword('');
      alert('Contrasenya actualitzada');
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Gestió d'usuaris</h2>
        <button onClick={() => { setEditing(null); setForm({ name: '', email: '', password: '', role: 'VIEWER' }); setShowModal(true); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
          <Plus size={16} /> Nou usuari
        </button>
      </div>

      {/* Explicació de rols */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {Object.entries(roleConfig).map(([key, config]) => (
          <div key={key} className="bg-card border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
                {config.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{config.description}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Nom</th>
              <th className="text-left p-3 font-medium">Email</th>
              <th className="text-center p-3 font-medium">Rol</th>
              <th className="text-center p-3 font-medium">Estat</th>
              <th className="text-left p-3 font-medium">Últim login</th>
              <th className="text-right p-3 font-medium">Accions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Carregant...</td></tr>
            ) : (
              users?.map((u) => {
                const role = roleConfig[u.role] || {};
                return (
                  <tr key={u.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">{u.name} {u.id === currentUser?.id && <span className="text-xs text-muted-foreground">(tu)</span>}</td>
                    <td className="p-3 text-muted-foreground">{u.email}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${role.className}`}>
                        {role.label}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {u.isActive ? 'Actiu' : 'Inactiu'}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Mai'}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(u)} className="p-1.5 rounded hover:bg-muted" title="Editar"><Edit2 size={14} /></button>
                        <button onClick={() => setShowResetModal(u.id)} className="p-1.5 rounded hover:bg-muted" title="Resetejar contrasenya"><Key size={14} /></button>
                        {u.id !== currentUser?.id && (
                          <button onClick={() => handleDeactivate(u.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="Desactivar"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal crear/editar */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar usuari' : 'Nou usuari'}>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nom *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
          </div>
          {!editing && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contrasenya * (mínim 8 caràcters)</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required minLength={8} />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Rol *</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
              <option value="ADMIN">Administrador — accés total</option>
              <option value="EDITOR">Comptable — crear/editar, no eliminar</option>
              <option value="VIEWER">Col·laborador — només lectura + notes</option>
            </select>
          </div>
          {editing && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
                Compte actiu
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Guardar</button>
          </div>
        </form>
      </Modal>

      {/* Modal resetejar contrasenya */}
      <Modal isOpen={!!showResetModal} onClose={() => setShowResetModal(null)} title="Resetejar contrasenya" size="sm">
        <form onSubmit={handleResetPassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nova contrasenya *</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" required minLength={8} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowResetModal(null)} className="px-4 py-2 rounded-md border text-sm">Cancel·lar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Resetejar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
