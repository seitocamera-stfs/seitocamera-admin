/**
 * Middleware de control d'accés per secció i per nivell d'acció.
 * Mirror de la configuració de permisos del frontend.
 *
 * Per rols fixos (ADMIN / EDITOR / VIEWER) els permisos són hardcoded.
 * Per rol CUSTOM, els permisos es llegeixen de user.customPermissions
 * (JSON format { sectionKey: 'read' | 'write' | 'admin' }).
 *
 * Nivells:
 *   'read'  → pot veure i consultar
 *   'write' → pot crear i editar (inclou 'read')
 *   'admin' → pot eliminar i fer accions privilegiades (inclou 'write')
 */

const LEVEL_ORDER = { read: 1, write: 2, admin: 3 };

// Permisos per secció segons el rol (usats quan role != CUSTOM)
const ROLE_PERMISSIONS = {
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
    // no users
  },
  VIEWER: {
    dashboard: 'read',
    reminders: 'write', // el VIEWER pot crear recordatoris i notes
  },
};

/**
 * Retorna el nivell d'accés efectiu d'un usuari per una secció.
 * Si l'usuari no té accés, retorna null.
 */
function getUserLevel(user, section) {
  if (!user) return null;
  // Users section sempre és només ADMIN real, mai CUSTOM
  if (section === 'users') {
    return user.role === 'ADMIN' ? 'admin' : null;
  }
  if (user.role === 'CUSTOM') {
    const perms = user.customPermissions || {};
    return perms[section] || null;
  }
  const rolePerms = ROLE_PERMISSIONS[user.role];
  if (!rolePerms) return null;
  return rolePerms[section] || null;
}

/**
 * Comprova si un usuari té com a mínim el nivell requerit per una secció.
 */
function hasLevel(user, section, requiredLevel = 'read') {
  const level = getUserLevel(user, section);
  if (!level) return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[requiredLevel];
}

/**
 * Middleware que bloqueja l'accés si l'usuari no té com a mínim
 * el nivell requerit per la secció indicada.
 *
 * @param {string} section - Clau de la secció
 * @param {'read'|'write'|'admin'} level - Nivell mínim (per defecte 'read')
 */
function requireSection(section, level = 'read') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticat' });
    }
    if (!hasLevel(req.user, section, level)) {
      return res.status(403).json({
        error: 'No tens accés a aquesta secció',
        section,
        requiredLevel: level,
        role: req.user.role,
      });
    }
    next();
  };
}

/**
 * Helper per rutes que només requereixen un nivell d'acció concret
 * (write o admin) dins d'una secció ja validada per router.use(requireSection(...)).
 * Ús: router.post('/', requireLevel('suppliers', 'write'), ...)
 */
function requireLevel(section, level) {
  return requireSection(section, level);
}

// Compatibilitat: exportem el mapa antic per si algun codi el necessita
const ROLE_SECTIONS = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, Object.keys(perms)])
);

module.exports = {
  requireSection,
  requireLevel,
  hasLevel,
  getUserLevel,
  ROLE_PERMISSIONS,
  ROLE_SECTIONS,
};
