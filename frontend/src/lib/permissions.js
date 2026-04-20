/**
 * Configuració de permisos per rol
 *
 * Defineix quines seccions del sidebar i panells del dashboard
 * pot veure cada rol d'usuari, i a quin nivell d'acció.
 *
 * Nivells d'acció:
 *   'read'  → veure/consultar
 *   'write' → crear/editar (inclou read)
 *   'admin' → eliminar + accions privilegiades (inclou write)
 *
 * Seccions disponibles:
 * - dashboard, receivedInvoices, issuedInvoices, suppliers,
 *   clients, bank, conciliation, reminders, users
 *
 * Rol CUSTOM: els permisos es llegeixen de user.customPermissions
 * (JSON { sectionKey: 'read' | 'write' | 'admin' }).
 */

export const SECTIONS = {
  dashboard: { label: 'Dashboard', path: '/' },
  receivedInvoices: { label: 'Factures rebudes', path: '/invoices/received' },
  issuedInvoices: { label: 'Factures emeses', path: '/invoices/issued' },
  suppliers: { label: 'Proveïdors', path: '/suppliers' },
  clients: { label: 'Clients', path: '/clients' },
  bank: { label: 'Moviments bancaris', path: '/bank' },
  conciliation: { label: 'Conciliació', path: '/conciliation' },
  reminders: { label: 'Recordatoris', path: '/reminders' },
  equipment: { label: 'Inventari equips', path: '/equipment' },
  users: { label: 'Usuaris', path: '/users' },
};

// Claus de secció que es poden assignar a un rol CUSTOM
// (la secció "users" queda exclosa — sempre és ADMIN)
export const CUSTOMIZABLE_SECTIONS = [
  'dashboard',
  'receivedInvoices',
  'issuedInvoices',
  'suppliers',
  'clients',
  'bank',
  'conciliation',
  'reminders',
  'equipment',
];

const LEVEL_ORDER = { read: 1, write: 2, admin: 3 };

export const LEVEL_LABELS = {
  read: 'Lectura',
  write: 'Lectura + edició',
  admin: 'Total (amb eliminar)',
};

// Permisos per rol: mapa { secció → nivell màxim }
export const ROLE_PERMISSIONS = {
  ADMIN: {
    dashboard: 'admin',
    receivedInvoices: 'admin',
    issuedInvoices: 'admin',
    suppliers: 'admin',
    clients: 'admin',
    bank: 'admin',
    conciliation: 'admin',
    reminders: 'admin',
    equipment: 'admin',
    users: 'admin',
    // Panells del dashboard
    _dashboardPanels: [
      'receivedPending', 'issuedPending', 'unconciliated',
      'reminders', 'recentReceived', 'unconciliatedList',
    ],
  },
  EDITOR: {
    dashboard: 'read',
    receivedInvoices: 'write',
    issuedInvoices: 'write',
    suppliers: 'write',
    clients: 'write',
    bank: 'write',
    conciliation: 'write',
    reminders: 'write',
    equipment: 'write',
    _dashboardPanels: [
      'receivedPending', 'issuedPending', 'unconciliated',
      'reminders', 'recentReceived', 'unconciliatedList',
    ],
  },
  VIEWER: {
    dashboard: 'read',
    reminders: 'write',
    _dashboardPanels: ['reminders'],
  },
};

/**
 * Retorna el nivell efectiu d'un usuari per una secció, o null si no hi té accés.
 */
export function getUserLevel(user, sectionKey) {
  if (!user) return null;
  // La secció "users" sempre és només ADMIN, mai CUSTOM
  if (sectionKey === 'users') {
    return user.role === 'ADMIN' ? 'admin' : null;
  }
  if (user.role === 'CUSTOM') {
    const perms = user.customPermissions || {};
    return perms[sectionKey] || null;
  }
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if (!rolePerms) return null;
  return rolePerms[sectionKey] || null;
}

/**
 * Comprova si un usuari té com a mínim el nivell indicat en una secció.
 */
export function hasLevel(user, sectionKey, requiredLevel = 'read') {
  const level = getUserLevel(user, sectionKey);
  if (!level) return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[requiredLevel];
}

/**
 * Compatibilitat: comprova si té accés bàsic (lectura) a una secció.
 * Accepta tant un objecte user com només un role (compatible amb l'API antiga).
 */
export function canAccessSection(userOrRole, sectionKey) {
  if (!userOrRole) return false;
  // Si ens passen un string (rol antic), el convertim a user-like
  if (typeof userOrRole === 'string') {
    return hasLevel({ role: userOrRole }, sectionKey, 'read');
  }
  return hasLevel(userOrRole, sectionKey, 'read');
}

/**
 * Retorna true si l'usuari pot escriure (crear/editar) en una secció.
 */
export function canWrite(user, sectionKey) {
  return hasLevel(user, sectionKey, 'write');
}

/**
 * Retorna true si l'usuari pot eliminar o fer accions privilegiades.
 */
export function canDelete(user, sectionKey) {
  return hasLevel(user, sectionKey, 'admin');
}

/**
 * Panells del dashboard que pot veure l'usuari.
 * Per CUSTOM, mostrem els panells lligats a les seccions accessibles.
 */
const PANEL_TO_SECTION = {
  receivedPending: 'receivedInvoices',
  issuedPending: 'issuedInvoices',
  unconciliated: 'conciliation',
  reminders: 'reminders',
  recentReceived: 'receivedInvoices',
  unconciliatedList: 'conciliation',
};

export function canSeeDashboardPanel(user, panelKey) {
  if (!user) return false;
  if (user.role === 'CUSTOM') {
    const sectionKey = PANEL_TO_SECTION[panelKey];
    if (!sectionKey) return false;
    return canAccessSection(user, sectionKey);
  }
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if (!rolePerms) return false;
  return (rolePerms._dashboardPanels || []).includes(panelKey);
}

/**
 * Retorna la llista de claus de seccions a les que l'usuari té accés.
 */
export function getAllowedSections(userOrRole) {
  if (!userOrRole) return [];
  const user = typeof userOrRole === 'string' ? { role: userOrRole } : userOrRole;
  return Object.keys(SECTIONS).filter((key) => canAccessSection(user, key));
}
