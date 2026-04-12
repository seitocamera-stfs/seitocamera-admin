import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        {/* Futures rutes — Blocs 6-10 */}
        {/* <Route path="invoices/received" element={<ReceivedInvoices />} /> */}
        {/* <Route path="invoices/issued" element={<IssuedInvoices />} /> */}
        {/* <Route path="suppliers" element={<Suppliers />} /> */}
        {/* <Route path="clients" element={<Clients />} /> */}
        {/* <Route path="bank" element={<BankMovements />} /> */}
        {/* <Route path="conciliation" element={<Conciliation />} /> */}
        {/* <Route path="reminders" element={<Reminders />} /> */}
      </Route>
    </Routes>
  );
}

export default App;
