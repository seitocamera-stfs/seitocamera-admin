import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/shared/ProtectedRoute';
import RoleGuard from './components/shared/RoleGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Suppliers from './pages/Suppliers';
import Clients from './pages/Clients';
import ReceivedInvoices from './pages/ReceivedInvoices';
import IssuedInvoices from './pages/IssuedInvoices';
import BankMovements from './pages/BankMovements';
import Conciliation from './pages/Conciliation';
import Reminders from './pages/Reminders';
import Users from './pages/Users';
import AccountingAgent from './pages/AccountingAgent';
import Equipment from './pages/Equipment';
import AiCosts from './pages/AiCosts';
import useAuthStore from './stores/authStore';

function App() {
  const fetchUser = useAuthStore((s) => s.fetchUser);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="invoices/received" element={<RoleGuard section="receivedInvoices"><ReceivedInvoices /></RoleGuard>} />
        <Route path="invoices/issued" element={<RoleGuard section="issuedInvoices"><IssuedInvoices /></RoleGuard>} />
        <Route path="suppliers" element={<RoleGuard section="suppliers"><Suppliers /></RoleGuard>} />
        <Route path="clients" element={<RoleGuard section="clients"><Clients /></RoleGuard>} />
        <Route path="bank" element={<RoleGuard section="bank"><BankMovements /></RoleGuard>} />
        <Route path="conciliation" element={<RoleGuard section="conciliation"><Conciliation /></RoleGuard>} />
        <Route path="reminders" element={<RoleGuard section="reminders"><Reminders /></RoleGuard>} />
        <Route path="users" element={<RoleGuard section="users"><Users /></RoleGuard>} />
        <Route path="agent" element={<AccountingAgent />} />
        <Route path="equipment" element={<Equipment />} />
        <Route path="ai-costs" element={<AiCosts />} />
      </Route>
    </Routes>
  );
}

export default App;
