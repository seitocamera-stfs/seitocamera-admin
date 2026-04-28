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
  Calculator,
  Plug,
  ClipboardList,
  CalendarDays,
  Package,
  AlertTriangle,
  BookOpen,
  ShieldCheck,
  ListTodo,
  Coins,
  FolderCog,
  Settings,
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
    icon: ClipboardList,
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', section: 'dashboard' },
      { to: '/operations/daily', icon: CalendarDays, label: 'Pla del Dia' },
      { to: '/operations/calendar', icon: CalendarDays, label: 'Calendari' },
      { to: '/operations/projects', icon: Package, label: 'Projectes' },
      { to: '/operations/tasks', icon: ListTodo, label: 'Tasques' },
      { to: '/operations/incidents', icon: AlertTriangle, label: 'Incidències' },
      { to: '/operations/protocols', icon: BookOpen, label: 'Protocols' },
    ],
  },
  {
    key: 'accounting',
    label: 'Comptabilitat',
    icon: Coins,
    items: [
      { to: '/invoices/received', icon: FileInput, label: 'Factures rebudes', section: 'receivedInvoices' },
      { to: '/invoices/issued', icon: FileOutput, label: 'Factures emeses', section: 'issuedInvoices' },
      { to: '/invoices/shared', icon: Split, label: 'Compartides', section: 'sharedInvoices' },
      { to: '/bank', icon: Landmark, label: 'Moviments bancaris', section: 'bank' },
      { to: '/conciliation', icon: GitCompare, label: 'Conciliació', section: 'conciliation' },
      { to: '/fiscal', icon: Calculator, label: 'Fiscal', section: 'fiscal' },
      { to: '/reminders', icon: Bell, label: 'Recordatoris', section: 'reminders' },
      { to: '/agent', icon: Bot, label: 'Agent comptable', section: 'agent' },
    ],
  },
  {
    key: 'management',
    label: 'Gestió',
    icon: FolderCog,
    items: [
      { to: '/suppliers', icon: Truck, label: 'Proveïdors', section: 'suppliers' },
      { to: '/clients', icon: Users, label: 'Clients', section: 'clients' },
      { to: '/equipment', icon: Camera, label: 'Inventari equips', section: 'equipment' },
      { to: '/operations/roles', icon: ShieldCheck, label: 'Rols i Personal' },
    ],
  },
  {
    key: 'admin',
    label: 'Administració',
    icon: Settings,
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

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  }`;

export default function Sidebar() {
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

  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary">
          {companyName}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Panel d'administració</p>
      </div>

      {/* Navegació */}
      <nav className="flex-1 p-4 overflow-y-auto">
        {sections.map((section, idx) => {
          const visibleItems = section.items.filter(isVisible);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.key} className={idx > 0 ? 'pt-4 mt-4 border-t' : ''}>
              <p className="px-3 py-1 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <section.icon size={14} />
                {section.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
                    <Icon size={18} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t space-y-1">
        {user && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {user.name} ({user.role})
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={18} />
          Tancar sessió
        </button>
      </div>
    </aside>
  );
}
