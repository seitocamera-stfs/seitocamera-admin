import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/shared/ProtectedRoute';
import RoleGuard from './components/shared/RoleGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DashboardComptabilitat from './pages/DashboardComptabilitat';
import Suppliers from './pages/Suppliers';
import Clients from './pages/Clients';
import ReceivedInvoices from './pages/ReceivedInvoices';
import IssuedInvoices from './pages/IssuedInvoices';
import BankMovements from './pages/BankMovements';
import Conciliation from './pages/Conciliation';
import Reminders from './pages/Reminders';
import Users from './pages/Users';
import AccountingAgent from './pages/AccountingAgent';
import AgentRules from './pages/AgentRules';
import AgentSupervisor from './pages/AgentSupervisor';
import Equipment from './pages/Equipment';
import AiCosts from './pages/AiCosts';
import SharedInvoices from './pages/SharedInvoices';
import Fiscal from './pages/Fiscal';
import Connections from './pages/Connections';
import OperationsDaily from './pages/operations/DailyPlan';
import OperationsProjects from './pages/operations/Projects';
import OperationsIncidents from './pages/operations/Incidents';
import OperationsRoles from './pages/operations/Roles';
import OperationsProtocols from './pages/operations/Protocols';
import OperationsCalendar from './pages/operations/Calendar';
import OperationsTasks from './pages/operations/Tasks';
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
        <Route path="accounting" element={<DashboardComptabilitat />} />
        <Route path="invoices/received" element={<RoleGuard section="receivedInvoices"><ReceivedInvoices /></RoleGuard>} />
        <Route path="invoices/issued" element={<RoleGuard section="issuedInvoices"><IssuedInvoices /></RoleGuard>} />
        <Route path="suppliers" element={<RoleGuard section="suppliers"><Suppliers /></RoleGuard>} />
        <Route path="clients" element={<RoleGuard section="clients"><Clients /></RoleGuard>} />
        <Route path="bank" element={<RoleGuard section="bank"><BankMovements /></RoleGuard>} />
        <Route path="conciliation" element={<RoleGuard section="conciliation"><Conciliation /></RoleGuard>} />
        <Route path="reminders" element={<RoleGuard section="reminders"><Reminders /></RoleGuard>} />
        <Route path="users" element={<RoleGuard section="users"><Users /></RoleGuard>} />
        <Route path="invoices/shared" element={<RoleGuard section="sharedInvoices"><SharedInvoices /></RoleGuard>} />
        <Route path="fiscal" element={<RoleGuard section="fiscal"><Fiscal /></RoleGuard>} />
        <Route path="agent" element={<AccountingAgent />} />
        <Route path="agent/rules" element={<AgentRules />} />
        <Route path="agent/supervisor" element={<AgentSupervisor />} />
        <Route path="equipment" element={<Equipment />} />
        <Route path="ai-costs" element={<AiCosts />} />
        <Route path="settings/connections" element={<RoleGuard section="users"><Connections /></RoleGuard>} />
        {/* Mòdul Operacions */}
        <Route path="operations/daily" element={<OperationsDaily />} />
        <Route path="operations/projects" element={<OperationsProjects />} />
        <Route path="operations/incidents" element={<OperationsIncidents />} />
        <Route path="operations/roles" element={<OperationsRoles />} />
        <Route path="operations/protocols" element={<OperationsProtocols />} />
        <Route path="operations/calendar" element={<OperationsCalendar />} />
        <Route path="operations/tasks" element={<OperationsTasks />} />
      </Route>
    </Routes>
  );
}

export default App;
