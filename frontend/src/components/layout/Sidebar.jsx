import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FileInput,
  FileOutput,
  Split,
  Truck,
  Users,
  Landmark,
  GitCompare,
  Bell,
  LogOut,
  UserCog,
  Bot,
  Camera,
  BrainCircuit,
  Brain,
  Calculator,
  Plug,
  Package,
  AlertTriangle,
  BookOpen,
  ShieldCheck,
  ListTodo,
  Coins,
  FolderCog,
  Settings,
  Calendar,
  Activity,
  CalendarOff,
  X,
  ClipboardList,
  Timer,
} from 'lucide-react';
import useAuthStore from '../../stores/authStore';
import useCompanyStore from '../../stores/companyStore';
import { canAccessSection } from '../../lib/permissions';

// ===========================================
// Seccions del sidebar
// ===========================================

const sections = [
  {
    key: 'operations',
    label: 'Operacions',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', section: 'dashboard' },
      { to: '/operations/calendar', icon: Calendar, label: 'Calendari', section: 'operations' },
      { to: '/operations/projects', icon: Package, label: 'Projectes', section: 'operations' },
      { to: '/operations/tasks', icon: ListTodo, label: 'Tasques', section: 'operations' },
      { to: '/operations/incidents', icon: AlertTriangle, label: 'Incidències', section: 'operations' },
      { to: '/operations/protocols', icon: BookOpen, label: 'Protocols', section: 'operations' },
    ],
  },
  {
    key: 'team',
    label: 'Equip',
    items: [
      { to: '/team/clock', icon: Timer, label: 'Control horari', section: 'operations' },
      { to: '/team/entries', icon: ClipboardList, label: 'Registres horaris', section: 'operations' },
      { to: '/team/absences', icon: CalendarOff, label: 'Absències', section: 'operations' },
    ],
  },
  {
    key: 'logistics',
    label: 'Logística',
    items: [
      { to: '/logistics', icon: Truck, label: 'Transports', section: 'logistics' },
    ],
  },
  {
    key: 'accounting',
    label: 'Comptabilitat',
    items: [
      { to: '/accounting', icon: Coins, label: 'Resum comptable', section: 'fiscal' },
      { to: '/invoices/received', icon: FileInput, label: 'Factures rebudes', section: 'receivedInvoices' },
      { to: '/invoices/issued', icon: FileOutput, label: 'Factures emeses', section: 'issuedInvoices' },
      { to: '/invoices/shared', icon: Split, label: 'Compartides', section: 'sharedInvoices' },
      { to: '/bank', icon: Landmark, label: 'Moviments bancaris', section: 'bank' },
      { to: '/conciliation', icon: GitCompare, label: 'Conciliació', section: 'conciliation' },
      { to: '/fiscal', icon: Calculator, label: 'Fiscal', section: 'fiscal' },
      { to: '/reminders', icon: Bell, label: 'Recordatoris', section: 'reminders' },
      { to: '/agent', icon: Bot, label: 'Agent comptable', section: 'agent' },
      { to: '/agent/rules', icon: Brain, label: 'Regles agent', section: 'agent' },
      { to: '/agent/supervisor', icon: Activity, label: 'Supervisor agent', section: 'agent' },
    ],
  },
  {
    key: 'management',
    label: 'Gestió',
    items: [
      { to: '/suppliers', icon: Truck, label: 'Proveïdors', section: 'suppliers' },
      { to: '/clients', icon: Users, label: 'Clients', section: 'clients' },
      { to: '/equipment', icon: Camera, label: 'Inventari equips', section: 'equipment' },
      { to: '/operations/roles', icon: ShieldCheck, label: 'Rols i personal', section: 'operations' },
    ],
  },
  {
    key: 'admin',
    label: 'Administració',
    items: [
      { to: '/users', icon: UserCog, label: 'Usuaris', section: 'users' },
      { to: '/settings/connections', icon: Plug, label: 'Connexions', section: null, adminOnly: true },
      { to: '/ai-costs', icon: BrainCircuit, label: 'Costos IA', section: null, adminOnly: true },
    ],
  },
];

// ===========================================
// Component
// ===========================================

export default function Sidebar({ onClose }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const companyName = useCompanyStore((s) => s.name);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isVisible = (item) => {
    if (item.adminOnly && user?.role !== 'ADMIN') return false;
    if (item.section && !canAccessSection(user, item.section)) return false;
    return true;
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  return (
    <aside
      className="w-60 h-full flex flex-col flex-shrink-0"
      style={{ background: 'var(--seito-sidebar)' }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center gap-3">
          {/* Logo SC simplificat */}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/15 text-white font-semibold text-sm tracking-wider">
            SC
          </div>
          <div className="flex-1">
            <div className="text-white font-medium text-sm tracking-widest">SEITO</div>
            <div className="text-[9px] tracking-[3px]" style={{ color: 'rgba(255,255,255,0.5)' }}>CAMERA</div>
          </div>
          {/* Botó tancar (mòbil) */}
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden p-2 -mr-2 rounded-lg hover:bg-white/10 active:bg-white/20"
            >
              <X size={18} className="text-white/60" />
            </button>
          )}
        </div>
      </div>

      {/* Navegació */}
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {sections.map((section, idx) => {
          const visibleItems = section.items.filter(isVisible);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.key} className={idx > 0 ? 'mt-5' : ''}>
              <p
                className="px-3 py-1.5 text-[9px] font-medium uppercase tracking-[1.5px]"
                style={{ color: 'rgba(255,255,255,0.4)' }}
              >
                {section.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2.5 lg:py-[7px] rounded-md text-[13px] lg:text-[12px] transition-all ${
                        isActive
                          ? 'font-medium'
                          : 'hover:bg-white/[0.08] active:bg-white/[0.12]'
                      }`
                    }
                    style={({ isActive }) => ({
                      color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                      background: isActive ? 'rgba(255,255,255,0.18)' : undefined,
                    })}
                  >
                    <Icon size={16} style={{ opacity: 0.85 }} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer usuari */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium text-white"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-white truncate">{user?.name}</div>
            <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{user?.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-md hover:bg-white/10 active:bg-white/20 transition-colors"
            title="Tancar sessió"
          >
            <LogOut size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>
      </div>
    </aside>
  );
}
