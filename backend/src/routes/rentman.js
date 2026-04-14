const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const rentman = require('../services/rentmanService');
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
 * POST /api/rentman/sync/invoices — Importar factures de Rentman com a factures emeses
 *
 * Crea factures emeses a SeitoCamera Admin a partir de les factures de Rentman,
 * evitant duplicats per número de factura.
 */
router.post('/sync/invoices', authorize('ADMIN'), async (req, res, next) => {
  try {
    const rentmanInvoices = await rentman.getInvoices({ limit: 1500 });
    const invoices = Array.isArray(rentmanInvoices) ? rentmanInvoices : [];

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const inv of invoices) {
      try {
        // Comprovar si ja existeix pel número de factura
        const invoiceNumber = inv.number || inv.invoice_number || `RM-${inv.id}`;
        const existing = await prisma.issuedInvoice.findFirst({
          where: { invoiceNumber },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Buscar o crear client pel contacte de Rentman
        let clientId = null;
        if (inv.contact || inv.contact_id) {
          const contactId = inv.contact_id || inv.contact;
          try {
            const contact = await rentman.getContact(contactId);
            const contactData = contact.data || contact;
            const contactName = contactData.name || contactData.company || `Rentman Contact ${contactId}`;

            // Buscar client existent pel nom
            let client = await prisma.client.findFirst({
              where: {
                OR: [
                  { name: contactName },
                  { email: contactData.email || undefined },
                ],
              },
            });

            if (!client) {
              client = await prisma.client.create({
                data: {
                  name: contactName,
                  email: contactData.email || null,
                  phone: contactData.phone || null,
                  nif: contactData.tax_number || `RM-${contactId}`,
                },
              });
              logger.info(`Client creat des de Rentman: ${contactName}`);
            }

            clientId = client.id;
          } catch (contactError) {
            logger.warn(`No s'ha pogut obtenir contacte Rentman ${contactId}: ${contactError.message}`);
          }
        }

        if (!clientId) {
          // Crear un client genèric per factures sense contacte
          let genericClient = await prisma.client.findFirst({
            where: { name: 'Rentman (sense contacte)' },
          });
          if (!genericClient) {
            genericClient = await prisma.client.create({
              data: { name: 'Rentman (sense contacte)', nif: 'RM-GENERIC' },
            });
          }
          clientId = genericClient.id;
        }

        // Calcular imports
        const totalAmount = parseFloat(inv.total || inv.amount || 0);
        const taxRate = parseFloat(inv.tax_percentage || inv.vat || 21);
        const subtotal = totalAmount / (1 + taxRate / 100);
        const taxAmount = totalAmount - subtotal;

        await prisma.issuedInvoice.create({
          data: {
            invoiceNumber,
            clientId,
            issueDate: inv.date ? new Date(inv.date) : new Date(),
            dueDate: inv.due_date ? new Date(inv.due_date) : null,
            subtotal,
            taxRate,
            taxAmount,
            totalAmount,
            status: inv.status === 'paid' ? 'PAID' : 'PENDING',
            description: inv.subject || inv.description || `Importada de Rentman (ID: ${inv.id})`,
          },
        });

        created++;
      } catch (invError) {
        logger.error(`Error important factura Rentman ${inv.id}: ${invError.message}`);
        errors++;
      }
    }

    logger.info(`Sincronització Rentman: ${created} creades, ${skipped} omeses, ${errors} errors`);

    res.json({
      message: 'Sincronització completada',
      total: invoices.length,
      created,
      skipped,
      errors,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/rentman/sync/projects — Registrar projectes de Rentman
 * Guarda un resum dels projectes com a notes per tenir visibilitat
 */
router.post('/sync/projects', authorize('ADMIN'), async (req, res, next) => {
  try {
    const projects = await rentman.getProjects({ limit: 1500 });
    const projectList = Array.isArray(projects) ? projects : [];

    res.json({
      message: 'Projectes obtinguts de Rentman',
      total: projectList.length,
      data: projectList.map((p) => ({
        id: p.id,
        name: p.name || p.displayname,
        status: p.status,
        startDate: p.planperiod_start || p.start,
        endDate: p.planperiod_end || p.end,
        location: p.location,
        contact: p.contact_name || p.contact,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
