import { FileInput, FileOutput, Landmark, Bell } from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import { formatCurrency } from '../lib/utils';
import useAuthStore from '../stores/authStore';
import { canSeeDashboardPanel } from '../lib/permissions';

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  // Només carreguem dades dels panells que l'usuari pot veure
  const { data: invoiceStats } = useApiGet(
    canSeeDashboardPanel(role, 'receivedPending') || canSeeDashboardPanel(role, 'issuedPending')
      ? '/invoices/stats' : null
  );
  const { data: receivedData } = useApiGet(
    canSeeDashboardPanel(role, 'recentReceived')
      ? '/invoices/received' : null,
    { status: 'PENDING', limit: 5 }
  );
  const { data: bankData } = useApiGet(
    canSeeDashboardPanel(role, 'unconciliatedList')
      ? '/bank' : null,
    { conciliated: 'false', limit: 5 }
  );
  const { data: remindersData } = useApiGet(
    canSeeDashboardPanel(role, 'reminders')
      ? '/reminders/pending' : null
  );

  const receivedPending = invoiceStats?.received?.find((s) => s.status === 'PENDING');
  const issuedPending = invoiceStats?.issued?.find((s) => s.status === 'PENDING');

  // Definim tots els KPIs amb la seva clau de panell
  const allStats = [
    {
      key: 'receivedPending',
      label: 'Factures pendents',
      value: receivedPending?._count || 0,
      sub: receivedPending?._sum?.totalAmount ? formatCurrency(receivedPending._sum.totalAmount) : '0 €',
      icon: FileInput,
      color: 'text-blue-500',
    },
    {
      key: 'issuedPending',
      label: 'Emeses pendents',
      value: issuedPending?._count || 0,
      sub: issuedPending?._sum?.totalAmount ? formatCurrency(issuedPending._sum.totalAmount) : '0 €',
      icon: FileOutput,
      color: 'text-green-500',
    },
    {
      key: 'unconciliated',
      label: 'Sense conciliar',
      value: bankData?.pagination?.total || 0,
      sub: 'moviments bancaris',
      icon: Landmark,
      color: 'text-orange-500',
    },
    {
      key: 'reminders',
      label: 'Recordatoris',
      value: remindersData?.count || 0,
      sub: 'mencions pendents',
      icon: Bell,
      color: 'text-red-500',
    },
  ];

  const visibleStats = allStats.filter((s) => canSeeDashboardPanel(role, s.key));

  // Calcular columnes del grid segons nombre de KPIs visibles
  const gridCols = visibleStats.length >= 4
    ? 'lg:grid-cols-4'
    : visibleStats.length === 3
      ? 'lg:grid-cols-3'
      : visibleStats.length === 2
        ? 'lg:grid-cols-2'
        : 'lg:grid-cols-1';

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Hola, {user?.name?.split(' ')[0] || 'Sergi'}!</h2>
      <p className="text-muted-foreground mb-6">Resum del teu panell d'administració</p>

      {visibleStats.length > 0 && (
        <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-4 mb-8`}>
          {visibleStats.map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="bg-card border rounded-lg p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon size={20} className={color} />
              </div>
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {canSeeDashboardPanel(role, 'recentReceived') && (
          <div className="bg-card border rounded-lg">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Últimes factures rebudes pendents</h3>
            </div>
            <div className="divide-y">
              {receivedData?.data?.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Cap factura pendent</p>
              ) : (
                receivedData?.data?.map((inv) => (
                  <div key={inv.id} className="p-3 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                      <span className="text-muted-foreground text-sm ml-2">{inv.supplier?.name}</span>
                    </div>
                    <span className="font-medium text-sm">{formatCurrency(inv.totalAmount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {canSeeDashboardPanel(role, 'unconciliatedList') && (
          <div className="bg-card border rounded-lg">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Moviments sense conciliar</h3>
            </div>
            <div className="divide-y">
              {bankData?.data?.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Tots els moviments conciliats!</p>
              ) : (
                bankData?.data?.map((m) => (
                  <div key={m.id} className="p-3 flex items-center justify-between">
                    <span className="text-sm">{m.description}</span>
                    <span className={`font-medium text-sm ${parseFloat(m.amount) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(parseFloat(m.amount)))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {visibleStats.length === 0 && (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
          <p>No tens panells assignats al teu rol.</p>
          <p className="text-sm mt-1">Contacta amb l'administrador si necessites accés a més seccions.</p>
        </div>
      )}
    </div>
  );
}
