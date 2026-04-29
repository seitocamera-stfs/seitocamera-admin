import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, Package, ListTodo, AlertTriangle, MessageCircle, UserCheck, X } from 'lucide-react';
import api from '../../lib/api';
import usePushNotifications from '../../hooks/usePushNotifications';

// ===========================================
// Constants
// ===========================================

const POLL_INTERVAL = 30_000; // 30 segons

const TYPE_CONFIG = {
  project_created:        { icon: Package, color: '#3b82f6', label: 'Projecte' },
  project_status:         { icon: Package, color: '#8b5cf6', label: 'Projecte' },
  project_assigned:       { icon: UserCheck, color: '#06b6d4', label: 'Assignació' },
  task_assigned:          { icon: ListTodo, color: '#f59e0b', label: 'Tasca' },
  incident_critical:      { icon: AlertTriangle, color: '#ef4444', label: 'Incident crític' },
  incident_assigned:      { icon: AlertTriangle, color: '#f97316', label: 'Incident' },
  incident_client_notify: { icon: AlertTriangle, color: '#dc2626', label: 'Avisar client' },
  urgent_communication:   { icon: MessageCircle, color: '#ef4444', label: 'Urgent' },
};

const DEFAULT_CONFIG = { icon: Bell, color: '#6b7280', label: 'Notificació' };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ara';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ===========================================
// Component
// ===========================================

export default function NotificationBell() {
  const navigate = useNavigate();
  const push = usePushNotifications();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  // Fetch notificacions
  const fetchNotifications = useCallback(async (onlyCount = false) => {
    try {
      if (onlyCount) {
        const { data } = await api.get('/operations/notifications', { params: { unreadOnly: true } });
        setUnreadCount(data.unreadCount ?? 0);
      } else {
        setLoading(true);
        const { data } = await api.get('/operations/notifications');
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount ?? 0);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, []);

  // Polling cada 30s (només comptador)
  useEffect(() => {
    fetchNotifications(true);
    const interval = setInterval(() => fetchNotifications(true), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Carregar llista completa quan s'obre el panell
  useEffect(() => {
    if (open) fetchNotifications(false);
  }, [open, fetchNotifications]);

  // Tancar amb clic fora
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const handleMarkRead = async (id) => {
    try {
      await api.put(`/operations/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.put('/operations/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* */ }
  };

  const handleClickNotification = (notif) => {
    if (!notif.isRead) handleMarkRead(notif.id);

    // Navegar a l'entitat si existeix
    if (notif.entityType && notif.entityId) {
      const routes = {
        project: `/operations/projects`,
        task: `/operations/tasks`,
        incident: `/operations/incidents`,
      };
      const route = routes[notif.entityType];
      if (route) navigate(route);
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Botó campana */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
        title="Notificacions"
      >
        <Bell size={18} className="text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1"
            style={{ background: '#ef4444' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panell dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[340px] max-w-[calc(100vw-24px)] bg-white border rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ maxHeight: 'min(480px, calc(100vh - 100px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/80">
            <h3 className="text-xs font-semibold text-gray-900">Notificacions</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md active:bg-gray-200"
                  title="Marcar totes com llegides"
                >
                  <CheckCheck size={13} /> Llegir tot
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-gray-100 lg:hidden"
              >
                <X size={16} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Llista */}
          <div className="overflow-y-auto" style={{ maxHeight: 'min(400px, calc(100vh - 160px))' }}>
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">Carregant...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center">
                <Bell size={24} className="mx-auto text-gray-200 mb-2" />
                <p className="text-xs text-gray-400">Cap notificació</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const config = TYPE_CONFIG[notif.type] || DEFAULT_CONFIG;
                const Icon = config.icon;
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleClickNotification(notif)}
                    className={`w-full text-left flex gap-3 px-4 py-3 border-b last:border-b-0 transition-colors active:bg-gray-100 ${
                      notif.isRead ? 'bg-white' : 'bg-blue-50/40'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: `${config.color}15` }}
                    >
                      <Icon size={14} style={{ color: config.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-900 truncate">{notif.title}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${config.color}15`, color: config.color }}>
                          {config.label}
                        </span>
                        {notif.priority === 'urgent' && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-600">Urgent</span>
                        )}
                        {!notif.isRead && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 ml-auto" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Push notifications toggle */}
          {push.isSupported && (
            <div className="border-t px-4 py-2.5 bg-gray-50/80 flex items-center justify-between">
              {push.isSubscribed ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-green-600">
                    <BellRing size={13} />
                    <span>Push activat</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={push.sendTest}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                    >
                      Test
                    </button>
                    <button
                      onClick={push.unsubscribe}
                      className="text-[10px] text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-gray-100"
                    >
                      Desactivar
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={push.subscribe}
                  disabled={push.loading || push.permission === 'denied'}
                  className="w-full flex items-center justify-center gap-2 py-1.5 text-[11px] font-medium text-[#00617F] hover:bg-[#00617F]/5 rounded-lg transition-colors disabled:opacity-40"
                >
                  <BellRing size={13} />
                  {push.permission === 'denied'
                    ? 'Notificacions push bloquejades al navegador'
                    : push.loading
                      ? 'Activant...'
                      : 'Activar notificacions push'
                  }
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
