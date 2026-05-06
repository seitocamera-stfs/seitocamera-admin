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

// ===========================================
// Sincronització de PROJECTES Rentman → RentalProject
// ===========================================

// =============================================================
// Estats Rentman → ProjectStatus intern
// =============================================================
//
// WHITELIST estricte: només importem projectes "confirmats" cap endavant.
// Tot el que estigui en fase de pressupost/consulta (option, quotation,
// draft) o cancel·lat NO entra al sistema. Estats desconeguts → es saltan.
//
// Si Rentman afegeix un estat nou que volem importar, cal afegir-lo aquí
// EXPLÍCITAMENT — millor saltar i loggar que importar a cegues.
// =============================================================

// IMPORTANT: a Rentman v3, l'estat NO es troba a /projects sinó a
// /subprojects. Cada projecte té 1+ subprojects, cadascun amb un camp
// `status: "/statuses/N"` que apunta a un dels valors del catàleg
// /statuses (Confirmado, Cancelado, Devuelto, Pendiente, etc.).
//
// Ho resolem fent prefetch a /statuses + /subprojects al començament del
// sync, construint un map projectId → statusName, i passant-lo a
// filterCurrentAndFutureProjects/syncOneProject.

// IDs típics observats al nostre catàleg Rentman (data 2026-05):
//   1=Pendiente  2=Cancelado  3=Confirmado  4=Preparado
//   5=En localización  6=Devuelto  7=Consulta  8=Concepto
// El nom es resol dinàmicament a fetchStatusNamesById() per evitar
// hardcoded mappings que es desincronitzin si Rentman canvia ids.

const RENTMAN_STATUS_MAP = {
  // Confirmat — backend confirma la reserva, comencem preparació
  'confirmed':           'IN_PREPARATION',
  'confirmado':          'IN_PREPARATION',
  // Preparat / actiu
  'active':              'READY',
  'prepared':            'READY',
  'preparado':           'READY',
  // En localització / fora del magatzem
  'out':                 'OUT',
  'on_location':         'OUT',
  'on location':         'OUT',
  'en localización':     'OUT',
  'en localizacion':     'OUT',
  'en_localizacion':     'OUT',
  // Retardat / esperant retorn = encara fora
  'delayed':             'OUT',
  'retrasado':           'OUT',
  'overdue':             'OUT',
  'expected_return':     'OUT',
  'expected return':     'OUT',
  'expected back':       'OUT',
  'esperado de regreso': 'OUT',
  // Tornat
  'returned':            'RETURNED',
  'retornado':           'RETURNED',
  'devuelto':            'RETURNED',
  // Tancat / arxivat
  'closed':              'CLOSED',
  'archived':            'CLOSED',
};

/**
 * Mapeja un estat de Rentman al ProjectStatus intern, o `null` si l'estat
 * no està a la whitelist (no confirmat, cancel·lat, o desconegut).
 */
function mapRentmanStatusToProjectStatus(rentmanStatus) {
  if (!rentmanStatus) return null;
  return RENTMAN_STATUS_MAP[String(rentmanStatus).toLowerCase()] || null;
}

/**
 * Carrega el catàleg /statuses i retorna un map id (string) → name (string).
 * Ex: { "1": "Pendiente", "3": "Confirmado", ... }
 */
async function fetchStatusNamesById() {
  const res = await rentman.rentmanGet('/statuses', { limit: 200 });
  const data = res.data || res;
  const map = {};
  for (const s of data || []) {
    map[String(s.id)] = s.name || s.displayname || `unknown_${s.id}`;
  }
  return map;
}

/**
 * Carrega tots els /subprojects (paginat). Retorna un Map projectId → statusName
 * fent servir el catàleg /statuses prèviament resolt.
 *
 * Si un projecte té múltiples subprojects, ens quedem amb l'estat MÉS AVANÇAT
 * dins del cicle de vida (PENDING < QUOTE < CONFIRMED < PREPARED < OUT < RETURNED).
 */
const STATUS_LIFECYCLE_PRIORITY = [
  // Pendiente, Cancelado, Concepto, Consulta = no-whitelist (prioritat 0)
  'pendiente', 'cancelado', 'cancelled', 'concepto', 'concept', 'consulta', 'quotation', 'option', 'draft',
  // Confirmado (1)
  'confirmado', 'confirmed',
  // Preparado (2)
  'preparado', 'prepared', 'active',
  // En localización (3)
  'en localización', 'en localizacion', 'on_location', 'on location', 'out',
  // Devuelto (4)
  'devuelto', 'returned', 'retornado',
  // Closed (5)
  'closed', 'archived',
];
function statusPriority(name) {
  const idx = STATUS_LIFECYCLE_PRIORITY.indexOf((name || '').toLowerCase());
  return idx === -1 ? -1 : idx;
}

async function fetchProjectStatusMap() {
  const statusNames = await fetchStatusNamesById();

  const result = new Map(); // projectIdStr → statusName
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const batch = await rentman.rentmanGet('/subprojects', { limit: pageSize, offset });
    const items = batch.data || batch || [];
    for (const sp of items) {
      // sp.project = "/projects/180", sp.status = "/statuses/3"
      const pidMatch = String(sp.project || '').match(/\/projects\/(\d+)/);
      const sidMatch = String(sp.status || '').match(/\/statuses\/(\d+)/);
      if (!pidMatch || !sidMatch) continue;
      const projectId = pidMatch[1];
      const statusName = statusNames[sidMatch[1]];
      if (!statusName) continue;

      const existing = result.get(projectId);
      if (!existing || statusPriority(statusName) > statusPriority(existing)) {
        result.set(projectId, statusName);
      }
    }
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return result;
}

/**
 * Carrega tots els projectes de Rentman (amb paginació)
 */
async function fetchAllRentmanProjects({ pageSize = 500 } = {}) {
  let projects = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await rentman.getProjects({ limit: pageSize, offset });
    const batchArray = Array.isArray(batch) ? batch : [];
    projects = projects.concat(batchArray);
    offset += pageSize;
    hasMore = batchArray.length === pageSize;
  }

  return projects;
}

/**
 * Filtra projectes Rentman: només importem els CONFIRMATS-i-posteriors
 * dins del rang temporal acceptat. L'estat es resol via `statusMap`
 * (resultat de fetchProjectStatusMap) — qualsevol projecte sense entrada
 * o amb estat fora del whitelist queda fora.
 *
 * Mutàcia útil: enriqueix cada projecte acceptat amb `_rentmanStatus`
 * (el nom del status, ex: "Confirmado") perquè syncOneProject pugui
 * usar-lo sense cridar de nou.
 */
function filterCurrentAndFutureProjects(projects, statusMap) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const skippedByStatus = {}; // per logging
  const accepted = [];

  for (const p of projects) {
    const projectId = String(p.id);
    const statusName = statusMap?.get(projectId) || null;
    const mapped = mapRentmanStatusToProjectStatus(statusName);

    if (!mapped) {
      const key = (statusName || '').toLowerCase() || '(sense subproject/buit)';
      skippedByStatus[key] = (skippedByStatus[key] || 0) + 1;
      continue;
    }

    // Excloure projectes antics (fi del període > 7 dies enrere)
    const endDate = p.planperiod_end || p.end;
    if (endDate) {
      const end = new Date(endDate);
      if (end < cutoff) continue;
    }

    // Adjuntem l'status resolt per evitar re-lookup després
    p._rentmanStatus = statusName;
    accepted.push(p);
  }

  if (Object.keys(skippedByStatus).length > 0) {
    const summary = Object.entries(skippedByStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join(', ');
    logger.info(`Rentman sync: saltats per estat no-confirmat → ${summary}`);
  }

  return accepted;
}

/**
 * Sincronitza un projecte de Rentman amb el model RentalProject.
 * Crea si no existeix, actualitza si ja existeix.
 *
 * @returns {'created' | 'updated' | 'unchanged' | 'skipped'}
 */
async function syncOneProject(rmProject) {
  const rentmanProjectId = String(rmProject.id);
  const name = rmProject.displayname || rmProject.name || `Projecte Rentman ${rmProject.id}`;

  // Dates Rentman → camps interns:
  //   planperiod_start  → checkDate     (dia de check/preparació)
  //   usageperiod_start → departureDate (inici rodatge)
  //   usageperiod_end   → shootEndDate  (fi rodatge)
  //   planperiod_end    → returnDate    (devolució material)
  const checkDateStr    = rmProject.planperiod_start  || null;
  const departureDateStr = rmProject.usageperiod_start || rmProject.planperiod_start || rmProject.start;
  const shootEndDateStr  = rmProject.usageperiod_end   || null;
  const returnDateStr    = rmProject.planperiod_end    || rmProject.end;

  if (!departureDateStr || !returnDateStr) {
    return 'skipped';
  }

  const checkDate     = checkDateStr ? new Date(checkDateStr) : null;
  const departureDate = new Date(departureDateStr);
  const shootEndDate  = shootEndDateStr ? new Date(shootEndDateStr) : null;
  const returnDate    = new Date(returnDateStr);

  // Extreure hora de les dates Rentman (format "HH:MM")
  const extractTime = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  const checkTime     = extractTime(checkDateStr);
  const departureTime = extractTime(departureDateStr);
  const shootEndTime  = extractTime(shootEndDateStr);
  const returnTime    = extractTime(returnDateStr);

  // Validació de dates obligatòries
  if (isNaN(departureDate.getTime()) || isNaN(returnDate.getTime())) {
    return 'skipped';
  }

  // Client
  const contactName = rmProject.contact_name || rmProject.contact_mailing_displayname || null;
  let clientId = null;
  if (rmProject.customer) {
    clientId = await findOrCreateClientFromRentman(rmProject.customer);
  }

  // Estat — vingut o bé del filterCurrentAndFutureProjects (preferit, ja ha
  // resolt el subproject i el catàleg /statuses), o si no, prova el camp
  // rmProject.status (per compatibilitat) abans de donar-se per vençut.
  const rentmanStatus = rmProject._rentmanStatus || rmProject.status || null;
  const status = mapRentmanStatusToProjectStatus(rentmanStatus);

  // Defensa-en-profunditat: si arribem aquí amb un estat fora del whitelist
  // (no hauria de passar — el filtre ja l'hauria saltat), no creem projecte
  // nou. Si ja existeix, deixem que l'actualització segueixi (per refrescar
  // dates/nom/etc.) sense canviar l'status.
  if (!status) {
    const existing = await prisma.rentalProject.findFirst({
      where: { rentmanProjectId }, select: { id: true },
    });
    if (!existing) {
      logger.warn(`Rentman: projecte ${rentmanProjectId} (${name}) saltat — estat "${rmProject.status}" no whitelistejat`);
      return 'skipped';
    }
  }

  // Buscar si ja existeix
  const existing = await prisma.rentalProject.findFirst({
    where: { rentmanProjectId },
  });

  if (existing) {
    // Actualitzar camps que poden canviar a Rentman
    const updates = {};

    if (existing.name !== name) updates.name = name;
    if (existing.clientName !== contactName && contactName) updates.clientName = contactName;
    if (clientId && existing.clientId !== clientId) updates.clientId = clientId;

    // Dates: actualitzar les 4 dates + hores
    if (checkDate && (!existing.checkDate || existing.checkDate.getTime() !== checkDate.getTime())) {
      updates.checkDate = checkDate;
    }
    if (existing.departureDate.getTime() !== departureDate.getTime()) updates.departureDate = departureDate;
    if (shootEndDate && (!existing.shootEndDate || existing.shootEndDate.getTime() !== shootEndDate.getTime())) {
      updates.shootEndDate = shootEndDate;
    }
    if (existing.returnDate.getTime() !== returnDate.getTime()) updates.returnDate = returnDate;

    // Hores
    if (checkTime && existing.checkTime !== checkTime) updates.checkTime = checkTime;
    if (departureTime && existing.departureTime !== departureTime) updates.departureTime = departureTime;
    if (shootEndTime && existing.shootEndTime !== shootEndTime) updates.shootEndTime = shootEndTime;
    if (returnTime && existing.returnTime !== returnTime) updates.returnTime = returnTime;

    // ============================================
    // Sincronització d'estat Rentman → intern
    // ============================================
    // Rentman és la font de veritat per al cicle de vida del projecte. Si
    // canvia l'estat allà (cap endavant o cap enrere), reflectim el canvi
    // automàticament al sistema. Excepcions:
    //   - Si l'estat intern és CLOSED i ja no ho és a Rentman, no
    //     "ressuscitem" el projecte automàticament (segurament algú l'ha
    //     arxivat manualment) — quedem-nos com està.
    //   - Si l'estat intern és OUT/RETURNED i Rentman tira enrere a
    //     IN_PREPARATION, ho permetem (pot ser una correcció a Rentman).
    if (status && existing.status !== status) {
      const isInternalClosed = existing.status === 'CLOSED';
      const isRentmanReopening = isInternalClosed && status !== 'CLOSED';
      if (!isRentmanReopening) {
        updates.status = status;
        if (existing.status !== status) {
          logger.info(
            `Rentman: projecte ${rentmanProjectId} (${name}) — canvi d'estat ${existing.status} → ${status} (Rentman: ${rentmanStatus})`
          );
        }
      } else {
        logger.info(
          `Rentman: projecte ${rentmanProjectId} (${name}) està CLOSED localment però Rentman diu "${rentmanStatus}" — no es ressuscita automàticament`
        );
      }
    }

    if (existing.budgetReference !== (rmProject.reference || null) && rmProject.reference) {
      updates.budgetReference = rmProject.reference;
    }

    // Actualitzar estat Rentman natiu (per a auditoria/reconcile)
    if (rentmanStatus && existing.rentmanStatus !== rentmanStatus) {
      updates.rentmanStatus = rentmanStatus;
    }

    if (Object.keys(updates).length === 0) {
      return 'unchanged';
    }

    await prisma.rentalProject.update({
      where: { id: existing.id },
      data: updates,
    });
    return 'updated';
  }

  // No existeix → crear
  const newProject = await prisma.rentalProject.create({
    data: {
      name,
      clientName: contactName,
      clientId,
      checkDate,
      checkTime,
      departureDate,
      departureTime,
      shootEndDate,
      shootEndTime,
      returnDate,
      returnTime,
      status,
      rentmanProjectId,
      rentmanStatus,
      budgetReference: rmProject.reference || null,
      internalNotes: rmProject.location ? `Ubicació: ${rmProject.location}` : null,
    },
  });

  // Crear tasques predeterminades per al nou projecte
  try {
    await prisma.projectTask.createMany({
      data: [
        { projectId: newProject.id, title: 'Backfocus Camera', category: 'TECH', status: 'OP_PENDING' },
        { projectId: newProject.id, title: 'Col·limar òptiques', category: 'TECH', status: 'OP_PENDING' },
        { projectId: newProject.id, title: 'Revisar bateries', category: 'TECH', status: 'OP_PENDING' },
        { projectId: newProject.id, title: 'Linkar teradeks', category: 'TECH', status: 'OP_PENDING' },
        { projectId: newProject.id, title: 'Posar GPS', category: 'TECH', status: 'OP_PENDING' },
      ],
    });
  } catch (err) {
    logger.error(`Error creant tasques predeterminades per projecte ${newProject.id}:`, err.message);
  }

  return 'created';
}

/**
 * Sincronitza tots els projectes actuals/futurs de Rentman → RentalProject.
 * No importa projectes antics (data fi < 7 dies enrere).
 */
async function syncProjects() {
  const start = Date.now();
  logger.info('Rentman project sync: iniciant...');

  // Carregar catàleg /statuses + /subprojects per resoldre l'estat de cada
  // projecte (a Rentman v3 l'estat NO viu a /projects sinó a /subprojects).
  const statusMap = await fetchProjectStatusMap();
  logger.info(`Rentman project sync: status carregats per ${statusMap.size} projectes`);

  const allProjects = await fetchAllRentmanProjects();
  const projectsToSync = filterCurrentAndFutureProjects(allProjects, statusMap);

  logger.info(`Rentman project sync: ${projectsToSync.length}/${allProjects.length} projectes actuals/futurs (whitelist)`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;

  for (const rmProject of projectsToSync) {
    try {
      const result = await syncOneProject(rmProject);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else if (result === 'unchanged') unchanged++;
      else if (result === 'skipped') skipped++;
    } catch (err) {
      errors++;
      logger.error(`Rentman project sync error (${rmProject.id} - ${rmProject.name}): ${err.message}`);
    }
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(
    `Rentman project sync completat en ${durationSec}s: ` +
    `${created} creats, ${updated} actualitzats, ${unchanged} sense canvis, ${skipped} saltats, ${errors} errors`
  );

  return {
    totalRentman: allProjects.length,
    totalFiltered: projectsToSync.length,
    created,
    updated,
    unchanged,
    skipped,
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
  syncProjects,
  syncOneProject,
  mapRentmanStatusToProjectStatus,
  fetchProjectStatusMap,
  fetchStatusNamesById,
  RENTMAN_STATUS_MAP,
};
