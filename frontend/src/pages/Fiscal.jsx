import { useState, useEffect } from 'react';
import { Calculator, FileText, ChevronDown, ChevronUp, Download, AlertCircle, TrendingUp, TrendingDown, Users, Globe } from 'lucide-react';
import { useApiGet } from '../hooks/useApi';
import { formatCurrency } from '../lib/utils';
import api from '../lib/api';

// ===========================================
// Pàgina Fiscal — Models tributaris
// ===========================================

const QUARTERS = [
  { value: 1, label: '1T (Gen-Mar)' },
  { value: 2, label: '2T (Abr-Jun)' },
  { value: 3, label: '3T (Jul-Set)' },
  { value: 4, label: '4T (Oct-Des)' },
];

export default function Fiscal() {
  const currentYear = new Date().getFullYear();
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);

  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState(currentQuarter);
  const [activeModel, setActiveModel] = useState(null); // '303','111','347','349'
  const [modelData, setModelData] = useState(null);
  const [modelLoading, setModelLoading] = useState(false);

  // Resum anual
  const summaryQuery = useApiGet('/fiscal/summary', { year });

  const summary = summaryQuery.data;
  const quarterSummary = summary?.quarters?.find(q => q.quarter === quarter);

  // Carregar detall d'un model
  const loadModel = async (model) => {
    if (activeModel === model) {
      setActiveModel(null);
      setModelData(null);
      return;
    }
    setActiveModel(model);
    setModelLoading(true);
    try {
      const params = model === '347' ? { year } : { year, quarter };
      const { data } = await api.get(`/fiscal/${model}`, { params });
      setModelData(data);
    } catch (err) {
      setModelData({ error: err.response?.data?.error || err.message });
    }
    setModelLoading(false);
  };

  // Recarregar quan canvien any/trimestre
  useEffect(() => {
    if (activeModel) {
      loadModel(activeModel);
    }
  }, [year, quarter]);

  // Anys disponibles
  const years = [];
  for (let y = currentYear; y >= currentYear - 3; y--) years.push(y);

  return (
    <div>
      {/* Capçalera */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Calculator size={24} /> Fiscal
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Models tributaris i obligacions fiscals
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={quarter}
            onChange={(e) => setQuarter(parseInt(e.target.value))}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            {QUARTERS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </div>
      </div>

      {/* Targetes resum trimestral */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Model 303 */}
        <ModelCard
          model="303"
          title="Model 303"
          subtitle="IVA trimestral"
          icon={<FileText size={20} />}
          active={activeModel === '303'}
          onClick={() => loadModel('303')}
          color="blue"
        >
          {quarterSummary && (
            <>
              <div className={`text-2xl font-bold ${quarterSummary.models.m303.aPagar ? 'text-red-600' : 'text-green-600'}`}>
                {quarterSummary.models.m303.aPagar ? '-' : '+'}{formatCurrency(Math.abs(quarterSummary.models.m303.resultado))}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {quarterSummary.models.m303.aPagar ? 'A pagar' : 'A compensar'} ·
                {' '}{quarterSummary.models.m303.facturesEmeses} emeses,
                {' '}{quarterSummary.models.m303.facturesRebudes} rebudes
              </div>
            </>
          )}
        </ModelCard>

        {/* Model 111 */}
        <ModelCard
          model="111"
          title="Model 111"
          subtitle="Retencions IRPF"
          icon={<Users size={20} />}
          active={activeModel === '111'}
          onClick={() => loadModel('111')}
          color="amber"
        >
          {quarterSummary && (
            <>
              <div className="text-2xl font-bold text-amber-700">
                {formatCurrency(quarterSummary.models.m111.resultado)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                A ingressar · {quarterSummary.models.m111.numPerceptors} perceptors,
                {' '}{quarterSummary.models.m111.facturesAmbIrpf} factures
              </div>
            </>
          )}
        </ModelCard>

        {/* Model 349 */}
        <ModelCard
          model="349"
          title="Model 349"
          subtitle="Intracomunitàries"
          icon={<Globe size={20} />}
          active={activeModel === '349'}
          onClick={() => loadModel('349')}
          color="purple"
        >
          {quarterSummary && (
            <>
              <div className="text-2xl font-bold text-purple-700">
                {quarterSummary.models.m349.numOperations} ops
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Compres UE: {formatCurrency(quarterSummary.models.m349.totalAdquisicions)} ·
                Vendes UE: {formatCurrency(quarterSummary.models.m349.totalLliuraments)}
              </div>
            </>
          )}
        </ModelCard>

        {/* Model 347 */}
        <ModelCard
          model="347"
          title="Model 347"
          subtitle={`Tercers >3.005€ (anual ${year})`}
          icon={<TrendingUp size={20} />}
          active={activeModel === '347'}
          onClick={() => loadModel('347')}
          color="emerald"
        >
          {summary?.m347 && (
            <>
              <div className="text-2xl font-bold text-emerald-700">
                {summary.m347.numDeclarables} tercers
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Compres: {formatCurrency(summary.m347.totalCompres)} ·
                Vendes: {formatCurrency(summary.m347.totalVendes)}
              </div>
            </>
          )}
        </ModelCard>
      </div>

      {/* Detall del model seleccionat */}
      {activeModel && (
        <div className="bg-card border rounded-lg p-6">
          {modelLoading ? (
            <div className="text-center text-muted-foreground py-8">Calculant...</div>
          ) : modelData?.error ? (
            <div className="text-red-600 flex items-center gap-2">
              <AlertCircle size={16} /> {modelData.error}
            </div>
          ) : activeModel === '303' ? (
            <Model303Detail data={modelData} />
          ) : activeModel === '111' ? (
            <Model111Detail data={modelData} />
          ) : activeModel === '347' ? (
            <Model347Detail data={modelData} />
          ) : activeModel === '349' ? (
            <Model349Detail data={modelData} />
          ) : null}
        </div>
      )}

      {/* Calendari fiscal */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Calendari fiscal {year}</h3>
        <div className="grid grid-cols-4 gap-4">
          {QUARTERS.map(q => {
            const isCurrentQ = q.value === currentQuarter && year === currentYear;
            const isPast = year < currentYear || (year === currentYear && q.value < currentQuarter);
            const deadlineMonth = q.value * 3 + 1;
            const deadlineDay = q.value === 4 ? 30 : 20;
            const deadlineDate = new Date(q.value === 4 ? year + 1 : year, deadlineMonth - 1, deadlineDay);
            const isOverdue = isPast && deadlineDate < new Date();

            return (
              <div key={q.value} className={`border rounded-lg p-4 ${isCurrentQ ? 'border-blue-400 bg-blue-50/50' : ''} ${isOverdue ? 'border-red-300 bg-red-50/30' : ''}`}>
                <div className="font-medium text-sm">{q.label}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Presentació: {deadlineDay}/{deadlineMonth < 10 ? '0' : ''}{deadlineMonth}/{q.value === 4 ? year + 1 : year}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['303', '111', '349'].map(m => (
                    <span key={m} className={`text-xs px-1.5 py-0.5 rounded ${isPast ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>
                      {m}
                    </span>
                  ))}
                </div>
                {isCurrentQ && <div className="text-xs text-blue-600 font-medium mt-2">Trimestre actual</div>}
                {isOverdue && <div className="text-xs text-red-600 font-medium mt-2">Termini vençut</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===========================================
// Components auxiliars
// ===========================================

function ModelCard({ model, title, subtitle, icon, active, onClick, color, children }) {
  const colorClasses = {
    blue: 'border-blue-200 hover:border-blue-400',
    amber: 'border-amber-200 hover:border-amber-400',
    purple: 'border-purple-200 hover:border-purple-400',
    emerald: 'border-emerald-200 hover:border-emerald-400',
  };
  const activeClasses = {
    blue: 'ring-2 ring-blue-400 border-blue-400',
    amber: 'ring-2 ring-amber-400 border-amber-400',
    purple: 'ring-2 ring-purple-400 border-purple-400',
    emerald: 'ring-2 ring-emerald-400 border-emerald-400',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-card border rounded-lg p-4 cursor-pointer transition-all ${active ? activeClasses[color] : colorClasses[color]}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon} {title}
        </div>
        {active ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>
      <div className="text-xs text-muted-foreground mb-2">{subtitle}</div>
      {children}
    </div>
  );
}

// ===========================================
// Model 303 — Detall
// ===========================================

function Model303Detail({ data }) {
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Model 303 — IVA {data.period}</h3>
        <span className="text-sm text-muted-foreground">{data.from} → {data.to}</span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* IVA Repercutit */}
        <div>
          <h4 className="font-medium text-sm text-red-700 mb-2 flex items-center gap-1">
            <TrendingUp size={14} /> IVA Repercutit (vendes)
          </h4>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 text-xs font-medium">Tipus IVA</th>
                <th className="text-right p-2 text-xs font-medium">Base</th>
                <th className="text-right p-2 text-xs font-medium">IVA</th>
                <th className="text-right p-2 text-xs font-medium">Fact.</th>
              </tr>
            </thead>
            <tbody>
              {data.repercutit.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.rate}%</td>
                  <td className="p-2 text-right">{formatCurrency(r.base)}</td>
                  <td className="p-2 text-right font-medium">{formatCurrency(r.iva)}</td>
                  <td className="p-2 text-right text-muted-foreground">{r.count}</td>
                </tr>
              ))}
              {data.intracomunitari.base > 0 && (
                <tr className="border-t bg-purple-50/50">
                  <td className="p-2 text-purple-700">Intracom. (ISP) 21%</td>
                  <td className="p-2 text-right">{formatCurrency(data.intracomunitari.base)}</td>
                  <td className="p-2 text-right font-medium">{formatCurrency(data.intracomunitari.iva)}</td>
                  <td className="p-2 text-right text-muted-foreground">—</td>
                </tr>
              )}
              <tr className="border-t-2 font-semibold">
                <td className="p-2">Total</td>
                <td className="p-2 text-right">{formatCurrency(data.totalBaseRepercutit)}</td>
                <td className="p-2 text-right text-red-700">{formatCurrency(data.totalIvaRepercutit + (data.intracomunitari?.iva || 0))}</td>
                <td className="p-2 text-right">{data.facturesEmeses}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* IVA Suportat */}
        <div>
          <h4 className="font-medium text-sm text-green-700 mb-2 flex items-center gap-1">
            <TrendingDown size={14} /> IVA Suportat (compres)
          </h4>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 text-xs font-medium">Tipus IVA</th>
                <th className="text-right p-2 text-xs font-medium">Base</th>
                <th className="text-right p-2 text-xs font-medium">IVA</th>
                <th className="text-right p-2 text-xs font-medium">Fact.</th>
              </tr>
            </thead>
            <tbody>
              {data.suportat.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{s.rate}%</td>
                  <td className="p-2 text-right">{formatCurrency(s.base)}</td>
                  <td className="p-2 text-right font-medium">{formatCurrency(s.iva)}</td>
                  <td className="p-2 text-right text-muted-foreground">{s.count}</td>
                </tr>
              ))}
              {data.intracomunitari.base > 0 && (
                <tr className="border-t bg-purple-50/50">
                  <td className="p-2 text-purple-700">Intracom. (ISP) 21%</td>
                  <td className="p-2 text-right">{formatCurrency(data.intracomunitari.base)}</td>
                  <td className="p-2 text-right font-medium">{formatCurrency(data.intracomunitari.iva)}</td>
                  <td className="p-2 text-right text-muted-foreground">—</td>
                </tr>
              )}
              <tr className="border-t-2 font-semibold">
                <td className="p-2">Total</td>
                <td className="p-2 text-right">{formatCurrency(data.totalBaseSuportat)}</td>
                <td className="p-2 text-right text-green-700">{formatCurrency(data.totalIvaSuportat + (data.intracomunitari?.iva || 0))}</td>
                <td className="p-2 text-right">{data.facturesRebudes}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Resultat */}
      <div className={`mt-6 p-4 rounded-lg border-2 ${data.aPagar ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Resultat liquidació IVA</div>
            <div className={`text-3xl font-bold ${data.aPagar ? 'text-red-700' : 'text-green-700'}`}>
              {formatCurrency(Math.abs(data.resultado))}
            </div>
          </div>
          <div className={`text-lg font-semibold px-4 py-2 rounded-lg ${data.aPagar ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            {data.aPagar ? 'A PAGAR' : 'A COMPENSAR'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// Model 111 — Detall
// ===========================================

function Model111Detail({ data }) {
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Model 111 — Retencions IRPF {data.period}</h3>
        <span className="text-sm text-muted-foreground">{data.from} → {data.to}</span>
      </div>

      {data.facturesAmbIrpf === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No hi ha factures amb retenció IRPF en aquest trimestre.
        </div>
      ) : (
        <>
          {/* Resum per tipus */}
          <div className="mb-4">
            <h4 className="font-medium text-sm mb-2">Retencions per tipus</h4>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 text-xs font-medium">% Retenció</th>
                  <th className="text-right p-2 text-xs font-medium">Base</th>
                  <th className="text-right p-2 text-xs font-medium">Retenció</th>
                  <th className="text-right p-2 text-xs font-medium">Factures</th>
                </tr>
              </thead>
              <tbody>
                {data.retentions.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{r.rate}%</td>
                    <td className="p-2 text-right">{formatCurrency(r.base)}</td>
                    <td className="p-2 text-right font-medium">{formatCurrency(r.irpf)}</td>
                    <td className="p-2 text-right text-muted-foreground">{r.count}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-semibold">
                  <td className="p-2">Total</td>
                  <td className="p-2 text-right">{formatCurrency(data.totalBase)}</td>
                  <td className="p-2 text-right text-amber-700">{formatCurrency(data.totalIrpf)}</td>
                  <td className="p-2 text-right">{data.facturesAmbIrpf}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Detall per perceptor */}
          <div>
            <h4 className="font-medium text-sm mb-2">Detall per perceptor ({data.numPerceptors})</h4>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 text-xs font-medium">Perceptor</th>
                  <th className="text-left p-2 text-xs font-medium">NIF</th>
                  <th className="text-right p-2 text-xs font-medium">Base</th>
                  <th className="text-right p-2 text-xs font-medium">Retenció</th>
                  <th className="text-right p-2 text-xs font-medium">Fact.</th>
                </tr>
              </thead>
              <tbody>
                {data.perceptors.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 text-muted-foreground">{p.nif || '—'}</td>
                    <td className="p-2 text-right">{formatCurrency(p.base)}</td>
                    <td className="p-2 text-right font-medium">{formatCurrency(p.irpf)}</td>
                    <td className="p-2 text-right text-muted-foreground">{p.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Resultat */}
          <div className="mt-4 p-4 rounded-lg border-2 border-amber-300 bg-amber-50">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Total retencions a ingressar</div>
                <div className="text-3xl font-bold text-amber-700">{formatCurrency(data.resultado)}</div>
              </div>
              <div className="text-lg font-semibold px-4 py-2 rounded-lg bg-amber-100 text-amber-800">
                A INGRESSAR
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================
// Model 347 — Detall
// ===========================================

function Model347Detail({ data }) {
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Model 347 — Operacions amb tercers {data.period}</h3>
        <span className="text-sm text-muted-foreground">Llindar: 3.005,06€</span>
      </div>

      {data.numDeclarables === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No hi ha operacions que superin el llindar de 3.005,06€ aquest any.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 text-xs font-medium">Tipus</th>
                <th className="text-left p-2 text-xs font-medium">NIF</th>
                <th className="text-left p-2 text-xs font-medium">Nom</th>
                <th className="text-right p-2 text-xs font-medium">Total anual</th>
                <th className="text-right p-2 text-xs font-medium">1T</th>
                <th className="text-right p-2 text-xs font-medium">2T</th>
                <th className="text-right p-2 text-xs font-medium">3T</th>
                <th className="text-right p-2 text-xs font-medium">4T</th>
                <th className="text-right p-2 text-xs font-medium">Fact.</th>
              </tr>
            </thead>
            <tbody>
              {data.declarables.map((d, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${d.type === 'B' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {d.type === 'B' ? 'Compra' : 'Venda'}
                    </span>
                  </td>
                  <td className="p-2 text-muted-foreground font-mono text-xs">{d.nif}</td>
                  <td className="p-2 font-medium">{d.name}</td>
                  <td className="p-2 text-right font-semibold">{formatCurrency(d.total)}</td>
                  <td className="p-2 text-right text-muted-foreground">{d.q1 > 0 ? formatCurrency(d.q1) : '—'}</td>
                  <td className="p-2 text-right text-muted-foreground">{d.q2 > 0 ? formatCurrency(d.q2) : '—'}</td>
                  <td className="p-2 text-right text-muted-foreground">{d.q3 > 0 ? formatCurrency(d.q3) : '—'}</td>
                  <td className="p-2 text-right text-muted-foreground">{d.q4 > 0 ? formatCurrency(d.q4) : '—'}</td>
                  <td className="p-2 text-right text-muted-foreground">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <div className="text-xs text-muted-foreground">Total compres declarables</div>
              <div className="text-xl font-bold text-red-700">{formatCurrency(data.totalCompres)}</div>
            </div>
            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
              <div className="text-xs text-muted-foreground">Total vendes declarables</div>
              <div className="text-xl font-bold text-green-700">{formatCurrency(data.totalVendes)}</div>
            </div>
          </div>

          {(data.belowThreshold.suppliers > 0 || data.belowThreshold.clients > 0) && (
            <p className="text-xs text-muted-foreground mt-2">
              {data.belowThreshold.suppliers} proveïdors i {data.belowThreshold.clients} clients no arriben al llindar.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================
// Model 349 — Detall
// ===========================================

function Model349Detail({ data }) {
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Model 349 — Operacions intracomunitàries {data.period}</h3>
        <span className="text-sm text-muted-foreground">{data.from} → {data.to}</span>
      </div>

      {data.numOperations === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No hi ha operacions intracomunitàries en aquest trimestre.
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 text-xs font-medium">Tipus</th>
                <th className="text-left p-2 text-xs font-medium">País</th>
                <th className="text-left p-2 text-xs font-medium">NIF</th>
                <th className="text-left p-2 text-xs font-medium">Nom</th>
                <th className="text-right p-2 text-xs font-medium">Base</th>
                <th className="text-right p-2 text-xs font-medium">Factures</th>
              </tr>
            </thead>
            <tbody>
              {data.operations.map((op, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${op.type === 'A' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {op.type === 'A' ? 'Adquisició' : 'Lliurament'}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{op.country}</td>
                  <td className="p-2 text-muted-foreground font-mono text-xs">{op.nif || '—'}</td>
                  <td className="p-2 font-medium">{op.name}</td>
                  <td className="p-2 text-right font-semibold">{formatCurrency(op.base)}</td>
                  <td className="p-2 text-right text-muted-foreground">{op.count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
              <div className="text-xs text-muted-foreground">Total adquisicions UE</div>
              <div className="text-xl font-bold text-purple-700">{formatCurrency(data.totalAdquisicions)}</div>
            </div>
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-xs text-muted-foreground">Total lliuraments UE</div>
              <div className="text-xl font-bold text-blue-700">{formatCurrency(data.totalLliuraments)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
