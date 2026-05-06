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
  Building2,
  BookText,
  History,
  ClipboardEdit,
  ScrollText,
  Scale,
  Receipt,
  Boxes,
  CalendarClock,
  FileLock,
  Layers,
  TrendingUp,
  Sparkles,
  Crown,
  Map,
  Warehouse,
  LineChart,
} from 'lucide-react';
import useAuthStore from '../../stores/authStore';
import useCompanyStore from '../../stores/companyStore';
import { canAccessSection } from '../../lib/permissions';
import { useAgentEnabled } from '../../hooks/useAgentToggles';
import { useMarketingStatus } from '../../hooks/useMarketingStatus';

// ===========================================
// Seccions del sidebar
// ===========================================

const sections = [
  {
    key: 'home',
    label: 'Inici',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', section: 'dashboard' },
      { to: '/warehouse/agent', icon: Warehouse, label: 'Magatzem IA', section: 'agent', requiresAgent: 'warehouse_agent' },
    ],
  },
  {
    key: 'operations',
    label: 'Operacions',
    items: [
      { to: '/operations/calendar', icon: Calendar, label: 'Calendari', section: 'operations' },
      { to: '/operations/projects', icon: Package, label: 'Projectes', section: 'operations' },
      { to: '/operations/tasks', icon: ListTodo, label: 'Tasques', section: 'operations' },
      { to: '/operations/incidents', icon: AlertTriangle, label: 'Incidències', section: 'operations' },
      { to: '/operations/protocols', icon: BookOpen, label: 'Protocols', section: 'operations' },
      { to: '/operations/roles', icon: ShieldCheck, label: 'Rols i personal', section: 'operations' },
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
    key: 'invoicing',
    label: 'Facturació i Banc',
    items: [
      { to: '/invoices/received', icon: FileInput, label: 'Factures rebudes', section: 'receivedInvoices' },
      { to: '/invoices/issued', icon: FileOutput, label: 'Factures emeses', section: 'issuedInvoices' },
      { to: '/invoices/shared', icon: Split, label: 'Compartides Seito↔Logistik', section: 'sharedInvoices' },
      { to: '/bank', icon: Landmark, label: 'Moviments bancaris', section: 'bank' },
      { to: '/conciliation', icon: GitCompare, label: 'Conciliació', section: 'conciliation' },
      { to: '/reminders', icon: Bell, label: 'Recordatoris cobrament', section: 'reminders' },
    ],
  },
  {
    key: 'accounting',
    label: 'Comptabilitat',
    items: [
      { to: '/accounting', icon: Coins, label: 'Resum comptable', section: 'fiscal' },
      { to: '/journal', icon: ClipboardEdit, label: 'Llibre diari', section: 'accounting' },
      { to: '/ledger', icon: ScrollText, label: 'Llibre major', section: 'accounting' },
      { to: '/trial-balance', icon: Scale, label: 'Sumes i saldos', section: 'accounting' },
      { to: '/fixed-assets', icon: Boxes, label: 'Immobilitzat', section: 'accounting' },
      { to: '/amortization-calendar', icon: CalendarClock, label: 'Amortitzacions', section: 'accounting' },
      { to: '/balance-sheet', icon: Layers, label: 'Balanç de situació', section: 'accounting' },
      { to: '/profit-loss', icon: TrendingUp, label: 'Compte P&G', section: 'accounting' },
    ],
  },
  {
    key: 'fiscal',
    label: 'Fiscal',
    items: [
      { to: '/fiscal', icon: Calculator, label: 'Models AEAT', section: 'fiscal' },
      { to: '/vat-books', icon: Receipt, label: 'Llibres IVA i IRPF', section: 'fiscal' },
    ],
  },
  {
    key: 'agent',
    label: 'Agent IA',
    items: [
      { to: '/ceo', icon: Crown, label: 'CEO IA', section: 'agent' },
      { to: '/gestor', icon: Sparkles, label: 'Gestor IA', section: 'agent' },
      { to: '/marketing/runs', icon: Sparkles, label: 'Marketing AI · Runs', section: 'agent', requiresFeature: 'marketing' },
      { to: '/marketing/settings', icon: Settings, label: 'Marketing AI · Context', section: 'agent', requiresFeature: 'marketing' },
    ],
  },
  {
    key: 'partners',
    label: 'Tercers i Inventari',
    items: [
      { to: '/suppliers', icon: Truck, label: 'Proveïdors', section: 'suppliers' },
      { to: '/clients', icon: Users, label: 'Clients', section: 'clients' },
      { to: '/equipment', icon: Camera, label: 'Inventari equips', section: 'equipment' },
    ],
  },
  {
    key: 'company',
    label: 'Empresa',
    items: [
      { to: '/company/settings', icon: Building2, label: 'Dades fiscals', section: 'accounting' },
      { to: '/company/fiscal-years', icon: Calendar, label: 'Exercicis comptables', section: 'accounting' },
      { to: '/company/chart-of-accounts', icon: BookText, label: 'Pla de comptes', section: 'accounting' },
      { to: '/supplier-mapping', icon: Map, label: 'Mapatge proveïdors', section: 'accounting' },
      { to: '/year-closing', icon: FileLock, label: 'Tancament d\'exercici', section: 'accounting' },
    ],
  },
  {
    key: 'admin',
    label: 'Administració',
    items: [
      { to: '/users', icon: UserCog, label: 'Usuaris', section: 'users' },
      { to: '/user-activity', icon: LineChart, label: 'Activitat usuaris', section: null, adminOnly: true },
      { to: '/agent/supervisor', icon: Activity, label: 'Supervisor jobs IA', section: 'agent' },
      { to: '/agent/rules', icon: Brain, label: 'Regles agent', section: 'agent' },
      { to: '/settings/connections', icon: Plug, label: 'Connexions', section: null, adminOnly: true },
      { to: '/ai-costs', icon: BrainCircuit, label: 'Costos IA', section: null, adminOnly: true },
      { to: '/audit-log', icon: History, label: 'Auditoria', section: 'audit' },
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
  const { enabled: warehouseAgentEnabled } = useAgentEnabled('warehouse_agent');
  const { enabled: marketingEnabled } = useMarketingStatus();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const agentToggles = { warehouse_agent: warehouseAgentEnabled };
  const featureToggles = { marketing: marketingEnabled };

  const isVisible = (item) => {
    if (item.adminOnly && user?.role !== 'ADMIN') return false;
    if (item.section && !canAccessSection(user, item.section)) return false;
    if (item.requiresAgent && agentToggles[item.requiresAgent] === false) return false;
    if (item.requiresFeature && featureToggles[item.requiresFeature] === false) return false;
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
          <button
            onClick={() => navigate('/profile')}
            className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-90 transition-opacity"
            title="Perfil i notificacions"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium text-white"
              style={{ background: 'rgba(255,255,255,0.2)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[11px] font-medium text-white truncate">{user?.name}</div>
              <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{user?.role}</div>
            </div>
          </button>
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
