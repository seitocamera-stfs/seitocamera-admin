import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Capçalera de columna ordenable
 * Props:
 *   - label: text de la capçalera
 *   - field: nom del camp per ordenar
 *   - sortBy: camp actual d'ordenació
 *   - sortDir: direcció actual ('asc' | 'desc')
 *   - onSort: callback(field) quan es clica
 *   - className: classes CSS addicionals
 */
export default function SortableHeader({ label, field, sortBy, sortDir, onSort, className = '' }) {
  const isActive = sortBy === field;

  return (
    <th
      className={`p-3 text-left cursor-pointer select-none hover:bg-muted/30 transition-colors ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase">{label}</span>
        {isActive ? (
          sortDir === 'asc' ? <ChevronUp size={14} className="text-primary" /> : <ChevronDown size={14} className="text-primary" />
        ) : (
          <ChevronsUpDown size={14} className="text-muted-foreground/40" />
        )}
      </div>
    </th>
  );
}
