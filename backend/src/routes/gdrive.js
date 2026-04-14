const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const gdrive = require('../services/gdriveService');
const { upload } = require('../config/upload');
const { logger } = require('../config/logger');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');

const router = express.Router();

router.use(authenticate);

// ===========================================
// Connexió i info
// ===========================================

/**
 * GET /api/gdrive/status — Comprovar connexió amb Google Drive
 */
router.get('/status', authorize('ADMIN'), async (req, res, next) => {
  try {
    const status = await gdrive.testConnection();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/info — Info d'espai del compte
 */
router.get('/info', authorize('ADMIN'), async (req, res, next) => {
  try {
    const info = await gdrive.getStorageInfo();
    res.json(info);
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Carpetes
// ===========================================

/**
 * POST /api/gdrive/init — Crear estructura de carpetes
 */
router.post('/init', authorize('ADMIN'), async (req, res, next) => {
  try {
    const folders = await gdrive.ensureFolderStructure();
    res.json({
      message: 'Estructura de carpetes creada correctament',
      folders: Object.fromEntries(
        Object.entries(folders).map(([k, v]) => [k, { id: v.id, name: v.name }])
      ),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/files?folder= — Llistar fitxers d'una carpeta
 */
router.get('/files', async (req, res, next) => {
  try {
    const folder = req.query.folder || 'factures-rebudes';
    const files = await gdrive.listFiles(folder);
    res.json({ data: files });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Fitxers
// ===========================================

/**
 * POST /api/gdrive/upload — Pujar fitxer a Google Drive
 */
router.post('/upload', authorize('ADMIN', 'EDITOR'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Cap fitxer enviat' });
    }

    const folder = req.query.folder || req.body.folder || 'documents';
    const result = await gdrive.uploadFile(req.file.path, folder, req.file.originalname);

    res.json({
      message: 'Fitxer pujat correctament',
      file: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/file/:fileId/link — Obtenir link de visualització
 */
router.get('/file/:fileId/link', async (req, res, next) => {
  try {
    const fileInfo = await gdrive.getFileLink(req.params.fileId);
    res.json(fileInfo);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/file/:fileId/download — Descarregar fitxer
 */
router.get('/file/:fileId/download', async (req, res, next) => {
  try {
    const { getDriveClient } = require('../services/gdriveService');
    const drive = getDriveClient();

    const meta = await drive.files.get({
      fileId: req.params.fileId,
      fields: 'name, mimeType',
    });

    const response = await drive.files.get(
      { fileId: req.params.fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', meta.data.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${meta.data.name}"`);
    response.data.pipe(res);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/gdrive/file/:fileId — Eliminar fitxer
 */
router.delete('/file/:fileId', authorize('ADMIN'), async (req, res, next) => {
  try {
    await gdrive.deleteFile(req.params.fileId);
    res.json({ message: 'Fitxer eliminat' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/new-files?folder=&since= — Fitxers nous des d'una data
 * Per sincronització: detectar PDFs pujats manualment
 */
router.get('/new-files', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const folder = req.query.folder || 'factures-rebudes';
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000); // últimes 24h per defecte

    const files = await gdrive.getNewFiles(folder, since);
    res.json({ data: files, since: since.toISOString() });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Sincronització inbox → factures
// ===========================================

/**
 * POST /api/gdrive/sync — Executar sincronització manual
 * Processa PDFs de la carpeta inbox
 */
router.post('/sync', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { syncGdriveFiles } = require('../jobs/gdriveSyncJob');
    const results = await syncGdriveFiles();
    res.json({
      message: 'Sincronització completada',
      ...results,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/sync-status — Estat de l'última sincronització
 */
router.get('/sync-status', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const lastSync = await redis.get('gdrive:lastSync');
    const lastReport = await redis.get('gdrive:lastSyncReport');

    res.json({
      lastSync: lastSync ? new Date(parseInt(lastSync)).toISOString() : null,
      lastReport: lastReport ? JSON.parse(lastReport) : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/gdrive/inbox — Veure contingut de la carpeta inbox
 */
router.get('/inbox', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const facturesRebudesId = await gdrive.getSubfolderId('factures-rebudes');
    const inbox = await gdrive.findOrCreateFolder('inbox', facturesRebudesId);

    const drive = gdrive.getDriveClient();
    const filesRes = await drive.files.list({
      q: `'${inbox.id}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
      orderBy: 'createdTime desc',
    });

    res.json({
      folderId: inbox.id,
      files: filesRes.data.files || [],
      count: (filesRes.data.files || []).length,
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================
// Informe de duplicats
// ===========================================

/**
 * GET /api/gdrive/duplicates — Informe de factures duplicades
 * Llista totes les factures marcades com a duplicades amb detall
 */
router.get('/duplicates', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, resolved } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { isDuplicate: true };

    // Filtre per resoltes/no resoltes
    // Una duplicada "resolta" és la que té status REJECTED o ha estat eliminada
    if (resolved === 'true') {
      where.status = { in: ['REJECTED'] };
    } else if (resolved === 'false') {
      where.status = { notIn: ['REJECTED'] };
    }

    const [duplicates, total] = await Promise.all([
      prisma.receivedInvoice.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, nif: true } },
        },
      }),
      prisma.receivedInvoice.count({ where }),
    ]);

    // Enriquir amb info de la factura original
    const enriched = await Promise.all(
      duplicates.map(async (dup) => {
        let original = null;
        if (dup.duplicateOfId) {
          original = await prisma.receivedInvoice.findUnique({
            where: { id: dup.duplicateOfId },
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              status: true,
              issueDate: true,
              supplier: { select: { name: true } },
            },
          });
        }
        return {
          ...dup,
          originalInvoice: original,
          hasPdf: !!dup.filePath || !!dup.gdriveFileId,
        };
      })
    );

    res.json({
      data: enriched,
      summary: {
        total,
        pending: duplicates.filter((d) => d.status !== 'REJECTED').length,
        resolved: duplicates.filter((d) => d.status === 'REJECTED').length,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/gdrive/duplicates/:id/resolve — Resoldre un duplicat
 * Actions: 'keep' (mantenir com a factura vàlida), 'reject' (descartar)
 */
router.post('/duplicates/:id/resolve', authorize('ADMIN', 'EDITOR'), async (req, res, next) => {
  try {
    const { action } = req.body;

    if (!['keep', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acció invàlida. Usa "keep" o "reject"' });
    }

    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, isDuplicate: true, gdriveFileId: true, invoiceNumber: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Factura no trobada' });
    }

    if (action === 'keep') {
      // Mantenir: treure la marca de duplicat
      await prisma.receivedInvoice.update({
        where: { id: req.params.id },
        data: {
          isDuplicate: false,
          duplicateOfId: null,
          description: `Duplicat resolt: mantinguda com a factura vàlida`,
        },
      });

      // Si el PDF està a duplicades, moure'l a la carpeta correcta
      if (invoice.gdriveFileId) {
        try {
          const inv = await prisma.receivedInvoice.findUnique({
            where: { id: req.params.id },
            select: { issueDate: true },
          });
          const destFolderId = await gdrive.getDateBasedFolderId('factures-rebudes', inv.issueDate || new Date());
          await gdrive.moveFile(invoice.gdriveFileId, destFolderId);
          logger.info(`Duplicat resolt (keep): PDF mogut a carpeta organitzada`);
        } catch (moveErr) {
          logger.warn(`Error movent PDF de duplicat resolt: ${moveErr.message}`);
        }
      }
    } else {
      // Rebutjar: marcar com a REJECTED
      await prisma.receivedInvoice.update({
        where: { id: req.params.id },
        data: { status: 'REJECTED' },
      });

      // Completar recordatoris associats
      await prisma.reminder.updateMany({
        where: {
          entityType: 'received_invoice',
          entityId: req.params.id,
          isCompleted: false,
        },
        data: { isCompleted: true, completedAt: new Date() },
      });
    }

    res.json({
      message: action === 'keep' ? 'Factura mantinguda com a vàlida' : 'Duplicat descartat',
      action,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
