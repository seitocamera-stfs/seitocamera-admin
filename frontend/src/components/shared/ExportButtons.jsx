import { useState } from 'react';
import api from '../../lib/api';

/**
 * Component de botons d'exportació (CSV, Excel, PDF)
 * Respecta els filtres actius de la pàgina
 *
 * Props:
 *   - endpoint: ruta base d'exportació (ex: '/export/received-invoices')
 *   - filters: objecte amb els filtres actuals de la pàgina
 *   - filenameBase: nom base del fitxer (ex: 'factures-rebudes')
 */
export default function ExportButtons({ endpoint, filters = {}, filenameBase = 'export' }) {
  const [loading, setLoading] = useState(null); // 'csv' | 'xlsx' | 'pdf' | null

  const handleExport = async (format) => {
    setLoading(format);
    try {
      // Construir query string amb els filtres
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value);
        }
      });

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
      link.download = `${filenameBase}_${date}.${extensions[format]}`;

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
    { key: 'csv', label: 'CSV', icon: '📄' },
    { key: 'xlsx', label: 'Excel', icon: '📊' },
    { key: 'pdf', label: 'PDF', icon: '📕' },
  ];

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground mr-1">Exportar:</span>
      {formats.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => handleExport(key)}
          disabled={loading !== null}
          className="px-2 py-1 text-xs border rounded hover:bg-muted/50 transition-colors disabled:opacity-50"
          title={`Exportar a ${label}`}
        >
          {loading === key ? '...' : label}
        </button>
      ))}
    </div>
  );
}
