import { FileText, Calendar, User, Hash, Euro, Tag, Clock, CheckCircle2, AlertCircle, Folder, Briefcase } from 'lucide-react';
import Modal from './Modal';
import { StatusBadge } from './StatusBadge';
import { formatCurrency, formatDate } from '../../lib/utils';

/**
 * Popup amb els detalls principals d'una factura emesa (Rentman, manual, etc.)
 * Útil quan el PDF no està disponible (p.ex. factures importades de Rentman).
 */
export default function IssuedInvoiceDetailModal({ isOpen, onClose, invoice }) {
  if (!invoice) return null;

  // Calcular dies fins venciment / si està vençuda
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const today = new Date();
  const isOverdue = dueDate && dueDate < today && invoice.status !== 'PAID';
  const daysUntilDue = dueDate
    ? Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detalls de la factura" size="lg">
      <div className="space-y-4">
        {/* Capçalera destacada */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400 uppercase font-medium mb-1">
                <FileText size={14} />
                Factura emesa
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {invoice.invoiceNumber}
              </div>
              {invoice.description && (
                <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {invoice.description}
                </div>
              )}
            </div>
            <StatusBadge status={invoice.status} />
          </div>
        </div>

        {/* Referència de projecte Rentman destacada */}
        {(invoice.projectReference || invoice.projectName) && (
          <div className="border-2 border-dashed border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 rounded-lg p-3">
            <div className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-400 uppercase font-medium mb-1">
              <Briefcase size={14} />
              Projecte Rentman
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              {invoice.projectReference && (
                <span className="text-lg font-bold font-mono text-indigo-900 dark:text-indigo-200">
                  {invoice.projectReference}
                </span>
              )}
              {invoice.projectName && (
                <span className="text-sm text-muted-foreground">
                  · {invoice.projectName}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Graella de dades principals */}
        <div className="grid grid-cols-2 gap-3">
          <DataField
            icon={<User size={14} />}
            label="Client"
            value={invoice.client?.name || '—'}
            sub={invoice.client?.nif}
          />
          <DataField
            icon={<Folder size={14} />}
            label="Ref. projecte"
            value={invoice.projectReference || '—'}
            sub={invoice.projectName}
          />
          <DataField
            icon={<Hash size={14} />}
            label="Descripció / Subject"
            value={invoice.description || '—'}
          />
          <DataField
            icon={<Calendar size={14} />}
            label="Data emissió"
            value={formatDate(invoice.issueDate)}
          />
          <DataField
            icon={<Clock size={14} />}
            label="Data venciment"
            value={invoice.dueDate ? formatDate(invoice.dueDate) : '—'}
            sub={
              dueDate && invoice.status !== 'PAID'
                ? isOverdue
                  ? `Vençuda fa ${Math.abs(daysUntilDue)} dies`
                  : `En ${daysUntilDue} dies`
                : null
            }
            subClass={isOverdue ? 'text-red-600' : 'text-muted-foreground'}
          />
          {invoice.category && (
            <DataField
              icon={<Tag size={14} />}
              label="Categoria"
              value={invoice.category}
            />
          )}
          <DataField
            icon={<Euro size={14} />}
            label="Moneda"
            value={invoice.currency || 'EUR'}
          />
        </div>

        {/* Imports destacats */}
        <div className="bg-muted/40 border rounded-lg p-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground uppercase mb-1">Base imposable</div>
              <div className="font-medium">{formatCurrency(invoice.subtotal)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase mb-1">
                IVA ({invoice.taxRate}%)
              </div>
              <div className="font-medium">{formatCurrency(invoice.taxAmount)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase mb-1">Total</div>
              <div className="text-xl font-bold text-primary">
                {formatCurrency(invoice.totalAmount)}
              </div>
            </div>
          </div>
        </div>

        {/* Conciliacions associades */}
        {invoice.conciliations && invoice.conciliations.length > 0 && (
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <CheckCircle2 size={14} className="text-green-600" />
              Conciliada amb {invoice.conciliations.length} moviment{invoice.conciliations.length > 1 ? 's' : ''} bancari{invoice.conciliations.length > 1 ? 's' : ''}
            </div>
            <div className="space-y-1">
              {invoice.conciliations.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {c.bankMovement?.date ? formatDate(c.bankMovement.date) : '—'}
                    </span>
                    <span>{c.bankMovement?.description || '—'}</span>
                  </div>
                  <span className="font-medium">
                    {c.bankMovement?.amount ? formatCurrency(c.bankMovement.amount) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Avís: sense PDF */}
        {!invoice.filePath && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              Aquesta factura no té PDF associat. Si prové de Rentman, pots consultar-la directament a la plataforma Rentman.
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border text-sm hover:bg-muted"
          >
            Tancar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DataField({ icon, label, value, sub, subClass = 'text-muted-foreground' }) {
  return (
    <div className="border rounded-md p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-medium break-words">{value}</div>
      {sub && <div className={`text-xs mt-0.5 ${subClass}`}>{sub}</div>}
    </div>
  );
}
