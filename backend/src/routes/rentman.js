const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const rentman = require('../services/rentmanService');
const rentmanSync = require('../services/rentmanSyncService');
const { redis } = require('../config/redis');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

const router = express.Router();

router.use(authenticate);

// ===========================================
// Connexió
// ===========================================

/**
 * GET /api/rentman/status — Comprovar connexió amb Rentman
 */
router.get('/status', authorize('ADMIN'), async (req, res, next) => {
  try {
    const status = await rentman.testConnection();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Projectes
// ===========================================

/**
 * GET /api/rentman/projects — Llistar projectes de Rentman
 */
router.get('/projects', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const projects = await rentman.getProjects({ limit, offset });
    res.json({ data: projects });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/rentman/projects/:id — Detall projecte
 */
router.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await rentman.getProject(req.params.id);
    res.json(project);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/rentman/projects/:id/equipment — Equip d'un projecte
 */
router.get('/projects/:id/equipment', async (req, res, next) => {
  try {
    const equipment = await rentman.getProjectEquipment(req.params.id);
    res.json({ data: equipment });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Factures
// ===========================================

/**
 * GET /api/rentman/invoices — Llistar factures de Rentman
 */
router.get('/invoices', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const invoices = await rentman.getInvoices({ limit, offset });
    res.json({ data: invoices });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/rentman/invoices/:id — Detall factura Rentman
 */
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const [invoice, lines] = await Promise.all([
      rentman.getInvoice(req.params.id),
      rentman.getInvoiceLines(req.params.id),
    ]);
    res.json({ ...invoice, lines });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Sincronització → SeitoCamera Admin
// ===========================================

/**
 * POST /api/rentman/sync/invoices — Sincronitzar factures de Rentman
 *
 * Utilitza el servei rentmanSyncService. Crea les noves i actualitza
 * les existents (status, dueDate, imports, projectReference…).
 *
 * Query params opcionals:
 *   - recentDays=N — només factures modificades en els últims N dies
 *   - skipProjects=true — no consultar projectes (més ràpid)
 */
router.post('/sync/invoices', authorize('ADMIN'), async (req, res, next) => {
  try {
    const recentDays = req.query.recentDays ? parseInt(req.query.recentDays) : null;
    const fetchProjects = req.query.skipProjects !== 'true';

    const result = await rentmanSync.syncAllInvoices({
      fetchProjects,
      onlyRecentDays: recentDays,
    });

    // Desar timestamp manual a Redis
    await redis.set('rentman:lastManualSync', Date.now().toString());

    res.json({
      message: 'Sincronització completada',
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/rentman/sync/status — Estat de l'última sincronització
 */
router.get('/sync/status', async (req, res, next) => {
  try {
    const [lastSync, lastManualSync, lastFullSync, lastWeeklySync, lastResult, lastFullResult] = await Promise.all([
      redis.get('rentman:lastSync'),
      redis.get('rentman:lastManualSync'),
      redis.get('rentman:lastFullSync'),
      redis.get('rentman:lastWeeklySync'),
      redis.get('rentman:lastSyncResult'),
      redis.get('rentman:lastFullSyncResult'),
    ]);

    res.json({
      lastIncrementalSync: lastSync ? new Date(parseInt(lastSync)).toISOString() : null,
      lastManualSync: lastManualSync ? new Date(parseInt(lastManualSync)).toISOString() : null,
      lastNightlyFullSync: lastFullSync ? new Date(parseInt(lastFullSync)).toISOString() : null,
      lastWeeklyProjectSync: lastWeeklySync ? new Date(parseInt(lastWeeklySync)).toISOString() : null,
      lastIncrementalResult: lastResult ? JSON.parse(lastResult) : null,
      lastNightlyResult: lastFullResult ? JSON.parse(lastFullResult) : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/rentman/backfill/project-references — Emplenar projectReference a factures existents
 *
 * Per cada factura emesa que té rentmanInvoiceId però encara no projectReference,
 * consulta Rentman, obté el projecte i guarda la referència + nom.
 * Útil per factures importades abans d'afegir aquests camps.
 */
router.post('/backfill/project-references', authorize('ADMIN'), async (req, res, next) => {
  try {
    // 1. Per factures que ja tenen rentmanInvoiceId però no projectReference
    const pendingWithId = await prisma.issuedInvoice.findMany({
      where: {
        rentmanInvoiceId: { not: null },
        projectReference: null,
      },
      select: { id: true, rentmanInvoiceId: true, rentmanProjectId: true },
    });

    // 2. Per factures sense rentmanInvoiceId (importades abans que afegíssim el camp),
    //    les relacionem per invoiceNumber consultant Rentman
    const unmapped = await prisma.issuedInvoice.findMany({
      where: {
        rentmanInvoiceId: null,
        projectReference: null,
      },
      select: { id: true, invoiceNumber: true },
    });

    logger.info(`Backfill project references: ${pendingWithId.length} amb ID Rentman + ${unmapped.length} per mapejar per número`);

    let processed = 0;
    let updated = 0;
    let errors = 0;

    // Mapa: invoiceNumber → rentman invoice (per la segona part)
    let rentmanByNumber = null;

    // --- Bucle 1: factures ja enllaçades ---
    for (const inv of pendingWithId) {
      try {
        let rentmanProjectId = inv.rentmanProjectId;

        if (!rentmanProjectId) {
          // Obtenir factura Rentman per trobar el project
          const rmInv = await rentman.getInvoice(inv.rentmanInvoiceId);
          const m = String(rmInv.project || '').match(/\/projects\/(\d+)/);
          if (m) rentmanProjectId = m[1];
        }

        if (!rentmanProjectId) {
          processed++;
          continue;
        }

        const project = await rentman.getProject(rentmanProjectId);
        await prisma.issuedInvoice.update({
          where: { id: inv.id },
          data: {
            projectReference: project.reference || null,
            projectName: project.name || null,
            rentmanProjectId,
          },
        });
        updated++;
        processed++;
      } catch (e) {
        errors++;
        logger.warn(`Backfill error factura ${inv.id}: ${e.message}`);
      }
    }

    // --- Bucle 2: factures sense rentmanInvoiceId ---
    if (unmapped.length > 0) {
      // Carregar totes les factures de Rentman per fer mapping per número
      let allRentmanInvoices = [];
      let offset = 0;
      const pageSize = 500;
      let hasMore = true;
      while (hasMore) {
        const batch = await rentman.getInvoices({ limit: pageSize, offset });
        const arr = Array.isArray(batch) ? batch : [];
        allRentmanInvoices = allRentmanInvoices.concat(arr);
        offset += pageSize;
        hasMore = arr.length === pageSize;
      }
      rentmanByNumber = new Map();
      for (const ri of allRentmanInvoices) {
        if (ri.number) rentmanByNumber.set(String(ri.number), ri);
      }

      for (const inv of unmapped) {
        try {
          const rmInv = rentmanByNumber.get(String(inv.invoiceNumber));
          if (!rmInv) {
            processed++;
            continue;
          }
          const rentmanInvoiceId = String(rmInv.id);
          let rentmanProjectId = null;
          let projectReference = null;
          let projectName = null;

          const m = String(rmInv.project || '').match(/\/projects\/(\d+)/);
          if (m) {
            rentmanProjectId = m[1];
            try {
              const project = await rentman.getProject(rentmanProjectId);
              projectReference = project.reference || null;
              projectName = project.name || null;
            } catch (e) {
              logger.warn(`No s'ha pogut obtenir projecte ${rentmanProjectId}: ${e.message}`);
            }
          }

          await prisma.issuedInvoice.update({
            where: { id: inv.id },
            data: {
              rentmanInvoiceId,
              rentmanProjectId,
              projectReference,
              projectName,
            },
          });
          if (projectReference) updated++;
          processed++;
        } catch (e) {
          errors++;
          logger.warn(`Backfill error factura ${inv.id}: ${e.message}`);
        }
      }
    }

    logger.info(`Backfill project references: ${updated}/${processed} actualitzades, ${errors} errors`);

    res.json({
      message: 'Backfill completat',
      total: pendingWithId.length + unmapped.length,
      processed,
      updated,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/rentman/sync/projects — Sincronitzar projectes de Rentman → RentalProject
 * Només importa projectes en curs o futurs. No toca projectes antics.
 */
router.post('/sync/projects', authorize('ADMIN'), async (req, res, next) => {
  try {
    const result = await rentmanSync.syncProjects();

    // Guardar timestamp a Redis
    await redis.set('rentman:lastProjectSync', Date.now().toString());

    res.json({
      message: 'Sincronització de projectes completada',
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/rentman/reconcile/projects
 *
 * Auditoria one-shot: per cada projecte intern amb rentmanProjectId, crida
 * Rentman, refresca el camp `rentmanStatus`, i identifica els que NO estan
 * confirmats (option, quotation, draft, cancelled, o estats desconeguts).
 *
 * Per defecte només reporta. Passa `?archive=1` per arxivar (status=CLOSED)
 * els projectes no-confirmats que encara no estaven tancats — així desapareixen
 * de la vista activa sense esborrar dades històriques.
 */
router.post('/reconcile/projects', authorize('ADMIN'), async (req, res, next) => {
  try {
    const archive = req.query.archive === '1';

    // Carregar el catàleg /statuses + /subprojects una sola vegada per
    // resoldre l'estat actual de cada projecte (a Rentman v3 NO viu a /projects).
    const statusMap = await rentmanSync.fetchProjectStatusMap();

    const internalProjects = await prisma.rentalProject.findMany({
      where: { rentmanProjectId: { not: null } },
      select: {
        id: true, name: true, status: true,
        rentmanProjectId: true, rentmanStatus: true,
      },
    });

    const report = {
      total: internalProjects.length,
      refreshed: 0,
      stillConfirmed: 0,
      nowOrphan: [],   // existeixen al sistema però ja no son confirmats a Rentman
      notFoundOnRentman: [], // existeixen al sistema però Rentman no els troba (sense subproject)
      archived: 0,
      errors: [],
    };

    for (const p of internalProjects) {
      try {
        const statusName = statusMap.get(String(p.rentmanProjectId)) || null;
        const mapped = rentmanSync.mapRentmanStatusToProjectStatus(statusName);
        report.refreshed++;

        // Refrescar rentmanStatus al sistema
        if (statusName && p.rentmanStatus !== statusName) {
          await prisma.rentalProject.update({
            where: { id: p.id },
            data: { rentmanStatus: statusName },
          });
        }

        if (!statusName) {
          report.notFoundOnRentman.push({ id: p.id, name: p.name });
          if (archive && p.status !== 'CLOSED') {
            await prisma.rentalProject.update({
              where: { id: p.id },
              data: { status: 'CLOSED' },
            });
            report.archived++;
          }
        } else if (!mapped) {
          report.nowOrphan.push({
            id: p.id, name: p.name, internalStatus: p.status,
            rentmanStatus: statusName,
          });
          if (archive && p.status !== 'CLOSED') {
            await prisma.rentalProject.update({
              where: { id: p.id },
              data: { status: 'CLOSED' },
            });
            report.archived++;
          }
        } else {
          report.stillConfirmed++;
        }
      } catch (err) {
        report.errors.push({ id: p.id, name: p.name, error: err.message });
      }
    }

    res.json({
      message: archive
        ? `Reconcile + arxiu completat (${report.archived} arxivats)`
        : 'Reconcile completat (només report — passa ?archive=1 per arxivar)',
      ...report,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
