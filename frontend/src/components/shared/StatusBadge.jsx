const statusConfig = {
  PENDING: { label: 'Pendent', className: 'bg-yellow-100 text-yellow-800' },
  PDF_PENDING: { label: 'Cal revisar', className: 'bg-amber-100 text-amber-800' },
  REVIEWED: { label: 'Revisada', className: 'bg-blue-100 text-blue-800' },
  APPROVED: { label: 'Aprovada', className: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rebutjada', className: 'bg-red-100 text-red-800' },
  PAID: { label: 'Pagada', className: 'bg-emerald-100 text-emerald-800' },
  PARTIALLY_PAID: { label: 'Parc. pagada', className: 'bg-orange-100 text-orange-800' },
  NOT_INVOICE: { label: 'No és factura', className: 'bg-gray-200 text-gray-600' },
  AUTO_MATCHED: { label: 'Auto-conciliada', className: 'bg-purple-100 text-purple-800' },
  MANUAL_MATCHED: { label: 'Manual', className: 'bg-indigo-100 text-indigo-800' },
  CONFIRMED: { label: 'Confirmada', className: 'bg-green-100 text-green-800' },
};

const priorityConfig = {
  LOW: { label: 'Baixa', className: 'bg-slate-100 text-slate-800' },
  NORMAL: { label: 'Normal', className: 'bg-blue-100 text-blue-800' },
  HIGH: { label: 'Alta', className: 'bg-orange-100 text-orange-800' },
  URGENT: { label: 'Urgent', className: 'bg-red-100 text-red-800' },
};

export function StatusBadge({ status }) {
  const config = statusConfig[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const config = priorityConfig[priority] || { label: priority, className: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
