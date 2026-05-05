import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, FileText, Target, TrendingUp, AlertTriangle,
  HelpCircle, UserPlus, Mail, Globe, Star, CheckCircle2, XCircle,
  Compass, Megaphone, Calendar, BarChart3, Lightbulb,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import api from '../../lib/api';

function Section({ icon: Icon, title, children, count }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={18} className="text-primary" />
        <h2 className="font-semibold">{title}</h2>
        {count !== undefined && <span className="text-xs text-muted-foreground">({count})</span>}
      </div>
      {children}
    </div>
  );
}

function MarketResearchView({ research }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section icon={Target} title="Competidors analitzats" count={research.competitors?.length || 0}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(research.competitors || []).map((c, i) => (
            <div key={i} className="border rounded p-3 bg-muted/20">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-medium">{c.name}</h3>
                {c.website && (
                  <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-0.5">
                    web <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <p className="text-sm mb-2">{c.positioning}</p>

              {(c.observed_strengths?.length > 0 || c.observed_weaknesses?.length > 0) && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {c.observed_strengths?.length > 0 && (
                    <div>
                      <div className="font-medium text-green-700 mb-0.5">Fortaleses</div>
                      <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                        {c.observed_strengths.map((s, j) => <li key={j}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {c.observed_weaknesses?.length > 0 && (
                    <div>
                      <div className="font-medium text-rose-700 mb-0.5">Debilitats</div>
                      <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                        {c.observed_weaknesses.map((w, j) => <li key={j}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {c.sources?.length > 0 && (
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                  Fonts ({c.sources.length}):
                  <ul className="space-y-0.5 mt-1">
                    {c.sources.map((s, j) => (
                      <li key={j}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section icon={FileText} title="Resum de preus">
          <p className="text-sm">{research.price_summary || '—'}</p>
        </Section>
        <Section icon={FileText} title="Resum de canals">
          <p className="text-sm">{research.channel_summary || '—'}</p>
        </Section>
      </div>

      <Section icon={TrendingUp} title="Oportunitats" count={research.opportunities?.length || 0}>
        <div className="space-y-2">
          {(research.opportunities || []).map((o, i) => (
            <div key={i} className="border-l-4 border-green-400 pl-3 py-1">
              <div className="font-medium text-sm">{o.description}</div>
              {o.rationale && <div className="text-xs text-muted-foreground mt-0.5">{o.rationale}</div>}
              {o.evidence?.length > 0 && (
                <div className="text-xs mt-1">
                  Evidència:{' '}
                  {o.evidence.map((e, j) => (
                    <a key={j} href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mr-2">
                      [{j + 1}]
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {research.risks?.length > 0 && (
          <Section icon={AlertTriangle} title="Riscos" count={research.risks.length}>
            <ul className="space-y-1 text-sm">
              {research.risks.map((r, i) => <li key={i} className="flex gap-2"><span className="text-rose-600">•</span>{r}</li>)}
            </ul>
          </Section>
        )}
        {research.open_questions?.length > 0 && (
          <Section icon={HelpCircle} title="Preguntes obertes" count={research.open_questions.length}>
            <ul className="space-y-1 text-sm">
              {research.open_questions.map((q, i) => <li key={i} className="flex gap-2"><span className="text-amber-600">•</span>{q}</li>)}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function ExecutiveReportView({ report }) {
  // El bundle conté: research, strategy, leads, verification, summary
  return (
    <div className="space-y-6">
      <Section icon={BarChart3} title="Resum executiu">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
          <div className="border rounded p-2">
            <div className="text-xs text-muted-foreground">Etapes</div>
            <div className="text-xl font-semibold">{report.summary?.stages_completed?.length || 0}/4</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xs text-muted-foreground">Temps total</div>
            <div className="text-xl font-semibold">{((report.summary?.total_seconds || 0) / 60).toFixed(1)} min</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xs text-muted-foreground">Tokens</div>
            <div className="text-xl font-semibold">{(report.summary?.tokens_used || 0).toLocaleString()}</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-xs text-muted-foreground">Verification</div>
            <div className="text-xl font-semibold">
              {report.summary?.verification_rate != null ? `${(report.summary.verification_rate * 100).toFixed(0)}%` : '—'}
            </div>
          </div>
        </div>
        {report.summary?.blocking_issues?.length > 0 && (
          <div className="mt-3 p-2 bg-rose-50 border border-rose-200 rounded text-sm">
            <div className="font-medium text-rose-800 flex items-center gap-1"><AlertTriangle size={14} /> Problemes bloquejants</div>
            <ul className="ml-5 mt-1 list-disc text-rose-700">
              {report.summary.blocking_issues.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
      </Section>

      {report.research && (
        <div>
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Target size={18} /> Estudi de mercat
          </h2>
          <MarketResearchView research={report.research} />
        </div>
      )}

      {report.strategy && (
        <div>
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Compass size={18} /> Estratègia de campanya
          </h2>
          <CampaignStrategyView strategy={report.strategy} />
        </div>
      )}

      {report.leads && (
        <div>
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <UserPlus size={18} /> Leads
          </h2>
          <LeadListView leadList={report.leads} filename={null} />
        </div>
      )}

      {report.verification && (
        <div>
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <CheckCircle2 size={18} /> Verificació
          </h2>
          <VerificationReportView report={report.verification} />
        </div>
      )}
    </div>
  );
}

function VerificationReportView({ report }) {
  const STATUS = {
    verified:     { label: 'Verificat',    icon: CheckCircle2, className: 'text-green-700 bg-green-50' },
    unverifiable: { label: 'Sense fonts',  icon: HelpCircle,    className: 'text-amber-700 bg-amber-50' },
    contradicted: { label: 'Contradit',    icon: XCircle,       className: 'text-rose-700 bg-rose-50' },
  };
  const rate = report.total_claims ? (report.verified / report.total_claims) * 100 : 0;
  const rateColor = rate >= 80 ? 'text-green-700' : rate >= 60 ? 'text-amber-700' : 'text-rose-700';

  return (
    <div className="grid grid-cols-1 gap-4">
      <Section icon={CheckCircle2} title="Resum verificació">
        <div className="grid grid-cols-4 gap-3 text-center">
          <div className="border rounded p-2">
            <div className="text-2xl font-semibold">{report.total_claims}</div>
            <div className="text-xs text-muted-foreground">Total claims</div>
          </div>
          <div className="border rounded p-2 bg-green-50/50">
            <div className="text-2xl font-semibold text-green-700">{report.verified}</div>
            <div className="text-xs text-muted-foreground">Verificades</div>
          </div>
          <div className="border rounded p-2 bg-amber-50/50">
            <div className="text-2xl font-semibold text-amber-700">{report.unverifiable}</div>
            <div className="text-xs text-muted-foreground">Sense fonts</div>
          </div>
          <div className="border rounded p-2 bg-rose-50/50">
            <div className="text-2xl font-semibold text-rose-700">{report.contradicted}</div>
            <div className="text-xs text-muted-foreground">Contradites</div>
          </div>
        </div>
        <div className={`text-center mt-3 font-semibold ${rateColor}`}>
          Verification rate: {rate.toFixed(1)}%
          <span className="text-xs text-muted-foreground ml-2">(llindar acceptable: ≥80%)</span>
        </div>
      </Section>

      {report.blocking_issues?.length > 0 && (
        <Section icon={AlertTriangle} title="Problemes bloquejants" count={report.blocking_issues.length}>
          <ul className="space-y-1 text-sm">
            {report.blocking_issues.map((b, i) => (
              <li key={i} className="flex gap-2 text-rose-700">
                <span>•</span>{b}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section icon={FileText} title="Claims auditades" count={report.claims?.length || 0}>
        <div className="space-y-2">
          {(report.claims || []).map((c, i) => {
            const s = STATUS[c.status] || STATUS.unverifiable;
            const Icon = s.icon;
            return (
              <div key={i} className={`border rounded p-2 text-sm ${s.className}`}>
                <div className="flex items-start gap-2">
                  <Icon size={14} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium uppercase">{s.label}</span>
                      <span className="text-[10px] text-muted-foreground">[{c.agent_source}]</span>
                    </div>
                    <div>{c.claim}</div>
                    {c.notes && <div className="text-xs text-muted-foreground mt-1 italic">{c.notes}</div>}
                    {c.evidence_urls?.length > 0 && (
                      <div className="text-xs mt-1">
                        Evidència:{' '}
                        {c.evidence_urls.map((u, j) => (
                          <a key={j} href={u} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mr-2">
                            [{j + 1}]
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function CampaignStrategyView({ strategy }) {
  const FIT_COLOR = { high: 'bg-green-100 text-green-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-rose-100 text-rose-800' };
  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Key message destacat */}
      <div className="border-l-4 border-primary bg-blue-50/50 rounded-r-lg p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Missatge clau</div>
        <div className="text-lg font-medium">"{strategy.key_message}"</div>
      </div>

      {/* Chosen angle destacat */}
      <Section icon={Compass} title="Angle escollit">
        <div className="border-l-4 border-green-400 pl-3">
          <div className="font-semibold text-lg">{strategy.chosen_angle?.label}</div>
          <div className="text-sm mt-1">{strategy.chosen_angle?.pitch}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Diferenciació vs competidors</div>
              <div>{strategy.chosen_angle?.differentiation_vs_competitors}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Per què</div>
              <div>{strategy.chosen_angle?.rationale}</div>
            </div>
          </div>
        </div>
      </Section>

      {/* Considered angles */}
      <Section icon={Lightbulb} title="Angles considerats" count={strategy.considered_angles?.length || 0}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(strategy.considered_angles || []).map((a, i) => {
            const isChosen = a.label === strategy.chosen_angle?.label;
            return (
              <div key={i} className={`border rounded p-2 text-sm ${isChosen ? 'bg-green-50 border-green-300' : 'bg-muted/20'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{a.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${FIT_COLOR[a.estimated_fit] || 'bg-muted'}`}>
                    {a.estimated_fit}
                  </span>
                  {isChosen && <span className="text-[10px] text-green-700 font-semibold">★ ESCOLLIT</span>}
                </div>
                <div className="text-xs text-muted-foreground">{a.pitch}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Channels */}
      <Section icon={Megaphone} title="Canals" count={strategy.channels?.length || 0}>
        <div className="space-y-2">
          {(strategy.channels || []).map((c, i) => (
            <div key={i} className="border rounded p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-medium">{c.channel}</h3>
                <span className="text-xs text-muted-foreground">{c.cadence}</span>
              </div>
              <p className="text-sm mb-1">{c.why}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="font-medium">Format:</span> {c.format}</div>
                <div><span className="font-medium">KPI:</span> {c.primary_kpi}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Targets + metrics + timing */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Section icon={Target} title="Segments target" count={strategy.target_segments?.length || 0}>
          <ul className="space-y-1 text-sm">
            {(strategy.target_segments || []).map((s, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span>{s}</li>)}
          </ul>
        </Section>
        <Section icon={BarChart3} title="Mètriques d'èxit" count={strategy.success_metrics?.length || 0}>
          <ul className="space-y-1 text-sm">
            {(strategy.success_metrics || []).map((s, i) => <li key={i} className="flex gap-2"><span className="text-green-600">•</span>{s}</li>)}
          </ul>
        </Section>
        <Section icon={Calendar} title="Timing & pressupost">
          <div className="text-sm space-y-1">
            <div><span className="font-medium">Timing:</span> {strategy.timing}</div>
            <div><span className="font-medium">Tier:</span> <span className="capitalize">{strategy.budget_tier}</span></div>
          </div>
        </Section>
      </div>

      {/* Creativity notes */}
      <Section icon={Lightbulb} title="Notes de creativitat">
        <p className="text-sm italic">{strategy.creativity_notes}</p>
      </Section>
    </div>
  );
}

function LeadListView({ leadList, filename }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const importLeads = async () => {
    if (!confirm(`Importar ${leadList.leads?.length || 0} leads com a prospects? Es saltaran duplicats automàticament.`)) return;
    setImporting(true);
    try {
      const r = await api.post(`/marketing/runs/${encodeURIComponent(filename)}/ingest-leads`);
      setImportResult(r.data);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally { setImporting(false); }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <Section icon={Target} title="Resum">
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div className="border rounded p-2">
            <div className="text-2xl font-semibold">{leadList.leads?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Leads vàlids</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-2xl font-semibold text-rose-600">{leadList.rejected_candidates || 0}</div>
            <div className="text-xs text-muted-foreground">Rebutjats</div>
          </div>
          <div className="border rounded p-2">
            <div className="text-2xl font-semibold">
              {leadList.leads?.length
                ? (leadList.leads.reduce((s, l) => s + (l.fit_score || 0), 0) / leadList.leads.length).toFixed(1)
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Fit score mitjà</div>
          </div>
        </div>

        {filename ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={importLeads}
              disabled={importing || importResult}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
            >
              <UserPlus size={14} />
              {importing ? 'Important...' : importResult ? 'Ja importats' : 'Importar com a prospects'}
            </button>
            {importResult && (
              <span className="text-sm text-muted-foreground self-center">
                {importResult.created} creats · {importResult.skipped_duplicates} duplicats · {importResult.skipped_no_contact} sense contacte
              </span>
            )}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">
            Per importar com a prospects, obre el fitxer de leads independent al llistat de runs.
          </div>
        )}
      </Section>

      <Section icon={Target} title="Leads" count={leadList.leads?.length || 0}>
        <div className="space-y-3">
          {(leadList.leads || []).map((L, i) => {
            const checks = L.validation_checks || {};
            const checksPass = Object.values(checks).filter((v) => v).length;
            const totalChecks = Object.keys(checks).length;
            return (
              <div key={i} className="border rounded p-3 bg-muted/20">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <h3 className="font-medium flex items-center gap-2">
                    {L.company_name}
                    <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 inline-flex items-center gap-1">
                      <Star size={10} /> {L.fit_score}/10
                    </span>
                  </h3>
                  <div className="flex gap-2 text-xs">
                    {L.website && (
                      <a href={L.website} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1">
                        <Globe size={12} /> web
                      </a>
                    )}
                    <span className={`inline-flex items-center gap-1 ${checksPass === totalChecks ? 'text-green-700' : 'text-amber-700'}`}>
                      {checksPass === totalChecks ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {checksPass}/{totalChecks} checks
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-1">{L.description}</p>
                <p className="text-sm mb-2"><span className="font-medium">Per què encaixa:</span> {L.why_good_fit}</p>

                {L.contacts?.length > 0 && (
                  <div className="text-xs mb-2">
                    <span className="font-medium">Contactes ({L.contacts.length}):</span>
                    <ul className="ml-2 mt-0.5 space-y-0.5">
                      {L.contacts.map((c, j) => (
                        <li key={j} className="flex items-center gap-2 text-muted-foreground">
                          {c.name && <span>{c.name}</span>}
                          {c.role && <span className="text-xs">({c.role})</span>}
                          {c.email && <span className="inline-flex items-center gap-0.5"><Mail size={10} /> {c.email}</span>}
                          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-primary">LinkedIn</a>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {L.suggested_outreach && (
                  <div className="text-xs border-l-2 border-primary pl-2 py-1 italic bg-blue-50/50">
                    <span className="font-medium not-italic">Suggested outreach:</span> "{L.suggested_outreach}"
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {leadList.rejection_reasons && Object.keys(leadList.rejection_reasons).length > 0 && (
        <Section icon={XCircle} title="Motius de rebuig">
          <ul className="space-y-1 text-sm">
            {Object.entries(leadList.rejection_reasons).map(([k, v]) => (
              <li key={k} className="flex justify-between"><span>{k}</span><span className="text-muted-foreground">{v}</span></li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export default function MarketingRunDetail() {
  const { id } = useParams();
  const { data, loading, error } = useApiGet(`/marketing/runs/${encodeURIComponent(id)}`);

  if (loading) return <div className="p-6">Carregant...</div>;
  if (error || !data) return (
    <div className="p-6">
      <div className="text-rose-700">No s'ha pogut carregar: {String(error?.message || error)}</div>
      <Link to="/marketing/runs" className="text-sm text-primary mt-2 inline-block">← Tornar als runs</Link>
    </div>
  );

  const content = data.content || {};
  // Detectar tipus pel contingut
  const isLeadList = Array.isArray(content.leads);
  const isResearch = Array.isArray(content.competitors);
  const isStrategy = Array.isArray(content.considered_angles) && content.chosen_angle;
  const isVerification = Array.isArray(content.claims) && typeof content.verified === 'number';

  return (
    <div className="p-6 max-w-5xl">
      <Link to="/marketing/runs" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Tornar als runs
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {isVerification ? `Informe de verificació`
            : isLeadList ? 'Llista de leads'
            : isStrategy ? `Estratègia de campanya — ${content.business || 'Empresa'}`
            : isResearch ? `Estudi de mercat — ${content.business || 'Empresa'}`
            : 'Run'}
        </h1>
        <div className="text-xs text-muted-foreground mt-1">
          {content.vertical || ''} {content.geography ? `· ${content.geography}` : ''}
          · Generat {data.created_at ? new Date(data.created_at).toLocaleString('ca-ES') : '-'}
        </div>
      </div>

      {isVerification && <VerificationReportView report={content} />}
      {isLeadList && <LeadListView leadList={content} filename={id} />}
      {isStrategy && <CampaignStrategyView strategy={content} />}
      {isResearch && !isStrategy && !isVerification && <MarketResearchView research={content} />}
      {!isLeadList && !isResearch && !isStrategy && !isVerification && (
        <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(content, null, 2)}</pre>
      )}
    </div>
  );
}
