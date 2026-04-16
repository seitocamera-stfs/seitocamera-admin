const rentman = require('./rentmanService');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Servei de sincronització Rentman → SeitoCamera
// ===========================================
// Funcions reutilitzables per fer sync manual, backfill o cron.
//
// Filosofia:
//   - Si la factura NO existeix → crear-la
//   - Si existeix → actualitzar camps que poden haver canviat
//     (status, dueDate, projectReference, imports, ...)
// ===========================================

/**
 * Busca o crea el client de SeitoCamera a partir del contacte de Rentman.
 * Reutilitzable des de sync/backfill/cron.
 */
async function findOrCreateClientFromRentman(customerRef) {
  if (!customerRef) return null;

  const contactIdMatch = String(customerRef).match(/\/contacts\/(\d+)/);
  const contactId = contactIdMatch ? contactIdMatch[1] : null;
  if (!contactId) return null;

  try {
    const contactData = await rentman.getContact(contactId);
    const contactName = contactData.displayname || contactData.name || `Rentman Contact ${contactId}`;
    const contactNif = contactData.VAT_code || null;
    const contactEmail = contactData.email_1 || null;
    const contactPhone = contactData.phone_1 || null;
    const contactCity = contactData.invoice_city || contactData.mailing_city || null;
    const contactAddress = [contactData.invoice_street, contactData.invoice_number].filter(Boolean).join(' ') || null;
    const contactPostalCode = contactData.invoice_postalcode || null;

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
    return client.id;
  } catch (err) {
    logger.warn(`No s'ha pogut obtenir contacte Rentman ${contactId}: ${err.message}`);
    return null;
  }
}

/**
 * Obté la referència de projecte (project.reference) d'una factura Rentman.
 * Retorna { projectReference, projectName, rentmanProjectId }
 */
async function getProjectInfoFromInvoice(inv) {
  if (!inv.project) return { projectReference: null, projectName: null, rentmanProjectId: null };

  const projectIdMatch = String(inv.project).match(/\/projects\/(\d+)/);
  if (!projectIdMatch) return { projectReference: null, projectName: null, rentmanProjectId: null };

  const rentmanProjectId = projectIdMatch[1];
  try {
    const projectData = await rentman.getProject(rentmanProjectId);
    return {
      projectReference: projectData.reference || null,
      projectName: projectData.name || null,
      rentmanProjectId,
    };
  } catch (projErr) {
    logger.warn(`No s'ha pogut obtenir projecte Rentman ${rentmanProjectId}: ${projErr.message}`);
    return { projectReference: null, projectName: null, rentmanProjectId };
  }
}

/**
 * Obtenir genèric "Rentman (sense contacte)" si no hi ha client
 */
async function getGenericRentmanClient() {
  let genericClient = await prisma.client.findFirst({
    where: { name: 'Rentman (sense contacte)' },
  });
  if (!genericClient) {
    genericClient = await prisma.client.create({
      data: { name: 'Rentman (sense contacte)' },
    });
  }
  return genericClient.id;
}

/**
 * Carrega TOTES les factures de Rentman (amb paginació)
 */
async function fetchAllRentmanInvoices({ pageSize = 500 } = {}) {
  let invoices = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await rentman.getInvoices({ limit: pageSize, offset });
    const batchArray = Array.isArray(batch) ? batch : [];
    invoices = invoices.concat(batchArray);
    offset += pageSize;
    hasMore = batchArray.length === pageSize;
  }

  return invoices;
}

/**
 * Sincronitza una factura Rentman amb SeitoCamera (create o update)
 *
 * @param {Object} inv - Factura Rentman
 * @param {Object} opts - { fetchProject: true } per incloure info de projecte
 * @returns {'created' | 'updated' | 'unchanged' | 'skipped'}
 */
async function syncOneInvoice(inv, { fetchProject = true } = {}) {
  const invoiceNumber = inv.number || `RM-${inv.id}`;
  const rentmanInvoiceId = String(inv.id);

  // Imports
  const totalAmount = parseFloat(inv.price_invat || 0);
  const subtotal = parseFloat(inv.price || 0);
  const vatAmount = parseFloat(inv.vat_amount || 0);
  const taxRate = subtotal > 0 ? Math.round((vatAmount / subtotal) * 100 * 100) / 100 : 21;
  const status = inv.is_paid ? 'PAID' : 'PENDING';
  const issueDate = inv.date ? new Date(inv.date) : new Date();
  const dueDate = inv.expiration ? new Date(inv.expiration) : null;
  const description = inv.subject || inv.displayname || `Importada de Rentman (ID: ${inv.id})`;

  // Comprovar si ja existeix (per rentmanInvoiceId preferentment, si no per invoiceNumber)
  const existing =
    (await prisma.issuedInvoice.findFirst({ where: { rentmanInvoiceId } })) ||
    (await prisma.issuedInvoice.findFirst({ where: { invoiceNumber } }));

  // Obtenir projecte (només quan cal)
  let projectInfo = { projectReference: null, projectName: null, rentmanProjectId: null };
  if (fetchProject) {
    projectInfo = await getProjectInfoFromInvoice(inv);
  }

  if (existing) {
    // Actualitzar camps que poden haver canviat
    const updates = {};

    // Només actualitzar si hi ha canvi real
    if (existing.status !== status) updates.status = status;
    if (existing.dueDate?.getTime() !== dueDate?.getTime()) updates.dueDate = dueDate;
    if (Math.abs(parseFloat(existing.totalAmount) - totalAmount) > 0.01) updates.totalAmount = totalAmount;
    if (Math.abs(parseFloat(existing.subtotal) - subtotal) > 0.01) updates.subtotal = subtotal;
    if (Math.abs(parseFloat(existing.taxAmount) - vatAmount) > 0.01) updates.taxAmount = vatAmount;
    if (existing.description !== description) updates.description = description;

    // rentman IDs (només si falten)
    if (!existing.rentmanInvoiceId) updates.rentmanInvoiceId = rentmanInvoiceId;

    if (fetchProject) {
      if (!existing.projectReference && projectInfo.projectReference) updates.projectReference = projectInfo.projectReference;
      if (!existing.projectName && projectInfo.projectName) updates.projectName = projectInfo.projectName;
      if (!existing.rentmanProjectId && projectInfo.rentmanProjectId) updates.rentmanProjectId = projectInfo.rentmanProjectId;
    }

    if (Object.keys(updates).length === 0) {
      return 'unchanged';
    }

    await prisma.issuedInvoice.update({
      where: { id: existing.id },
      data: updates,
    });
    return 'updated';
  }

  // No existeix → crear-la. Cal el clientId
  let clientId = await findOrCreateClientFromRentman(inv.customer);
  if (!clientId) {
    clientId = await getGenericRentmanClient();
  }

  await prisma.issuedInvoice.create({
    data: {
      invoiceNumber,
      clientId,
      issueDate,
      dueDate,
      subtotal,
      taxRate,
      taxAmount: vatAmount,
      totalAmount,
      status,
      description,
      projectReference: projectInfo.projectReference,
      projectName: projectInfo.projectName,
      rentmanInvoiceId,
      rentmanProjectId: projectInfo.rentmanProjectId,
    },
  });
  return 'created';
}

/**
 * Sincronitza totes les factures de Rentman (crea les noves, actualitza existents)
 *
 * @param {Object} opts
 * @param {boolean} opts.fetchProjects - Si cal consultar projecte per cada factura (més lent)
 * @param {number|null} opts.onlyRecentDays - Si definit, només processar factures amb data modificada en els últims N dies
 */
async function syncAllInvoices({ fetchProjects = true, onlyRecentDays = null } = {}) {
  const start = Date.now();
  logger.info(`Rentman sync: iniciant (fetchProjects=${fetchProjects}, onlyRecentDays=${onlyRecentDays || 'all'})`);

  const allInvoices = await fetchAllRentmanInvoices();

  // Filtre incremental per data (si demanat)
  let invoicesToProcess = allInvoices;
  if (onlyRecentDays) {
    const cutoff = new Date(Date.now() - onlyRecentDays * 24 * 60 * 60 * 1000);
    invoicesToProcess = allInvoices.filter((inv) => {
      const modified = inv.modified ? new Date(inv.modified) : null;
      const created = inv.created ? new Date(inv.created) : null;
      const date = inv.date ? new Date(inv.date) : null;
      const latest = [modified, created, date].filter(Boolean).sort((a, b) => b - a)[0];
      return !latest || latest >= cutoff;
    });
    logger.info(`Rentman sync: ${invoicesToProcess.length}/${allInvoices.length} factures modificades en els últims ${onlyRecentDays} dies`);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const inv of invoicesToProcess) {
    try {
      const result = await syncOneInvoice(inv, { fetchProject: fetchProjects });
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else if (result === 'unchanged') unchanged++;
    } catch (err) {
      errors++;
      logger.error(`Rentman sync: error factura ${inv.id} (${inv.number}): ${err.message}`);
    }
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(
    `Rentman sync completat en ${durationSec}s: ` +
    `${created} creades, ${updated} actualitzades, ${unchanged} sense canvis, ${errors} errors`
  );

  return {
    total: invoicesToProcess.length,
    created,
    updated,
    unchanged,
    errors,
    durationSec,
  };
}

module.exports = {
  syncAllInvoices,
  syncOneInvoice,
  findOrCreateClientFromRentman,
  getProjectInfoFromInvoice,
  fetchAllRentmanInvoices,
};
