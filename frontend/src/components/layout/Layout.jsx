import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import useCompanyStore from '../../stores/companyStore';

export default function Layout() {
  const fetchCompany = useCompanyStore((s) => s.fetchCompany);
  const appName = useCompanyStore((s) => s.appName);
  useEffect(() => { fetchCompany(); }, []);
  useEffect(() => { document.title = appName; }, [appName]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
