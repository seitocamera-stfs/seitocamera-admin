import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import useCompanyStore from '../../stores/companyStore';
import { Menu } from 'lucide-react';

export default function Layout() {
  const fetchCompany = useCompanyStore((s) => s.fetchCompany);
  const appName = useCompanyStore((s) => s.appName);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { fetchCompany(); }, []);
  useEffect(() => { document.title = appName; }, [appName]);

  // Tancar sidebar automàticament quan canvia de pàgina (mòbil)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  return (
    <div className="flex h-screen bg-background overflow-x-hidden">
      {/* Overlay mòbil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: fix a mòbil, estàtic a desktop */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-60 transform transition-transform duration-200 ease-in-out
        lg:relative lg:translate-x-0 lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Contingut principal */}
      <main className="flex-1 overflow-auto min-w-0" style={{ background: '#f8f9fa' }}>
        {/* Barra superior mòbil amb hamburger + notificacions */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-3 py-2 border-b bg-white">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-gray-100 active:bg-gray-200"
          >
            <Menu size={20} className="text-gray-700" />
          </button>
          <span className="text-sm font-semibold text-gray-800 tracking-wide flex-1">SEITO</span>
          <NotificationBell />
        </div>

        {/* Barra de notificacions desktop (fixada dalt a la dreta) */}
        <div className="hidden lg:flex fixed top-3 right-4 z-30">
          <NotificationBell />
        </div>

        <Outlet />
      </main>
    </div>
  );
}
