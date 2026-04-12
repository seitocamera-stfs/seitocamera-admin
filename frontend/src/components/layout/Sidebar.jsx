import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileInput,
  FileOutput,
  Truck,
  Users,
  Landmark,
  GitCompare,
  Bell,
  Settings,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/invoices/received', icon: FileInput, label: 'Factures rebudes' },
  { to: '/invoices/issued', icon: FileOutput, label: 'Factures emeses' },
  { to: '/suppliers', icon: Truck, label: 'Proveïdors' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/bank', icon: Landmark, label: 'Moviments bancaris' },
  { to: '/conciliation', icon: GitCompare, label: 'Conciliació' },
  { to: '/reminders', icon: Bell, label: 'Recordatoris' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 border-r bg-card flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-primary">
          SeitoCamera
        </h1>
        <p className="text-xs text-muted-foreground mt-1">Panel d'administració</p>
      </div>

      {/* Navegació */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t">
        <NavLink
          to="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
        >
          <Settings size={18} />
          Configuració
        </NavLink>
      </div>
    </aside>
  );
}
