const express = require('express');
const { authenticate } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

const router = express.Router();
router.use(authenticate);

// ===========================================
// Utils
// ===========================================

function calcularHoresExtres(horaFiPrevista, horaFiReal) {
  const toMin = (hm) => {
    if (!hm) return null;
    const m = hm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1]) * 60 + parseInt(m[2]);
  };
  const prev = toMin(horaFiPrevista);
  const real = toMin(horaFiReal);
  if (prev == null || real == null) return null;
  let diff = real - prev;
  if (diff < -12 * 60) diff += 24 * 60;
  return diff;
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
    const { estat, tipusServei, responsable, cerca, dataFrom, dataTo, empresaId, conductorId } = req.query;
    const where = {};
    if (estat) where.estat = estat;
    if (tipusServei) where.tipusServei = tipusServei;
    if (responsable) where.responsableProduccio = responsable;
    if (empresaId) where.empresaId = empresaId;
    if (conductorId) where.conductorId = conductorId;
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
      ];
    }

    const transports = await prisma.transport.findMany({
      where,
      include: {
        conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } },
        empresa: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, name: true } },
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
      projecte, tipusServei, origen, notesOrigen, desti, notesDesti,
      dataCarrega, dataEntrega, horaRecollida, horaEntregaEstimada, horaFiPrevista,
      responsableProduccio, telefonResponsable, conductorId, empresaId,
      estat, notes,
    } = req.body;

    const historial = afegirHistorial([], 'creat', `Transport creat per ${req.user.name || 'admin'}`);

    const transport = await prisma.transport.create({
      data: {
        projecte: projecte || null,
        tipusServei: tipusServei || 'Entrega',
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
      },
    });

    // Sincronitzar absència automàtica si conductor és usuari Seito
    syncTransportAbsence(transport.id).catch(e => logger.error('Error sync absence (create):', e.message));

    res.status(201).json(transport);
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
      'projecte', 'tipusServei', 'origen', 'notesOrigen', 'desti', 'notesDesti',
      'horaRecollida', 'horaEntregaEstimada', 'horaFiPrevista',
      'horaIniciReal', 'horaFiReal', 'responsableProduccio', 'telefonResponsable',
      'conductorId', 'empresaId', 'estat', 'motiuCancellacio', 'notes',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) data[f] = req.body[f] || null;
    }
    if (req.body.dataCarrega !== undefined) data.dataCarrega = req.body.dataCarrega ? new Date(req.body.dataCarrega) : null;
    if (req.body.dataEntrega !== undefined) data.dataEntrega = req.body.dataEntrega ? new Date(req.body.dataEntrega) : null;

    // Calcular hores extres
    if (req.body.horaFiReal !== undefined) {
      const prevista = data.horaFiPrevista || prev.horaFiPrevista;
      data.minutsExtres = calcularHoresExtres(prevista, req.body.horaFiReal);
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
      },
    });

    // Sincronitzar absència automàtica
    syncTransportAbsence(transport.id).catch(e => logger.error('Error sync absence (update):', e.message));

    res.json(transport);
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

    const minutsExtres = calcularHoresExtres(prev.horaFiPrevista, hora);
    let historial = afegirHistorial(prev.historial, 'tancament', `Hora final: ${hora} (previst ${prev.horaFiPrevista || '—'})`);
    historial = afegirHistorial(historial, 'canvi_estat', `${prev.estat} → Lliurat`);

    const transport = await prisma.transport.update({
      where: { id: req.params.id },
      data: { horaFiReal: hora, minutsExtres, estat: 'Lliurat', historial },
      include: { conductor: { select: { id: true, nom: true, telefon: true, userId: true, user: { select: { id: true, name: true, color: true } } } }, empresa: { select: { id: true, nom: true } } },
    });
    res.json(transport);
  } catch (err) {
    next(err);
  }
});

// GET /api/logistics/dashboard — KPIs
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

    res.json({
      total, pendents, confirmats, enPreparacio, lliurats, cancellats,
      ambExtres: ambExtres.length,
      totalExtresH: (totalExtresMin / 60).toFixed(1),
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

module.exports = router;
