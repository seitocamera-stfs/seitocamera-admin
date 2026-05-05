const express = require('express');
const { authenticate } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const transportCostService = require('../services/transportCostService');
const distanceService = require('../services/distanceService');

const router = express.Router();
router.use(authenticate);

// ===========================================
// Utils
// ===========================================

// Una jornada estàndard són 12h. Les hores extres comencen a comptar
// a partir d'aquesta durada (work_duration - 12h, mai negatives).
const JORNADA_ESTANDARD_MIN = 12 * 60;

function _toMin(hm) {
  if (!hm) return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

/**
 * Calcula minuts d'hores extres a partir de l'hora d'inici i fi reals.
 * Regla: jornada estàndard = 12h. Tot el que excedeixi compta com a extra.
 * Si la jornada acaba després de mitjanit, suma 24h al delta negatiu.
 */
function calcularHoresExtres(horaInici, horaFiReal) {
  const inici = _toMin(horaInici);
  const real = _toMin(horaFiReal);
  if (inici == null || real == null) return null;
  let duracio = real - inici;
  if (duracio < 0) duracio += 24 * 60; // jornada nocturna passada de mitjanit
  return Math.max(0, duracio - JORNADA_ESTANDARD_MIN);
}

function afegirHistorial(historial, accio, detall = '') {
  return [...(historial || []), { timestamp: new Date().toISOString(), accio, detall }];
}

/**
 * Sincronitza l'absència automàtica per a un transport.
 * Si el conductor és un usuari Seito, crea/actualitza/elimina l'absència corresponent.
 */
async function syncTransportAbsence(transportId) {
  const transport = await prisma.transport.findUnique({
    where: { id: transportId },
    include: { conductor: { select: { userId: true } } },
  });
  if (!transport) return;

  const userId = transport.conductor?.userId;

  // Eliminar absència antiga si el conductor ja no és usuari Seito o transport cancel·lat
  if (!userId || transport.estat === 'Cancel·lat') {
    await prisma.staffAbsence.deleteMany({ where: { transportId } });
    return;
  }

  // Calcular dates i hores
  const startDate = transport.dataCarrega || transport.dataEntrega;
  if (!startDate) {
    await prisma.staffAbsence.deleteMany({ where: { transportId } });
    return;
  }

  // Determinar si és parcial (entrega/recollida = parcial, tot el dia = complet)
  const isPartial = transport.tipusServei !== 'Tot el dia' && !!(transport.horaRecollida || transport.horaEntregaEstimada);
  const startTime = transport.horaRecollida || null;
  const endTime = transport.horaEntregaEstimada || transport.horaFiPrevista || null;
  const endDate = transport.dataEntrega || startDate;

  const notes = `Transport automàtic: ${transport.projecte || 'Transport'}${transport.origen ? ` — ${transport.origen}` : ''}${transport.desti ? ` → ${transport.desti}` : ''}`;

  const existing = await prisma.staffAbsence.findFirst({ where: { transportId } });

  if (existing) {
    await prisma.staffAbsence.update({
      where: { id: existing.id },
      data: {
        userId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isPartial,
        startTime: isPartial ? startTime : null,
        endTime: isPartial ? endTime : null,
        notes,
      },
    });
  } else {
    await prisma.staffAbsence.create({
      data: {
        userId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        type: 'TRANSPORT',
        status: 'APROVADA', // Aprovada automàticament
        isPartial,
        startTime: isPartial ? startTime : null,
        endTime: isPartial ? endTime : null,
        transportId,
        notes,
      },
    });
  }
}

// ===========================================
// TRANSPORTS
// ===========================================

// GET /api/logistics/transports
router.get('/transports', async (req, res, next) => {
  try {
    const { estat, tipusServei, responsable, cerca, dataFrom, dataTo, empresaId, conductorId, rentalProjectId } = req.query;
    const where = {};
    if (estat) where.estat = estat;
    if (tipusServei) where.tipusServei = tipusServei;
    if (responsable) where.responsableProduccio = responsable;
    if (empresaId) where.empresaId = empresaId;
    if (conductorId) where.conductorId = conductorId;
    if (rentalProjectId) where.rentalProjectId = rentalProjectId;
    if (dataFrom || dataTo) {
      where.dataCarrega = {};
      if (dataFrom) where.dataCarrega.gte = new Date(dataFrom);
      if (dataTo) where.dataCarrega.lte = new Date(dataTo);
    }
    if (cerca) {
      where.OR = [
        { projecte: { contains: cerca, mode: 'insensitive' } },
        { origen: { contains: cerca, mode: 'insensitive' } },
        { desti: { contains: cerca, mode: 'insensitive' } },
        { responsableProduccio: { contains: cerca, mode: 'insensitive' } },
        { rentalProject: { name: { contains: cerca, mode: 'insensitive' } } },
      ];
    }

    const transports = await prisma.transport.findMany({
      where,
      include: {
        conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } },
        empresa: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, name: true } },
        rentalProject: { select: { id: true, name: true, status: true, departureDate: true } },
      },
      orderBy: [{ dataCarrega: 'asc' }, { horaRecollida: 'asc' }],
    });

    res.json(transports);
  } catch (err) {
    next(err);
  }
});

// GET /api/logistics/transports/:id
router.get('/transports/:id', async (req, res, next) => {
  try {
    const transport = await prisma.transport.findUnique({
      where: { id: req.params.id },
      include: {
        conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } },
        empresa: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, name: true } },
        rentalProject: { select: { id: true, name: true, status: true, departureDate: true } },
      },
    });
    if (!transport) return res.status(404).json({ error: 'Transport no trobat' });
    res.json(transport);
  } catch (err) {
    next(err);
  }
});

// POST /api/logistics/transports
router.post('/transports', async (req, res, next) => {
  try {
    const {
      projecte, rentalProjectId, tipusServei, origen, notesOrigen, desti, notesDesti,
      dataCarrega, dataEntrega, horaRecollida, horaEntregaEstimada, horaFiPrevista,
      responsableProduccio, telefonResponsable, conductorId, empresaId,
      estat, notes,
      // Cost
      tipusServeiCategoria, foraBarcelona, kmAnadaTornada, costManual,
    } = req.body;

    // Si vinculem a un projecte real, sincronitzem el camp text amb el nom
    let projecteText = projecte || null;
    if (rentalProjectId) {
      const rp = await prisma.rentalProject.findUnique({ where: { id: rentalProjectId }, select: { name: true } });
      if (rp) projecteText = rp.name;
    }

    const historial = afegirHistorial([], 'creat', `Transport creat per ${req.user.name || 'admin'}`);

    const transport = await prisma.transport.create({
      data: {
        projecte: projecteText,
        rentalProjectId: rentalProjectId || null,
        tipusServei: tipusServei || 'Entrega',
        tipusServeiCategoria: tipusServeiCategoria || null,
        foraBarcelona: Boolean(foraBarcelona),
        kmAnadaTornada: kmAnadaTornada !== undefined && kmAnadaTornada !== null && kmAnadaTornada !== '' ? parseFloat(kmAnadaTornada) : null,
        costManual: costManual !== undefined && costManual !== null && costManual !== '' ? parseFloat(costManual) : null,
        origen: origen || null,
        notesOrigen: notesOrigen || null,
        desti: desti || null,
        notesDesti: notesDesti || null,
        dataCarrega: dataCarrega ? new Date(dataCarrega) : null,
        dataEntrega: dataEntrega ? new Date(dataEntrega) : null,
        horaRecollida: horaRecollida || null,
        horaEntregaEstimada: horaEntregaEstimada || null,
        horaFiPrevista: horaFiPrevista || null,
        responsableProduccio: responsableProduccio || null,
        telefonResponsable: telefonResponsable || null,
        conductorId: conductorId || null,
        empresaId: empresaId || null,
        estat: estat || 'Pendent',
        notes: notes || null,
        historial,
        createdById: req.user.id,
      },
      include: {
        conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } },
        empresa: { select: { id: true, nom: true } },
        rentalProject: { select: { id: true, name: true, status: true, departureDate: true } },
      },
    });

    // Sincronitzar absència automàtica si conductor és usuari Seito
    syncTransportAbsence(transport.id).catch(e => logger.error('Error sync absence (create):', e.message));

    // Calcular cost inicial (si la categoria està definida)
    let finalTransport = transport;
    try {
      const result = await transportCostService.recalculate(transport.id);
      if (result?.transport) finalTransport = { ...transport, ...result.transport, costBreakdown: result.breakdown };
    } catch (e) {
      logger.warn(`Error calculant cost transport ${transport.id}: ${e.message}`);
    }

    res.status(201).json(finalTransport);
  } catch (err) {
    next(err);
  }
});

// PUT /api/logistics/transports/:id
router.put('/transports/:id', async (req, res, next) => {
  try {
    const prev = await prisma.transport.findUnique({ where: { id: req.params.id } });
    if (!prev) return res.status(404).json({ error: 'Transport no trobat' });

    const data = {};
    const fields = [
      'projecte', 'rentalProjectId', 'tipusServei', 'origen', 'notesOrigen', 'desti', 'notesDesti',
      'horaRecollida', 'horaEntregaEstimada', 'horaFiPrevista',
      'horaIniciReal', 'horaFiReal', 'responsableProduccio', 'telefonResponsable',
      'conductorId', 'empresaId', 'estat', 'motiuCancellacio', 'notes',
      'tipusServeiCategoria',  // càlcul cost
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) data[f] = req.body[f] || null;
    }
    // Camps numèrics / boolean del càlcul de cost
    if (req.body.foraBarcelona !== undefined) data.foraBarcelona = Boolean(req.body.foraBarcelona);
    if (req.body.kmAnadaTornada !== undefined) {
      data.kmAnadaTornada = req.body.kmAnadaTornada === null || req.body.kmAnadaTornada === '' ? null : parseFloat(req.body.kmAnadaTornada);
    }
    if (req.body.costManual !== undefined) {
      data.costManual = req.body.costManual === null || req.body.costManual === '' ? null : parseFloat(req.body.costManual);
    }
    if (req.body.dataCarrega !== undefined) data.dataCarrega = req.body.dataCarrega ? new Date(req.body.dataCarrega) : null;
    if (req.body.dataEntrega !== undefined) data.dataEntrega = req.body.dataEntrega ? new Date(req.body.dataEntrega) : null;

    // Si canvia el rentalProjectId, sincronitzem `projecte` text amb el nom del projecte
    if (req.body.rentalProjectId !== undefined) {
      if (req.body.rentalProjectId) {
        const rp = await prisma.rentalProject.findUnique({ where: { id: req.body.rentalProjectId }, select: { name: true } });
        if (rp) data.projecte = rp.name;
      }
    }

    // Calcular hores extres (jornada estàndard = 12h, comptant des del "play" del
    // conductor — horaIniciReal —, no des de l'hora planificada). Si encara no
    // s'ha registrat l'inici real, no podem calcular extres de manera fiable.
    if (req.body.horaFiReal !== undefined) {
      const inici = data.horaIniciReal || prev.horaIniciReal;
      data.minutsExtres = inici ? calcularHoresExtres(inici, req.body.horaFiReal) : null;
    }

    // Historial
    let historial = [...(prev.historial || [])];
    if (req.body.horaIniciReal && req.body.horaIniciReal !== prev.horaIniciReal) {
      historial = afegirHistorial(historial, 'inici_ruta', `Ruta iniciada a les ${req.body.horaIniciReal}`);
    }
    if (req.body.horaFiReal && req.body.horaFiReal !== prev.horaFiReal) {
      historial = afegirHistorial(historial, 'tancament', `Hora final: ${req.body.horaFiReal} (previst ${prev.horaFiPrevista || '—'})`);
    }
    if (req.body.estat && req.body.estat !== prev.estat) {
      historial = afegirHistorial(historial, 'canvi_estat', `${prev.estat} → ${req.body.estat}`);
      if (req.body.estat === 'Cancel·lat') {
        data.cancellatAt = new Date();
        historial = afegirHistorial(historial, 'cancellacio', req.body.motiuCancellacio || 'Cancel·lat');
      }
      if (prev.estat === 'Cancel·lat' && req.body.estat !== 'Cancel·lat') {
        data.cancellatAt = null;
        data.motiuCancellacio = null;
        historial = afegirHistorial(historial, 'recuperacio', `Recuperat: ${prev.estat} → ${req.body.estat}`);
      }
    }
    if (req.body.conductorId && req.body.conductorId !== prev.conductorId) {
      const conductor = await prisma.conductor.findUnique({ where: { id: req.body.conductorId }, select: { nom: true } });
      historial = afegirHistorial(historial, 'assignacio', `Conductor: ${conductor?.nom || req.body.conductorId}`);
    }
    data.historial = historial;

    const transport = await prisma.transport.update({
      where: { id: req.params.id },
      data,
      include: {
        conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } },
        empresa: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, name: true } },
        rentalProject: { select: { id: true, name: true, status: true, departureDate: true } },
      },
    });

    // Sincronitzar absència automàtica
    syncTransportAbsence(transport.id).catch(e => logger.error('Error sync absence (update):', e.message));

    // Recalcular cost automàtic si algun camp rellevant ha canviat
    let finalTransport = transport;
    if (transportCostService.affectsCost(data)) {
      try {
        const result = await transportCostService.recalculate(transport.id);
        if (result?.transport) {
          finalTransport = { ...transport, ...result.transport, costBreakdown: result.breakdown };
        }
      } catch (e) {
        logger.warn(`Error recalculant cost transport ${transport.id}: ${e.message}`);
      }
    }

    res.json(finalTransport);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/logistics/transports/:id
router.delete('/transports/:id', async (req, res, next) => {
  try {
    // Eliminar absència associada primer
    await prisma.staffAbsence.deleteMany({ where: { transportId: req.params.id } });
    await prisma.transport.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/logistics/transports/:id/start — Conductor marca inici ruta
router.post('/transports/:id/start', async (req, res, next) => {
  try {
    const { hora } = req.body;
    const prev = await prisma.transport.findUnique({ where: { id: req.params.id } });
    if (!prev) return res.status(404).json({ error: 'Transport no trobat' });

    const historial = afegirHistorial(prev.historial, 'inici_ruta', `Ruta iniciada a les ${hora}`);
    const transport = await prisma.transport.update({
      where: { id: req.params.id },
      data: { horaIniciReal: hora, estat: 'En Preparació', historial },
      include: { conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } }, empresa: { select: { id: true, nom: true } } },
    });
    res.json(transport);
  } catch (err) {
    next(err);
  }
});

// POST /api/logistics/transports/:id/end — Conductor marca fi ruta
router.post('/transports/:id/end', async (req, res, next) => {
  try {
    const { hora } = req.body;
    const prev = await prisma.transport.findUnique({ where: { id: req.params.id } });
    if (!prev) return res.status(404).json({ error: 'Transport no trobat' });

    // Hores extres = excés sobre 12h des del "play" del conductor (horaIniciReal).
    // Si no s'ha donat play, no calculem (la durada de jornada no és fiable).
    const inici = prev.horaIniciReal;
    const minutsExtres = inici ? calcularHoresExtres(inici, hora) : null;
    let historial = afegirHistorial(
      prev.historial,
      'tancament',
      `Hora final: ${hora} (inici ${inici || '— sense play —'}, extres ${minutsExtres != null ? `${(minutsExtres/60).toFixed(2)}h` : '—'})`
    );
    historial = afegirHistorial(historial, 'canvi_estat', `${prev.estat} → Lliurat`);

    const transport = await prisma.transport.update({
      where: { id: req.params.id },
      data: { horaFiReal: hora, minutsExtres, estat: 'Lliurat', historial },
      include: { conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } }, empresa: { select: { id: true, nom: true } } },
    });

    // Recalcular cost ara que tenim minutsExtres real
    let finalTransport = transport;
    try {
      const result = await transportCostService.recalculate(transport.id);
      if (result?.transport) finalTransport = { ...transport, ...result.transport, costBreakdown: result.breakdown };
    } catch (e) {
      logger.warn(`Error recalculant cost al tancar transport: ${e.message}`);
    }

    res.json(finalTransport);
  } catch (err) {
    next(err);
  }
});

// GET /api/logistics/dashboard — KPIs + transports avui/demà
router.get('/dashboard', async (req, res, next) => {
  try {
    const [total, pendents, confirmats, enPreparacio, lliurats, cancellats] = await Promise.all([
      prisma.transport.count(),
      prisma.transport.count({ where: { estat: 'Pendent' } }),
      prisma.transport.count({ where: { estat: 'Confirmat' } }),
      prisma.transport.count({ where: { estat: 'En Preparació' } }),
      prisma.transport.count({ where: { estat: 'Lliurat' } }),
      prisma.transport.count({ where: { estat: 'Cancel·lat' } }),
    ]);

    // Hores extres
    const ambExtres = await prisma.transport.findMany({
      where: { minutsExtres: { gt: 0 }, estat: { not: 'Cancel·lat' } },
      select: { minutsExtres: true },
    });
    const totalExtresMin = ambExtres.reduce((sum, t) => sum + (t.minutsExtres || 0), 0);

    // Transports avui i demà
    // dataCarrega/dataEntrega són DATE. Prisma trunca el Date object a YYYY-MM-DD
    // UTC per a columnes DATE — si construïm `tomorrow` com a midnight local Madrid
    // (= 22:00 UTC del dia anterior), el truncament dóna el dia equivocat.
    // Solució: construir les dates a partir del dia local i ancorar-les a 12:00 UTC
    // perquè el truncament sigui sempre el dia correcte.
    const localToday = new Date();
    const off = localToday.getTimezoneOffset() * 60000;
    const localISO = (date) => new Date(date.getTime() - off).toISOString().slice(0, 10);
    const todayStr = localISO(localToday);
    const tomorrowStr = localISO(new Date(localToday.getTime() + 86400000));
    const dayAfterStr = localISO(new Date(localToday.getTime() + 2 * 86400000));
    const today = new Date(`${todayStr}T12:00:00Z`);
    const tomorrow = new Date(`${tomorrowStr}T12:00:00Z`);
    const dayAfter = new Date(`${dayAfterStr}T12:00:00Z`);

    const baseSelect = {
      id: true,
      tipusServei: true,
      projecte: true,
      estat: true,
      dataCarrega: true,
      dataEntrega: true,
      origen: true,
      desti: true,
      horaRecollida: true,
      horaEntregaEstimada: true,
      conductor: { select: { nom: true } },
      empresa: { select: { nom: true } },
      rentalProject: { select: { id: true, name: true } },
    };

    // Filtre exacte d'un dia: dataCarrega o dataEntrega == dayDate
    const dayWhere = (dayDate) => ({
      estat: { not: 'Cancel·lat' },
      OR: [
        { dataCarrega: dayDate },
        { dataEntrega: dayDate },
      ],
    });

    const [transportsAvui, transportsDema] = await Promise.all([
      prisma.transport.findMany({
        where: dayWhere(today),
        select: baseSelect,
        orderBy: [{ dataCarrega: 'asc' }, { horaRecollida: 'asc' }],
        take: 10,
      }),
      prisma.transport.findMany({
        where: dayWhere(tomorrow),
        select: baseSelect,
        orderBy: [{ dataCarrega: 'asc' }, { horaRecollida: 'asc' }],
        take: 10,
      }),
    ]);

    res.json({
      total, pendents, confirmats, enPreparacio, lliurats, cancellats,
      ambExtres: ambExtres.length,
      totalExtresH: (totalExtresMin / 60).toFixed(1),
      transportsAvui,
      transportsAvuiCount: transportsAvui.length,
      transportsDema,
      transportsDemaCount: transportsDema.length,
    });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// CONDUCTORS
// ===========================================

router.get('/conductors', async (req, res, next) => {
  try {
    const conductors = await prisma.conductor.findMany({
      include: {
        empresa: { select: { id: true, nom: true } },
        user: { select: { id: true, name: true, color: true } },
      },
      orderBy: { nom: 'asc' },
    });
    res.json(conductors);
  } catch (err) {
    next(err);
  }
});

router.post('/conductors', async (req, res, next) => {
  try {
    const { nom, telefon, empresaId, userId } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom requerit' });
    const conductor = await prisma.conductor.create({
      data: { nom: nom.trim(), telefon: telefon || null, empresaId: empresaId || null, userId: userId || null },
      include: {
        empresa: { select: { id: true, nom: true } },
        user: { select: { id: true, name: true, color: true } },
      },
    });
    res.status(201).json(conductor);
  } catch (err) {
    next(err);
  }
});

router.put('/conductors/:id', async (req, res, next) => {
  try {
    const { nom, telefon, empresaId, userId } = req.body;
    const conductor = await prisma.conductor.update({
      where: { id: req.params.id },
      data: { nom: nom?.trim(), telefon, empresaId: empresaId || null, userId: userId !== undefined ? (userId || null) : undefined },
      include: {
        empresa: { select: { id: true, nom: true } },
        user: { select: { id: true, name: true, color: true } },
      },
    });
    res.json(conductor);
  } catch (err) {
    next(err);
  }
});

router.delete('/conductors/:id', async (req, res, next) => {
  try {
    await prisma.conductor.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// EMPRESES LOGÍSTIQUES
// ===========================================

router.get('/empreses', async (req, res, next) => {
  try {
    const empreses = await prisma.empresaLogistica.findMany({
      include: { _count: { select: { conductors: true, transports: true } } },
      orderBy: { nom: 'asc' },
    });
    res.json(empreses);
  } catch (err) {
    next(err);
  }
});

router.post('/empreses', async (req, res, next) => {
  try {
    const { nom, emailContacte, telefonContacte, nomContacte } = req.body;
    if (!nom?.trim()) return res.status(400).json({ error: 'Nom requerit' });
    const empresa = await prisma.empresaLogistica.create({
      data: { nom: nom.trim(), emailContacte, telefonContacte, nomContacte },
    });
    res.status(201).json(empresa);
  } catch (err) {
    next(err);
  }
});

router.put('/empreses/:id', async (req, res, next) => {
  try {
    const { nom, emailContacte, telefonContacte, nomContacte } = req.body;
    const empresa = await prisma.empresaLogistica.update({
      where: { id: req.params.id },
      data: { nom: nom?.trim(), emailContacte, telefonContacte, nomContacte },
    });
    res.json(empresa);
  } catch (err) {
    next(err);
  }
});

router.delete('/empreses/:id', async (req, res, next) => {
  try {
    await prisma.empresaLogistica.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===========================================
// CONFIGURACIÓ TARIFES (singleton id='default')
// ===========================================

// GET /api/logistics/cost-config — llegeix tarifes actuals
router.get('/cost-config', async (req, res, next) => {
  try {
    const config = await transportCostService.getConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
});

// PUT /api/logistics/cost-config — actualitza tarifes (només ADMIN)
router.put('/cost-config', async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Només ADMIN pot modificar tarifes' });
    }

    const num = (v, fallback) => {
      if (v === undefined || v === null || v === '') return fallback;
      const n = parseFloat(v);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };

    const data = {
      updatedAt: new Date(),
      updatedById: req.user.id,
    };
    if (req.body.costEntregaRecollida !== undefined) data.costEntregaRecollida = num(req.body.costEntregaRecollida, 0);
    if (req.body.costRodatgeDia !== undefined)      data.costRodatgeDia = num(req.body.costRodatgeDia, 0);
    if (req.body.costIntern !== undefined)          data.costIntern = num(req.body.costIntern, 0);
    if (req.body.costPerKm !== undefined)           data.costPerKm = num(req.body.costPerKm, 0);
    if (req.body.tarifaHoraExtra !== undefined)     data.tarifaHoraExtra = num(req.body.tarifaHoraExtra, 0);

    const updated = await prisma.transportCostConfig.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data },
    });

    transportCostService.clearConfigCache();
    logger.info(`TransportCostConfig actualitzat per ${req.user.name || req.user.id}`);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/logistics/transports/:id/recompute-cost — força recàlcul manual
// Body opcional: { forceKm: true } per esborrar km i tornar-los a buscar
router.post('/transports/:id/recompute-cost', async (req, res, next) => {
  try {
    const result = await transportCostService.recalculate(req.params.id, {
      forceKm: !!req.body?.forceKm,
    });
    if (!result) return res.status(404).json({ error: 'Transport no trobat' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/logistics/distance — calcula km entre dues adreces sense persistir
// Útil per al modal de nou transport (encara no existeix a BD).
// Body: { origen?, desti } → retorna { km, oneway, origen, desti, source: 'google' }
router.post('/distance', async (req, res, next) => {
  try {
    if (!distanceService.isConfigured()) {
      return res.status(503).json({
        error: 'Servei de distàncies no configurat',
        code: 'MISSING_API_KEY',
        hint: 'Cal definir GOOGLE_MAPS_API_KEY a l\'entorn del backend',
      });
    }
    const { origen, desti } = req.body || {};
    if (!desti?.trim()) return res.status(400).json({ error: 'Camp `desti` obligatori', code: 'EMPTY_ADDRESS' });

    const o = origen?.trim() || (await distanceService.getHqAddress());
    const km = await distanceService.getRoundtripKm({ origen: o, desti });
    const oneway = Math.round(km / 2 * 10) / 10;
    res.json({ km, oneway, origen: o, desti: desti.trim(), source: 'google' });
  } catch (err) {
    if (err?.code === 'NOT_FOUND' || err?.code === 'EMPTY_ADDRESS') {
      return res.status(404).json({ error: err.message, code: err.code });
    }
    if (err?.code === 'API_ERROR' || err?.code === 'MISSING_API_KEY') {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

module.exports = router;
