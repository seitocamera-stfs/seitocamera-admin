import { useState, useEffect } from 'react';
import {
  Plug, PlugZap, Mail, HardDrive, Building2, CreditCard, Truck, Zap,
  CheckCircle2, XCircle, AlertTriangle, Loader2, ExternalLink, Settings, RefreshCw
} from 'lucide-react';
import api from '../lib/api';

const PROVIDER_INFO = {
  ZOHO_MAIL: {
    label: 'Zoho Mail',
    icon: Mail,
    color: 'text-red-600 bg-red-50',
    description: 'Correu electrònic per enviar recordatoris de pagament i escanejar factures rebudes.',
    supportsOAuth: true,
  },
  GOOGLE_DRIVE: {
    label: 'Google Drive',
    icon: HardDrive,
    color: 'text-blue-600 bg-blue-50',
    description: 'Emmagatzematge de factures PDF al núvol.',
    supportsOAuth: false, // de moment manual
  },
  QONTO: {
    label: 'Qonto',
    icon: CreditCard,
    color: 'text-purple-600 bg-purple-50',
    description: 'Sincronització automàtica de moviments bancaris.',
    supportsOAuth: false,
  },
  GOCARDLESS: {
    label: 'Plaid (Open Banking)',
    icon: Building2,
    color: 'text-teal-600 bg-teal-50',
    description: 'Connexió bancària via Open Banking per comptes tradicionals (Sabadell, CaixaBank...).',
    supportsOAuth: false,
  },
  RENTMAN: {
    label: 'Rentman',
    icon: Truck,
    color: 'text-orange-600 bg-orange-50',
    description: 'Importació de factures emeses i projectes.',
    supportsOAuth: false,
  },
  SMTP: {
    label: 'SMTP Genèric',
    icon: Mail,
    color: 'text-gray-600 bg-gray-50',
    description: 'Enviament de correus via SMTP (Gmail, Outlook, o qualsevol proveïdor).',
    supportsOAuth: false,
  },
  SHELLY: {
    label: 'Shelly Pro 3EM',
    icon: Zap,
    color: 'text-green-600 bg-green-50',
    description: 'Monitor de consum elèctric per calcular el repartiment de factures compartides.',
    supportsOAuth: false,
  },
};

const STATUS_BADGES = {
  ACTIVE: { label: 'Connectat', icon: CheckCircle2, className: 'text-green-700 bg-green-100' },
  ERROR: { label: 'Error', icon: AlertTriangle, className: 'text-red-700 bg-red-100' },
  EXPIRED: { label: 'Expirat', icon: AlertTriangle, className: 'text-amber-700 bg-amber-100' },
  DISCONNECTED: { label: 'No connectat', icon: XCircle, className: 'text-gray-500 bg-gray-100' },
};

export default function Connections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [zohoSetup, setZohoSetup] = useState(null);
  const [apiSetup, setApiSetup] = useState(null); // { provider, fields... } per Qonto/GoCardless/Rentman
  const [successMsg, setSuccessMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Check URL params for OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'zoho') {
      setSuccessMsg('Zoho Mail connectat correctament!');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('error')) {
      setErrorMsg(`Error de connexió: ${params.get('error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/connections');
      setConnections(data);
    } catch (err) {
      setErrorMsg('Error carregant connexions: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConnections(); }, []);

  const handleConnect = async (provider) => {
    if (provider === 'ZOHO_MAIL') {
      const conn = connections.find((c) => c.provider === 'ZOHO_MAIL');
      if (!conn?.hasCredentials) {
        setZohoSetup({ clientId: '', clientSecret: '', accountId: '', fromAddress: 'rental@seitocamera.com' });
        return;
      }
      await startZohoOAuth();
    } else if (provider === 'QONTO') {
      setApiSetup({ provider: 'QONTO', orgSlug: '', secretKey: '' });
    } else if (provider === 'GOCARDLESS') {
      setApiSetup({ provider: 'GOCARDLESS', clientId: '', secret: '' });
    } else if (provider === 'RENTMAN') {
      setApiSetup({ provider: 'RENTMAN', apiToken: '' });
    }
  };

  const handleSaveApiCredentials = async () => {
    if (!apiSetup) return;
    setActionLoading(apiSetup.provider + '_SAVE');
    try {
      await api.put(`/connections/${apiSetup.provider.toLowerCase()}/credentials`, apiSetup);
      setApiSetup(null);
      await fetchConnections();
      setSuccessMsg(`${PROVIDER_INFO[apiSetup.provider]?.label || apiSetup.provider}: credencials guardades.`);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const startZohoOAuth = async () => {
    setActionLoading('ZOHO_MAIL');
    try {
      const { data } = await api.get('/connections/zoho/auth-url');
      // Obrir en una nova finestra/pestanya
      window.location.href = data.authUrl;
    } catch (err) {
      setErrorMsg('Error generant URL: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveZohoCredentials = async () => {
    if (!zohoSetup?.clientId || !zohoSetup?.clientSecret) {
      setErrorMsg('Cal indicar Client ID i Client Secret');
      return;
    }
    setActionLoading('ZOHO_SAVE');
    try {
      await api.put('/connections/zoho/credentials', zohoSetup);
      setZohoSetup(null);
      await fetchConnections();
      // Iniciar OAuth automàticament després de guardar
      await startZohoOAuth();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMigrateEnv = async () => {
    setActionLoading('ZOHO_MIGRATE');
    try {
      const { data } = await api.post('/connections/zoho/migrate-env');
      setSuccessMsg(data.message);
      await fetchConnections();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleTest = async (provider) => {
    setActionLoading(provider + '_TEST');
    try {
      const { data } = await api.post(`/connections/${provider}/test`);
      if (data.connected) {
        setSuccessMsg(`${PROVIDER_INFO[provider]?.label || provider}: connexió OK (${data.foldersCount} carpetes)`);
      } else {
        setErrorMsg(`${PROVIDER_INFO[provider]?.label || provider}: ${data.error}`);
      }
      await fetchConnections();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (provider) => {
    if (!confirm(`Desconnectar ${PROVIDER_INFO[provider]?.label || provider}?`)) return;
    setActionLoading(provider + '_DISC');
    try {
      await api.post(`/connections/${provider}/disconnect`);
      setSuccessMsg(`${PROVIDER_INFO[provider]?.label || provider} desconnectat`);
      await fetchConnections();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Plug size={28} className="text-primary" />
        <div>
          <h2 className="text-2xl font-bold">Connexions</h2>
          <p className="text-muted-foreground text-sm">Connecta serveis externs per correu, banc, factures i emmagatzematge.</p>
        </div>
      </div>

      {/* Alertes */}
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="ml-auto text-green-600 hover:text-green-800">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 text-red-800 rounded-lg flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="ml-auto text-red-600 hover:text-red-800">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" size={24} />
          <span className="ml-2">Carregant connexions...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => {
            const info = PROVIDER_INFO[conn.provider] || {};
            const Icon = info.icon || Plug;
            const badge = STATUS_BADGES[conn.status] || STATUS_BADGES.DISCONNECTED;
            const BadgeIcon = badge.icon;
            const isConnected = conn.status === 'ACTIVE';

            return (
              <div
                key={conn.provider}
                className="bg-card border rounded-lg p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                {/* Icon + Info */}
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2.5 rounded-lg ${info.color || 'bg-gray-50 text-gray-600'}`}>
                    <Icon size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{info.label || conn.provider}</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                        <BadgeIcon size={12} />
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{info.description}</p>
                    {conn.displayName && (
                      <p className="text-xs text-muted-foreground mt-1">{conn.displayName}</p>
                    )}
                    {conn.lastError && conn.status === 'ERROR' && (
                      <p className="text-xs text-red-600 mt-1">Error: {conn.lastError}</p>
                    )}
                    {conn.connectedAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Connectat: {new Date(conn.connectedAt).toLocaleDateString('ca-ES')}
                        {conn.scopes && ` · Scopes: ${conn.scopes.split(',').length}`}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  {conn.provider === 'ZOHO_MAIL' && (
                    <>
                      {isConnected ? (
                        <>
                          <button
                            onClick={() => handleTest(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === conn.provider + '_TEST' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Testejar
                          </button>
                          <button
                            onClick={() => setZohoSetup({ clientId: '', clientSecret: '', accountId: '', fromAddress: 'rental@seitocamera.com' })}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            <Settings size={14} />
                            Canviar credencials
                          </button>
                          <button
                            onClick={() => handleDisconnect(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            <XCircle size={14} />
                            Desconnectar
                          </button>
                        </>
                      ) : (
                        <>
                          {!conn.hasCredentials && (
                            <button
                              onClick={handleMigrateEnv}
                              disabled={!!actionLoading}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
                              title="Migra les credencials actuals del .env a la base de dades"
                            >
                              {actionLoading === 'ZOHO_MIGRATE' ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />}
                              Migrar del .env
                            </button>
                          )}
                          <button
                            onClick={() => handleConnect(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === 'ZOHO_MAIL' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                            Connectar
                          </button>
                        </>
                      )}
                    </>
                  )}

                  {(conn.provider === 'QONTO' || conn.provider === 'GOCARDLESS' || conn.provider === 'RENTMAN') && (
                    <>
                      {isConnected ? (
                        <>
                          <button
                            onClick={() => handleTest(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === conn.provider + '_TEST' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Testejar
                          </button>
                          <button
                            onClick={() => handleConnect(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            <Settings size={14} />
                            Editar
                          </button>
                          <button
                            onClick={() => handleDisconnect(conn.provider)}
                            disabled={!!actionLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            <XCircle size={14} />
                            Desconnectar
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleConnect(conn.provider)}
                          disabled={!!actionLoading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          <PlugZap size={14} />
                          Connectar
                        </button>
                      )}
                    </>
                  )}

                  {(conn.provider === 'GOOGLE_DRIVE' || conn.provider === 'SMTP') && (
                    <span className="text-xs text-muted-foreground self-center italic">Pròximament</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de setup API (Qonto, GoCardless, Rentman) */}
      {apiSetup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              {(() => { const I = PROVIDER_INFO[apiSetup.provider]?.icon || Plug; return <I size={20} />; })()}
              Configurar {PROVIDER_INFO[apiSetup.provider]?.label || apiSetup.provider}
            </h3>

            <div className="space-y-4 text-sm">
              {apiSetup.provider === 'QONTO' && (
                <>
                  <div className="bg-purple-50 text-purple-800 rounded-lg p-3 text-xs">
                    <p>Obtén les credencials a <a href="https://app.qonto.com/settings/integrations" target="_blank" rel="noopener noreferrer" className="underline font-medium">Qonto → Integracions → API</a></p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Organization Slug *</label>
                    <input type="text" value={apiSetup.orgSlug || ''} onChange={(e) => setApiSetup({ ...apiSetup, orgSlug: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="nom-empresa-xxxxx" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Secret Key *</label>
                    <input type="password" value={apiSetup.secretKey || ''} onChange={(e) => setApiSetup({ ...apiSetup, secretKey: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="••••••••" />
                  </div>
                </>
              )}

              {apiSetup.provider === 'GOCARDLESS' && (
                <>
                  <div className="bg-teal-50 text-teal-800 rounded-lg p-3 text-xs">
                    <p>Obtén les credencials a <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noopener noreferrer" className="underline font-medium">Plaid Dashboard → Developers → Keys</a></p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Client ID *</label>
                    <input type="text" value={apiSetup.clientId || ''} onChange={(e) => setApiSetup({ ...apiSetup, clientId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Secret (Sandbox) *</label>
                    <input type="password" value={apiSetup.secret || ''} onChange={(e) => setApiSetup({ ...apiSetup, secret: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="••••••••" />
                  </div>
                </>
              )}

              {apiSetup.provider === 'RENTMAN' && (
                <>
                  <div className="bg-orange-50 text-orange-800 rounded-lg p-3 text-xs">
                    <p>Obtén el token API a Rentman → Configuració → API</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">API Token *</label>
                    <input type="password" value={apiSetup.apiToken || ''} onChange={(e) => setApiSetup({ ...apiSetup, apiToken: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="••••••••" />
                  </div>
                </>
              )}

              {apiSetup.provider === 'SHELLY' && (
                <>
                  <div className="bg-green-50 text-green-800 rounded-lg p-3 text-xs">
                    <p>Obtén les credencials a l'app Shelly → Configuració d'usuari → "Authorization cloud key"</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Auth Key *</label>
                    <input type="password" value={apiSetup.authKey || ''} onChange={(e) => setApiSetup({ ...apiSetup, authKey: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="Cloud auth key" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Server URI *</label>
                    <input type="text" value={apiSetup.serverUri || ''} onChange={(e) => setApiSetup({ ...apiSetup, serverUri: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="shelly-243-eu.shelly.cloud" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Device ID *</label>
                    <input type="text" value={apiSetup.deviceId || ''} onChange={(e) => setApiSetup({ ...apiSetup, deviceId: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-background" placeholder="ece334e4da34" />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setApiSetup(null)} className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 transition-colors">
                Cancel·lar
              </button>
              <button onClick={handleSaveApiCredentials}
                disabled={!!actionLoading}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50">
                {actionLoading ? 'Guardant...' : 'Guardar i connectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de setup Zoho */}
      {zohoSetup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Mail size={20} className="text-red-600" />
              Configurar Zoho Mail
            </h3>

            <div className="space-y-4 text-sm">
              <div className="bg-blue-50 text-blue-800 rounded-lg p-3">
                <p className="font-medium mb-1">Passos per obtenir les credencials:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Ves a <a href="https://api-console.zoho.eu" target="_blank" rel="noopener noreferrer" className="underline font-medium">api-console.zoho.eu</a></li>
                  <li>Crea una app "Self Client" o "Server-based"</li>
                  <li>Copia el Client ID i Client Secret</li>
                  <li>Afegeix la redirect URI que veuràs després de guardar</li>
                </ol>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Client ID *</label>
                <input
                  type="text"
                  value={zohoSetup.clientId}
                  onChange={(e) => setZohoSetup({ ...zohoSetup, clientId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                  placeholder="1000.XXXXX..."
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Client Secret *</label>
                <input
                  type="password"
                  value={zohoSetup.clientSecret}
                  onChange={(e) => setZohoSetup({ ...zohoSetup, clientSecret: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Account ID (opcional)</label>
                <input
                  type="text"
                  value={zohoSetup.accountId}
                  onChange={(e) => setZohoSetup({ ...zohoSetup, accountId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                  placeholder="Es detecta automàticament"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Adreça d'enviament</label>
                <input
                  type="email"
                  value={zohoSetup.fromAddress}
                  onChange={(e) => setZohoSetup({ ...zohoSetup, fromAddress: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setZohoSetup(null)}
                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel·lar
              </button>
              <button
                onClick={handleSaveZohoCredentials}
                disabled={actionLoading === 'ZOHO_SAVE'}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'ZOHO_SAVE' ? 'Guardant...' : 'Guardar i continuar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
