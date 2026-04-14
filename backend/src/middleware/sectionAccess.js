/**
 * Middleware de control d'accés per secció.
 * Mirror de la configuració de permisos del frontend.
 *
 * Restringe l'accés a rutes senceres segons el rol de l'usuari.
 * Un VIEWER, per exemple, no pot ni llegir factures ni proveïdors.
 */

const ROLE_SECTIONS = {
  ADMIN: [
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
  EDITOR: [
    'dashboard',
    'receivedInvoices',
    'issuedInvoices',
    'suppliers',
    'clients',
    'bank',
    'conciliation',
    'reminders',
  ],
  VIEWER: [
    'dashboard',
    'reminders',
  ],
};

/**
 * Middleware que bloqueja l'accés complet a una secció si el rol no ho permet.
 * Ús: requireSection('suppliers') → només ADMIN i EDITOR poden accedir.
 *
 * @param {string} section - Clau de la secció (ha de coincidir amb ROLE_SECTIONS)
 */
function requireSection(section) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticat' });
    }

    const allowedSections = ROLE_SECTIONS[req.user.role];
    if (!allowedSections || !allowedSections.includes(section)) {
      return res.status(403).json({
        error: 'No tens accés a aquesta secció',
        section,
        role: req.user.role,
      });
    }

    next();
  };
}

module.exports = { requireSection, ROLE_SECTIONS };
