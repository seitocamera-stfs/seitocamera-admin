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
      <main className="flex-1 overflow-auto min-w-0" style={{ background: '#f8f9fa' }}>
        <Outlet />
      </main>
    </div>
  );
}
