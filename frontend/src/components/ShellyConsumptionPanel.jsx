import { useState, useEffect } from 'react';
import { Zap, BarChart3, Loader2, AlertTriangle, Check } from 'lucide-react';
import api from '../lib/api';

/**
 * Panell de consum elèctric Shelly per a Factures Compartides.
 *
 * Mostra:
 * - Consum mensual amb gràfic de barres diari
 * - Suggeriment de repartiment basat en kWh
 * - Botó per aplicar el percentatge suggerit
 *
 * @param {Object} props
 * @param {number} props.year - Any seleccionat
 * @param {number} props.month - Mes seleccionat (1-12)
 * @param {function} props.onApplySplit - Callback quan s'aplica el suggeriment ({ seitoPercent, logistikPercent })
 */
export default function ShellyConsumptionPanel({ year, month, onApplySplit }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [totalBillKwh, setTotalBillKwh] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [shellyAvailable, setShellyAvailable] = useState(true);

  // Carregar dades mensuals
  useEffect(() => {
    if (!year || !month) return;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    api.get(`/shelly/consumption/monthly/${year}/${month}`)
      .then((res) => {
        setData(res.data);
        setShellyAvailable(true);
      })
      .catch((err) => {
        if (err.response?.status === 404 || err.response?.status === 500) {
          setShellyAvailable(false);
        } else {
          setError(err.response?.data?.error || err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [year, month]);

  // Calcular suggeriment
  const handleSuggest = async () => {
    if (!totalBillKwh || parseFloat(totalBillKwh) <= 0) return;
    setSuggestLoading(true);
    try {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      const res = await api.get('/shelly/suggest-split', { params: { from, to, totalKwh: totalBillKwh } });
      setSuggestion(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSuggestLoading(false);
    }
  };

  if (!shellyAvailable) return null;
  if (loading) {
    return (
      <div className="bg-green-50/50 border border-green-200 rounded-lg p-4 flex items-center gap-2 text-green-700 text-sm">
        <Loader2 size={16} className="animate-spin" /> Carregant dades Shelly...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700 text-sm">
        <AlertTriangle size={16} /> {error}
      </div>
    );
  }
  if (!data || data.days === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-700 text-sm">
        <div className="flex items-center gap-2">
          <Zap size={16} />
          <span className="font-medium">Shelly Pro 3EM</span>
        </div>
        <p className="mt-1 text-xs">No hi ha dades de consum per aquest mes. Comprova que el dispositiu estigui sincronitzat.</p>
      </div>
    );
  }

  const maxKwh = Math.max(...data.dailyBreakdown.map((d) => d.totalKwh), 1);

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-green-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-green-600" />
          <span className="font-medium text-sm text-green-800">Consum elèctric (Shelly Pro 3EM)</span>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-green-700">{(data.totalKwh ?? 0).toFixed(1)} kWh</span>
          <span className="text-xs text-green-600 ml-1">/ {data.days} dies</span>
        </div>
      </div>

      {/* Gràfic de barres diari */}
      <div className="px-4 py-3">
        <div className="flex items-end gap-[2px] h-16">
          {data.dailyBreakdown.map((day) => {
            const height = (day.totalKwh / maxKwh) * 100;
            const dayNum = new Date(day.date).getDate();
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center group relative">
                <div
                  className="w-full bg-green-400 rounded-t-sm hover:bg-green-500 transition-colors cursor-default min-h-[1px]"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${dayNum}/${month}: ${(day.totalKwh ?? 0).toFixed(2)} kWh`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-green-600 mt-1">
          <span>1</span>
          <span>{Math.ceil(data.daysInMonth / 2)}</span>
          <span>{data.daysInMonth}</span>
        </div>
      </div>

      {/* Calculadora de split */}
      <div className="px-4 py-3 border-t border-green-200 bg-white/50">
        <p className="text-xs text-green-700 font-medium mb-2 flex items-center gap-1">
          <BarChart3 size={12} /> Calculadora de repartiment
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 mb-0.5 block">kWh totals de la factura</label>
            <input
              type="number"
              step="0.01"
              value={totalBillKwh}
              onChange={(e) => { setTotalBillKwh(e.target.value); setSuggestion(null); }}
              placeholder="Ex: 985"
              className="w-full px-2 py-1.5 border border-green-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-green-400"
            />
          </div>
          <button
            onClick={handleSuggest}
            disabled={!totalBillKwh || suggestLoading}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {suggestLoading ? <Loader2 size={14} className="animate-spin" /> : 'Calcular'}
          </button>
        </div>

        {/* Resultat del suggeriment */}
        {suggestion && !suggestion.error && (
          <div className="mt-3 bg-white rounded-lg border border-green-200 p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-gray-500">Consum Shelly (no-Seito)</span>
                <div className="font-semibold text-green-700">{(suggestion.shellyKwh ?? 0).toFixed(1)} kWh</div>
              </div>
              <div>
                <span className="text-xs text-gray-500">Consum Seito (resta)</span>
                <div className="font-semibold text-blue-700">{(suggestion.seitoKwh ?? 0).toFixed(1)} kWh</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-4">
                <span className="text-sm">
                  <span className="font-bold" style={{ color: '#00617F' }}>Seito {(suggestion.seitoPercent ?? 0).toFixed(1)}%</span>
                </span>
                <span className="text-sm">
                  <span className="font-bold text-orange-600">Logistik {(suggestion.logistikPercent ?? 0).toFixed(1)}%</span>
                </span>
              </div>
              {onApplySplit && (
                <button
                  onClick={() => onApplySplit({
                    seitoPercent: suggestion.seitoPercent,
                    logistikPercent: suggestion.logistikPercent,
                  })}
                  className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                >
                  <Check size={12} /> Aplicar
                </button>
              )}
            </div>
          </div>
        )}

        {suggestion?.error && (
          <p className="mt-2 text-xs text-red-600">{suggestion.error}</p>
        )}
      </div>
    </div>
  );
}
