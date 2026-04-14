/**
 * Configuració de permisos per rol
 *
 * Defineix quines seccions del sidebar i panells del dashboard
 * pot veure cada rol d'usuari.
 *
 * Seccions disponibles:
 * - dashboard: Panell principal
 * - receivedInvoices: Factures rebudes
 * - issuedInvoices: Factures emeses
 * - suppliers: Proveïdors
 * - clients: Clients
 * - bank: Moviments bancaris
 * - conciliation: Conciliació
 * - reminders: Recordatoris
 * - users: Gestió d'usuaris (sempre només ADMIN)
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
  users: { label: 'Usuaris', path: '/users' },
};

// Permisos per rol: quines seccions pot veure cada rol
export const ROLE_PERMISSIONS = {
  ADMIN: {
    sections: [
      'dashboard',
      'receivedInvoices',
      'issuedInvoices',
      'suppliers',
      'clients',
      'bank',
      'conciliation',
      'reminders',
      'users',
    ],
    // Panells del dashboard que pot veure
    dashboardPanels: [
      'receivedPending',    // KPI factures pendents rebudes
      'issuedPending',      // KPI factures pendents emeses
      'unconciliated',      // KPI moviments sense conciliar
      'reminders',          // KPI recordatoris
      'recentReceived',     // Llista últimes factures rebudes
      'unconciliatedList',  // Llista moviments sense conciliar
    ],
  },
  EDITOR: {
    sections: [
      'dashboard',
      'receivedInvoices',
      'issuedInvoices',
      'suppliers',
      'clients',
      'bank',
      'conciliation',
      'reminders',
    ],
    dashboardPanels: [
      'receivedPending',
      'issuedPending',
      'unconciliated',
      'reminders',
      'recentReceived',
      'unconciliatedList',
    ],
  },
  VIEWER: {
    sections: [
      'dashboard',
      'reminders',
    ],
    dashboardPanels: [
      'reminders',
    ],
  },
};

/**
 * Comprova si un rol té accés a una secció
 */
export function canAccessSection(role, sectionKey) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.sections.includes(sectionKey);
}

/**
 * Comprova si un rol pot veure un panell del dashboard
 */
export function canSeeDashboardPanel(role, panelKey) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.dashboardPanels.includes(panelKey);
}

/**
 * Retorna les seccions permeses per un rol
 */
export function getAllowedSections(role) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return [];
  return perms.sections;
}
