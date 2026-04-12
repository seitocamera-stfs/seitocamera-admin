import { FileInput, FileOutput, Landmark, AlertTriangle } from 'lucide-react';

const stats = [
  { label: 'Factures pendents', value: '—', icon: FileInput, color: 'text-blue-500' },
  { label: 'Factures emeses', value: '—', icon: FileOutput, color: 'text-green-500' },
  { label: 'Moviments sense conciliar', value: '—', icon: Landmark, color: 'text-orange-500' },
  { label: 'Recordatoris urgents', value: '—', icon: AlertTriangle, color: 'text-red-500' },
];

export default function Dashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border rounded-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Icon size={20} className={color} />
            </div>
            <p className="text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Placeholder contingut */}
      <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground">
        <p className="text-lg mb-2">Benvingut a SeitoCamera Admin</p>
        <p className="text-sm">
          Fase 1 en construcció. Les dades apareixeran aquí quan els mòduls estiguin connectats.
        </p>
      </div>
    </div>
  );
}
