import { useState } from 'react';
import {
  ShieldCheck, User, Users, Phone, Warehouse, Package,
  Wrench, Shield, Loader2, Plus, X, Check,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const ROLE_ICONS = {
  ADMIN_COORDINATION: Phone,
  WAREHOUSE_LEAD: Warehouse,
  WAREHOUSE_SUPPORT: Package,
  TECH_LEAD: Wrench,
  INTERN_SUPPORT: User,
  GENERAL_MANAGER: Shield,
};

const PERMISSION_LABELS = {
  projects: 'Projectes',
  incidents: 'Incidències',
  protocols: 'Protocols',
  daily_plan: 'Pla del dia',
  roles: 'Rols',
  equipment_blocking: 'Bloqueig equips',
};

const LEVEL_LABELS = {
  NONE: 'Cap', VIEW_ONLY: 'Veure', OPERATE: 'Operar', MANAGE: 'Gestionar', FULL_ADMIN: 'Admin',
};
const LEVEL_COLORS = {
  NONE: 'bg-gray-100 text-gray-500', VIEW_ONLY: 'bg-blue-50 text-blue-600',
  OPERATE: 'bg-green-50 text-green-600', MANAGE: 'bg-amber-50 text-amber-700',
  FULL_ADMIN: 'bg-red-50 text-red-600',
};

export default function Roles() {
  const { data: roles, loading, error, refetch } = useApiGet('/operations/roles');
  const { data: allUsers } = useApiGet('/users');
  const [assigning, setAssigning] = useState(null); // roleId
  const [selectedUser, setSelectedUser] = useState('');

  const handleAssign = async (roleId) => {
    if (!selectedUser) return;
    try {
      await api.post(`/operations/roles/${roleId}/assign`, { userId: selectedUser });
      setAssigning(null);
      setSelectedUser('');
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Error assignant');
    }
  };

  const handleUnassign = async (assignmentId) => {
    if (!confirm('Desassignar aquesta persona del rol?')) return;
    try {
      await api.delete(`/operations/role-assignments/${assignmentId}`);
      refetch();
    } catch (err) {
      alert('Error desassignant');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  const users = allUsers?.users || allUsers || [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <ShieldCheck size={28} className="text-primary" />
        <h1 className="text-2xl font-bold">Rols i Personal</h1>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>}

      {/* Cards de rols */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {roles?.map(role => {
          const RoleIcon = ROLE_ICONS[role.code] || User;
          return (
            <div key={role.id} className="bg-card border rounded-lg overflow-hidden">
              {/* Capçalera */}
              <div className="p-4 border-b" style={{ borderTopColor: role.color, borderTopWidth: 4 }}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${role.color}15`, color: role.color }}>
                    <RoleIcon size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{role.name}</h3>
                    <p className="text-xs text-muted-foreground">{role.shortName}</p>
                  </div>
                </div>
                {role.description && (
                  <p className="text-xs text-muted-foreground mt-2">{role.description}</p>
                )}
              </div>

              {/* Persones assignades */}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Persones assignades</span>
                  <button onClick={() => setAssigning(assigning === role.id ? null : role.id)}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Plus size={12} /> Assignar
                  </button>
                </div>

                {assigning === role.id && (
                  <div className="flex gap-2">
                    <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}
                      className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-background">
                      <option value="">— Seleccionar —</option>
                      {users.filter(u => u.isActive !== false).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <button onClick={() => handleAssign(role.id)}
                      className="bg-primary text-primary-foreground p-1.5 rounded-md"><Check size={16} /></button>
                    <button onClick={() => { setAssigning(null); setSelectedUser(''); }}
                      className="p-1.5 rounded-md hover:bg-accent"><X size={16} /></button>
                  </div>
                )}

                {role.assignments?.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Cap persona assignada</p>
                ) : (
                  role.assignments?.map(a => (
                    <div key={a.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-muted-foreground" />
                        <span className="font-medium">{a.user.name}</span>
                        {a.isPrimary && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Principal</span>}
                      </div>
                      <button onClick={() => handleUnassign(a.id)}
                        className="text-xs text-muted-foreground hover:text-red-600"><X size={14} /></button>
                    </div>
                  ))
                )}
              </div>

              {/* Responsabilitats */}
              <div className="p-4 border-t space-y-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Responsabilitats</span>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                  {(role.responsibilities || []).map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-1 w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Limitacions */}
              {role.limitations?.length > 0 && (
                <div className="p-4 border-t bg-red-50/50 space-y-1">
                  <span className="text-xs font-semibold text-red-600 uppercase">Limitacions</span>
                  <ul className="text-xs text-red-600/80 space-y-0.5">
                    {role.limitations.map((l, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <X size={10} className="mt-0.5 flex-shrink-0" />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Matriu de permisos */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2"><Shield size={18} /> Matriu de Permisos</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Secció</th>
                {roles?.map(r => (
                  <th key={r.id} className="text-center p-3 font-medium whitespace-nowrap">{r.shortName}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {Object.entries(PERMISSION_LABELS).map(([section, label]) => (
                <tr key={section}>
                  <td className="p-3 font-medium">{label}</td>
                  {roles?.map(r => {
                    const perm = r.permissions?.find(p => p.section === section);
                    const level = perm?.level || 'NONE';
                    return (
                      <td key={r.id} className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs ${LEVEL_COLORS[level]}`}>
                          {LEVEL_LABELS[level]}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
