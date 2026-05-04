import { useState, useEffect } from 'react';
import { Save, Building2 } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

const REGIME_OPTIONS = [
  { value: 'GENERAL', label: 'Règim General' },
  { value: 'RECARGO_EQUIVALENCIA', label: 'Recàrrec d\'equivalència' },
  { value: 'EXEMPT', label: 'Exempt' },
];

const VAT_PERIOD_OPTIONS = [
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'MONTHLY', label: 'Mensual' },
];

export default function CompanySettings() {
  const { data: company, loading, refetch } = useApiGet('/companies');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (company) {
      setForm({
        ...company,
        defaultVatRate: Number(company.defaultVatRate),
        defaultIrpfRate: Number(company.defaultIrpfRate),
        corporateTaxRate: Number(company.corporateTaxRate),
        is347Threshold: Number(company.is347Threshold),
      });
    }
  }, [company]);

  const onChange = (field) => (e) => {
    const v = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
    setForm({ ...form, [field]: v });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await api.put(`/companies/${form.id}`, form);
      setFeedback({ type: 'ok', text: 'Dades guardades correctament' });
      refetch();
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Error en guardar' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Carregant...</div>;
  if (!form) return <div className="p-6">No s'ha trobat cap empresa configurada.</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Building2 size={24} className="text-primary" />
        <h1 className="text-xl font-semibold">Dades fiscals de l'empresa</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-6 bg-card border rounded-lg p-6">
        <Section title="Identificació">
          <Field label="Raó social *">
            <input className="input-field" required value={form.legalName || ''} onChange={onChange('legalName')} />
          </Field>
          <Field label="Nom comercial">
            <input className="input-field" value={form.commercialName || ''} onChange={onChange('commercialName')} />
          </Field>
          <Field label="NIF *">
            <input className="input-field" required value={form.nif || ''} onChange={onChange('nif')} />
          </Field>
        </Section>

        <Section title="Adreça">
          <Field label="Adreça" full>
            <input className="input-field" value={form.address || ''} onChange={onChange('address')} />
          </Field>
          <Field label="Codi postal">
            <input className="input-field" value={form.postalCode || ''} onChange={onChange('postalCode')} />
          </Field>
          <Field label="Ciutat">
            <input className="input-field" value={form.city || ''} onChange={onChange('city')} />
          </Field>
          <Field label="Província">
            <input className="input-field" value={form.province || ''} onChange={onChange('province')} />
          </Field>
          <Field label="País">
            <input className="input-field" maxLength={2} value={form.country || 'ES'} onChange={onChange('country')} />
          </Field>
        </Section>

        <Section title="Contacte">
          <Field label="Telèfon">
            <input className="input-field" value={form.phone || ''} onChange={onChange('phone')} />
          </Field>
          <Field label="Email">
            <input className="input-field" type="email" value={form.email || ''} onChange={onChange('email')} />
          </Field>
          <Field label="Web" full>
            <input className="input-field" type="url" value={form.website || ''} onChange={onChange('website')} />
          </Field>
        </Section>

        <Section title="Configuració fiscal">
          <Field label="Règim d'IVA">
            <select className="input-field" value={form.aeatRegime || 'GENERAL'} onChange={onChange('aeatRegime')}>
              {REGIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Període IVA">
            <select className="input-field" value={form.vatPeriod || 'QUARTERLY'} onChange={onChange('vatPeriod')}>
              {VAT_PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="IVA per defecte (%)">
            <input className="input-field" type="number" step="0.01" value={form.defaultVatRate} onChange={onChange('defaultVatRate')} />
          </Field>
          <Field label="IRPF per defecte (%)">
            <input className="input-field" type="number" step="0.01" value={form.defaultIrpfRate} onChange={onChange('defaultIrpfRate')} />
          </Field>
          <Field label="Tipus IS (%)">
            <input className="input-field" type="number" step="0.01" value={form.corporateTaxRate} onChange={onChange('corporateTaxRate')} />
          </Field>
          <Field label="Llindar 347 (€)">
            <input className="input-field" type="number" step="0.01" value={form.is347Threshold} onChange={onChange('is347Threshold')} />
          </Field>
          <Field label="Mes inici exercici">
            <input className="input-field" type="number" min={1} max={12} value={form.fiscalYearStartMonth} onChange={onChange('fiscalYearStartMonth')} />
          </Field>
          <Field label="Moneda">
            <input className="input-field" maxLength={3} value={form.defaultCurrency || 'EUR'} onChange={onChange('defaultCurrency')} />
          </Field>
        </Section>

        {feedback && (
          <div className={`text-sm ${feedback.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {feedback.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Guardant...' : 'Guardar canvis'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
