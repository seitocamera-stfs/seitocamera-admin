/**
 * AuditService — registre universal d'accions sobre entitats sensibles.
 *
 * Ús típic des d'una ruta:
 *   await logAudit(req, {
 *     entityType: 'FiscalYear',
 *     entityId: fy.id,
 *     action: 'LOCK',
 *     before: { locked: false },
 *     after: { locked: true, lockedAt: new Date() },
 *   });
 *
 * El servei calcula automàticament `changedFields` a partir de before/after.
 * Si el log falla per qualsevol motiu, NO bloqueja l'operació principal:
 * només es registra un warning.
 */
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

/**
 * Calcula els camps que han canviat entre dos snapshots JSON.
 */
function diffFields(before, after) {
  if (!before || !after) return [];
  const changed = new Set();
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.add(key);
    }
  }
  for (const key of Object.keys(after)) {
    if (!(key in before)) changed.add(key);
  }
  return Array.from(changed);
}

/**
 * Registra una entrada d'auditoria.
 *
 * @param {object} req - Request d'Express (per extreure user, IP, user-agent)
 * @param {object} opts
 * @param {string} opts.entityType - Tipus d'entitat (ex: 'JournalEntry', 'FiscalYear')
 * @param {string} opts.entityId - ID de l'entitat afectada
 * @param {string} opts.action - 'CREATE' | 'UPDATE' | 'DELETE' | 'POST' | 'REVERSE' | 'LOCK' | 'UNLOCK'
 * @param {object} [opts.before] - Snapshot abans del canvi
 * @param {object} [opts.after] - Snapshot després del canvi
 * @param {string} [opts.companyId] - Empresa afectada (opcional)
 */
async function logAudit(req, opts) {
  try {
    const user = req?.user;
    if (!user?.id) {
      logger.warn(`auditService: intent de registre sense usuari (${opts.entityType}/${opts.action})`);
      return;
    }

    const changedFields = opts.before && opts.after
      ? diffFields(opts.before, opts.after)
      : [];

    await prisma.auditLog.create({
      data: {
        companyId: opts.companyId || null,
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: opts.action,
        beforeData: opts.before || null,
        afterData: opts.after || null,
        changedFields,
        userId: user.id,
        userEmail: user.email || null,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
        userAgent: req?.headers?.['user-agent'] || null,
      },
    });
  } catch (error) {
    // No bloquejar l'operació principal si el log falla
    logger.warn(`auditService: error registrant audit (${opts.entityType}/${opts.action}): ${error.message}`);
  }
}

module.exports = { logAudit };
