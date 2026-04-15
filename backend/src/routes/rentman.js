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
    // Paginació automàtica: Rentman limita a 1500 per consulta
    let invoices = [];
    let offset = 0;
    const pageSize = 500;
    let hasMore = true;

    while (hasMore) {
      const batch = await rentman.getInvoices({ limit: pageSize, offset });
      const batchArray = Array.isArray(batch) ? batch : [];
      invoices = invoices.concat(batchArray);
      offset += pageSize;
      hasMore = batchArray.length === pageSize;
      logger.info(`Rentman sync: carregades ${invoices.length} factures (offset: ${offset})`);
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const inv of invoices) {
      try {
        // Comprovar si ja existeix pel número de factura
        const invoiceNumber = inv.number || `RM-${inv.id}`;
        const existing = await prisma.issuedInvoice.findFirst({
          where: { invoiceNumber },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Buscar o crear client pel contacte de Rentman
        // El camp "customer" conté una URL com "/contacts/4642"
        let clientId = null;
        const customerRef = inv.customer;
        if (customerRef) {
          const contactIdMatch = String(customerRef).match(/\/contacts\/(\d+)/);
          const contactId = contactIdMatch ? contactIdMatch[1] : null;
          if (contactId) {
            try {
              const contactData = await rentman.getContact(contactId);
              const contactName = contactData.displayname || contactData.name || `Rentman Contact ${contactId}`;
              const contactNif = contactData.VAT_code || null;
              const contactEmail = contactData.email_1 || null;
              const contactPhone = contactData.phone_1 || null;
              const contactCity = contactData.invoice_city || contactData.mailing_city || null;
              const contactAddress = [contactData.invoice_street, contactData.invoice_number].filter(Boolean).join(' ') || null;
              const contactPostalCode = contactData.invoice_postalcode || null;

              // Buscar client existent pel NIF o nom
              let client = null;
              if (contactNif) {
                client = await prisma.client.findFirst({
                  where: { nif: { equals: contactNif, mode: 'insensitive' } },
                });
              }
              if (!client) {
                client = await prisma.client.findFirst({
                  where: { name: { equals: contactName, mode: 'insensitive' } },
                });
              }

              if (!client) {
                client = await prisma.client.create({
                  data: {
                    name: contactName,
                    nif: contactNif || null,
                    email: contactEmail,
                    phone: contactPhone,
                    city: contactCity,
                    address: contactAddress,
                    postalCode: contactPostalCode,
                  },
                });
                logger.info(`Client creat des de Rentman: ${contactName} (NIF: ${contactNif || '-'})`);
              }

              clientId = client.id;
            } catch (contactError) {
              logger.warn(`No s'ha pogut obtenir contacte Rentman ${contactId}: ${contactError.message}`);
            }
          }
        }

        if (!clientId) {
          let genericClient = await prisma.client.findFirst({
            where: { name: 'Rentman (sense contacte)' },
          });
          if (!genericClient) {
            genericClient = await prisma.client.create({
              data: { name: 'Rentman (sense contacte)' },
            });
          }
          clientId = genericClient.id;
        }

        // Imports directes de Rentman (ja venen calculats)
        const totalAmount = parseFloat(inv.price_invat || 0);  // Total amb IVA
        const subtotal = parseFloat(inv.price || 0);           // Base imposable
        const vatAmount = parseFloat(inv.vat_amount || 0);     // IVA
        const taxRate = subtotal > 0 ? Math.round((vatAmount / subtotal) * 100 * 100) / 100 : 21;

        await prisma.issuedInvoice.create({
          data: {
            invoiceNumber,
            clientId,
            issueDate: inv.date ? new Date(inv.date) : new Date(),
            dueDate: inv.expiration ? new Date(inv.expiration) : null,
            subtotal,
            taxRate,
            taxAmount: vatAmount,
            totalAmount,
            status: inv.is_paid ? 'PAID' : 'PENDING',
            description: inv.subject || inv.displayname || `Importada de Rentman (ID: ${inv.id})`,
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
