import { useState } from 'react';
import api from '../../lib/api';

/**
 * Component de botons d'exportació (CSV, Excel, PDF)
 *
 * - Si `selectedIds` conté elements → exporta NOMÉS els seleccionats (ignora filtres)
 * - Si `selectedIds` està buit o no es passa → exporta amb els filtres actius
 *
 * Props:
 *   - endpoint: ruta base d'exportació (ex: '/export/received-invoices')
 *   - filters: objecte amb els filtres actuals de la pàgina
 *   - filenameBase: nom base del fitxer (ex: 'factures-rebudes')
 *   - selectedIds: array d'IDs a exportar (si n'hi ha). Opcional.
 */
export default function ExportButtons({ endpoint, filters = {}, filenameBase = 'export', selectedIds = [] }) {
  const [loading, setLoading] = useState(null); // 'csv' | 'xlsx' | 'pdf' | null
  const hasSelection = Array.isArray(selectedIds) && selectedIds.length > 0;

  const handleExport = async (format) => {
    setLoading(format);
    try {
      // Construir query string
      const params = new URLSearchParams();

      if (hasSelection) {
        // Prioritat: si hi ha selecció, només exportar aquests IDs
        params.append('ids', selectedIds.join(','));
      } else {
        // Si no, respectar filtres actius
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            params.append(key, value);
          }
        });
      }

      const queryString = params.toString();
      const url = `${endpoint}/${format}${queryString ? '?' + queryString : ''}`;

      const response = await api.get(url, { responseType: 'blob' });

      // Crear link de descàrrega
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;

      const date = new Date().toISOString().slice(0, 10);
      const extensions = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
      const suffix = hasSelection ? `_seleccio-${selectedIds.length}` : '';
      link.download = `${filenameBase}${suffix}_${date}.${extensions[format]}`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Error exportant:', err);
      alert('Error al exportar. Torna-ho a provar.');
    } finally {
      setLoading(null);
    }
  };

  const formats = [
    { key: 'csv', label: 'CSV' },
    { key: 'xlsx', label: 'Excel' },
    { key: 'pdf', label: 'PDF' },
  ];

  return (
    <div className="flex items-center gap-1">
      <span className={`text-xs mr-1 ${hasSelection ? 'font-semibold text-teal-700' : 'text-muted-foreground'}`}>
        {hasSelection ? `Exportar ${selectedIds.length} seleccionades:` : 'Exportar:'}
      </span>
      {formats.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => handleExport(key)}
          disabled={loading !== null}
          className={`px-2 py-1 text-xs border rounded transition-colors disabled:opacity-50 ${
            hasSelection
              ? 'border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100'
              : 'hover:bg-muted/50'
          }`}
          title={
            hasSelection
              ? `Exportar ${selectedIds.length} factures seleccionades a ${label}`
              : `Exportar a ${label} (amb filtres actuals)`
          }
        >
          {loading === key ? '...' : label}
        </button>
      ))}
    </div>
  );
}
