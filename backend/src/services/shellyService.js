const https = require('https');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Shelly Cloud API Service
// ===========================================
// Connecta amb Shelly Pro 3EM per obtenir lectures de consum elèctric.
// Estratègia: poll periòdic de /device/status → guardar comptador acumulat.
// El consum d'un període = lectura final - lectura inicial.
// ===========================================

async function getCredentials() {
  try {
    const conn = await prisma.serviceConnection.findUnique({
      where: { provider: 'SHELLY' },
    });
    if (!conn || !conn.apiKey) return null;
    return {
      authKey: conn.apiKey,
      serverUri: conn.config?.serverUri || conn.config?.server_uri,
      deviceId: conn.config?.deviceId || conn.config?.device_id,
      status: conn.status,
    };
  } catch (err) {
    logger.warn(`Shelly getCredentials error: ${err.message}`);
    return null;
  }
}

async function isAvailable() {
  const creds = await getCredentials();
  return !!(creds && creds.authKey && creds.serverUri && creds.deviceId);
}

// ===========================================
// HTTP Helper
// ===========================================

function shellyCloudRequest(serverUri, path, formData) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(formData).toString();
    const options = {
      hostname: serverUri,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.isok === false) {
            reject(new Error(`Shelly API error: ${JSON.stringify(parsed.errors || parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Resposta no JSON de Shelly: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Shelly API timeout (30s)')); });
    req.write(postData);
    req.end();
  });
}

// ===========================================
// Lectura del comptador acumulat
// ===========================================

/**
 * Obté l'estat actual del dispositiu (inclou comptadors acumulats d'energia).
 * Retorna les lectures de emdata:0 (total_act en Wh acumulat des de sempre).
 */
async function getDeviceStatus() {
  const creds = await getCredentials();
  if (!creds) throw new Error('Shelly no configurat');
  return shellyCloudRequest(creds.serverUri, '/device/status', {
    id: creds.deviceId,
    auth_key: creds.authKey,
  });
}

/**
 * Fa una lectura del comptador actual i la guarda a la BD.
 * Es crida periòdicament (cada 2-4h) pel cron job.
 * Guarda els Wh acumulats de cada fase + total.
 */
async function takeReading() {
  const creds = await getCredentials();
  if (!creds) throw new Error('Shelly no configurat');

  const response = await getDeviceStatus();
  const status = response.data?.device_status || {};
  const emdata = status['emdata:0'];

  if (!emdata) {
    throw new Error('No s\'han trobat dades emdata:0 al dispositiu');
  }

  const now = new Date();
  const dateOnly = new Date(now);
  dateOnly.setHours(0, 0, 0, 0);

  // Guardar lectura acumulada (upsert per dia+dispositiu)
  const reading = await prisma.shellyEnergyReading.upsert({
    where: {
      date_deviceId: {
        date: dateOnly,
        deviceId: creds.deviceId,
      },
    },
    update: {
      // Guardem els acumulats totals (Wh → kWh)
      whPhaseA: emdata.a_total_act_energy / 1000,
      whPhaseB: emdata.b_total_act_energy / 1000,
      whPhaseC: emdata.c_total_act_energy / 1000,
      totalKwh: emdata.total_act / 1000,
      minuteRecords: 1, // indica que tenim lectura
      syncedAt: now,
    },
    create: {
      date: dateOnly,
      deviceId: creds.deviceId,
      whPhaseA: emdata.a_total_act_energy / 1000,
      whPhaseB: emdata.b_total_act_energy / 1000,
      whPhaseC: emdata.c_total_act_energy / 1000,
      totalKwh: emdata.total_act / 1000,
      minuteRecords: 1,
    },
  });

  const totalKwh = Math.round(emdata.total_act / 10) / 100;
  logger.info(`Shelly reading: ${totalKwh} kWh acumulats (A: ${Math.round(emdata.a_total_act_energy/10)/100}, B: ${Math.round(emdata.b_total_act_energy/10)/100}, C: ${Math.round(emdata.c_total_act_energy/10)/100})`);

  return {
    date: dateOnly,
    phaseA: emdata.a_total_act_energy,
    phaseB: emdata.b_total_act_energy,
    phaseC: emdata.c_total_act_energy,
    totalWh: emdata.total_act,
    totalKwh,
  };
}

// ===========================================
// Càlcul de consum per període
// ===========================================

/**
 * Calcula el consum d'un període a partir de les lectures acumulades.
 * Consum = lectura final - lectura inicial.
 *
 * @param {Date} from - Inici del període
 * @param {Date} to - Fi del període
 * @returns {{ consumKwh, readingStart, readingEnd, daysWithData }}
 */
async function getConsumption(from, to) {
  const fromDate = new Date(from);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(to);
  toDate.setHours(0, 0, 0, 0);

  // Buscar la lectura més propera a l'inici del període (la primera disponible >= from, o l'última < from)
  const readingStart = await prisma.shellyEnergyReading.findFirst({
    where: { date: { lte: fromDate } },
    orderBy: { date: 'desc' },
  }) || await prisma.shellyEnergyReading.findFirst({
    where: { date: { gte: fromDate } },
    orderBy: { date: 'asc' },
  });

  // Buscar la lectura més propera al final del període
  const readingEnd = await prisma.shellyEnergyReading.findFirst({
    where: { date: { lte: toDate } },
    orderBy: { date: 'desc' },
  }) || await prisma.shellyEnergyReading.findFirst({
    where: { date: { gte: toDate } },
    orderBy: { date: 'desc' },
  });

  if (!readingStart || !readingEnd) {
    return {
      consumKwh: 0,
      days: 0,
      error: 'No hi ha lectures de Shelly per aquest període. Cal esperar que el sync acumuli dades.',
    };
  }

  if (readingStart.id === readingEnd.id) {
    return {
      consumKwh: 0,
      days: 0,
      error: 'Només hi ha una lectura disponible. Calen mínim dues lectures per calcular consum.',
    };
  }

  // Consum = diferència entre lectures acumulades
  const consumKwh = parseFloat(readingEnd.totalKwh) - parseFloat(readingStart.totalKwh);

  // Totes les lectures del període per breakdown diari
  const allReadings = await prisma.shellyEnergyReading.findMany({
    where: {
      date: { gte: readingStart.date, lte: readingEnd.date },
    },
    orderBy: { date: 'asc' },
  });

  const dailyBreakdown = [];
  for (let i = 1; i < allReadings.length; i++) {
    const prev = allReadings[i - 1];
    const curr = allReadings[i];
    dailyBreakdown.push({
      date: curr.date.toISOString().split('T')[0],
      consumKwh: Math.round((parseFloat(curr.totalKwh) - parseFloat(prev.totalKwh)) * 100) / 100,
    });
  }

  return {
    consumKwh: Math.round(consumKwh * 100) / 100,
    days: allReadings.length,
    readingStart: { date: readingStart.date.toISOString().split('T')[0], totalKwh: parseFloat(readingStart.totalKwh) },
    readingEnd: { date: readingEnd.date.toISOString().split('T')[0], totalKwh: parseFloat(readingEnd.totalKwh) },
    dailyBreakdown,
  };
}

/**
 * Calcula el repartiment d'una factura de llum.
 *
 * @param {Date} from - Inici del període de facturació
 * @param {Date} to - Fi del període
 * @param {number} totalBillKwh - kWh totals de la factura
 * @param {number} totalBillAmount - Import total de la factura (€)
 * @returns {{ shellyKwh, seitoKwh, seitoPercent, logistikPercent, seitoAmount, logistikAmount }}
 */
async function suggestSplit(from, to, totalBillKwh, totalBillAmount = 0) {
  const consumption = await getConsumption(from, to);

  if (consumption.error) {
    return { error: consumption.error };
  }

  const shellyKwh = consumption.consumKwh; // Consum de l'altra part (mesurat per Shelly)
  const seitoKwh = Math.max(0, totalBillKwh - shellyKwh);

  const logistikPercent = totalBillKwh > 0
    ? Math.round((shellyKwh / totalBillKwh) * 10000) / 100
    : 50;
  const seitoPercent = Math.round((100 - logistikPercent) * 100) / 100;

  const result = {
    shellyKwh,
    seitoKwh: Math.round(seitoKwh * 100) / 100,
    totalBillKwh,
    seitoPercent,
    logistikPercent,
    daysWithData: consumption.days,
    readingStart: consumption.readingStart,
    readingEnd: consumption.readingEnd,
    dailyBreakdown: consumption.dailyBreakdown,
  };

  // Si tenim l'import, calcular euros
  if (totalBillAmount > 0) {
    result.totalBillAmount = totalBillAmount;
    result.seitoAmount = Math.round(totalBillAmount * seitoPercent) / 100;
    result.logistikAmount = Math.round(totalBillAmount * logistikPercent) / 100;
  }

  return result;
}

/**
 * Test de connexió
 */
async function testConnection() {
  try {
    const response = await getDeviceStatus();
    const status = response.data?.device_status || {};
    return {
      connected: true,
      online: response.data?.online || false,
      deviceId: status.sys?.id || status.id || 'desconegut',
      model: status.sys?.model || 'desconegut',
      wifi: status.wifi?.ssid || null,
      totalKwh: status['emdata:0']?.total_act ? Math.round(status['emdata:0'].total_act / 10) / 100 : null,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  getCredentials,
  isAvailable,
  getDeviceStatus,
  takeReading,
  getConsumption,
  suggestSplit,
  testConnection,
};
