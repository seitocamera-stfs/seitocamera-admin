const https = require('https');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');

// ===========================================
// Shelly Cloud API Service
// ===========================================
// Connecta amb Shelly Pro 3EM per obtenir lectures de consum elèctric.
// Les dades s'utilitzen per calcular el repartiment de factures compartides.
//
// API Docs: https://shelly-api-docs.shelly.cloud/cloud-control-api/
// EMData: https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EMData/
// ===========================================

/**
 * Obté les credencials de Shelly des de ServiceConnection
 * @returns {{ authKey, serverUri, deviceId } | null}
 */
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

/**
 * Comprova si Shelly està configurat i actiu
 */
async function isAvailable() {
  const creds = await getCredentials();
  return !!(creds && creds.authKey && creds.serverUri && creds.deviceId);
}

// ===========================================
// HTTP Helper per Shelly Cloud API
// ===========================================

/**
 * Fa una petició POST a l'API Cloud de Shelly
 * @param {string} serverUri - Ex: "shelly-103-eu.shelly.cloud"
 * @param {string} authKey - Cloud auth key
 * @param {Object} body - JSON body
 */
function shellyRequest(serverUri, authKey, body) {
  return new Promise((resolve, reject) => {
    // Shelly Cloud API espera form-urlencoded amb auth_key al body
    const postData = new URLSearchParams(body).toString();

    const options = {
      hostname: serverUri,
      path: `/device/rpc`,
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
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Shelly API timeout (30s)'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Crida un mètode RPC al dispositiu Shelly via Cloud
 */
async function callRpc(method, params = {}) {
  const creds = await getCredentials();
  if (!creds) throw new Error('Shelly no configurat');

  // Shelly Cloud API: form-encoded amb id, auth_key, method (i opcionalment params com JSON string)
  const body = {
    id: creds.deviceId,
    auth_key: creds.authKey,
    method,
  };
  if (Object.keys(params).length > 0) {
    body.params = JSON.stringify(params);
  }

  return shellyRequest(creds.serverUri, creds.authKey, body);
}

// ===========================================
// Lectures de consum
// ===========================================

/**
 * Obté les dades de consum d'un dia concret des de l'API Shelly.
 * EMData.GetData retorna lectures per minut en Wh.
 *
 * @param {Date} date - Dia a consultar
 * @returns {{ phaseA: number, phaseB: number, phaseC: number, totalKwh: number, records: number }}
 */
async function fetchDayData(date) {
  // Calcular timestamps UTC per al dia (Barcelona = UTC+1/+2)
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const tsStart = Math.floor(dayStart.getTime() / 1000);
  const tsEnd = Math.floor(dayEnd.getTime() / 1000);

  logger.info(`Shelly fetchDayData: ${date.toISOString().split('T')[0]} (ts: ${tsStart} → ${tsEnd})`);

  const response = await callRpc('EMData.GetData', {
    id: 0,
    ts: tsStart,
    end_ts: tsEnd,
  });

  // La resposta conté { data: { keys: [...], data: [{ ts, period, values: [...] }] } }
  const result = response.data || response;
  const keys = result.keys || [];
  const records = result.data || [];

  // Trobar els índexs de les claus d'energia
  const idxA = keys.indexOf('a_total_act_energy');
  const idxB = keys.indexOf('b_total_act_energy');
  const idxC = keys.indexOf('c_total_act_energy');
  const idxTotal = keys.indexOf('total_act');

  let phaseA = 0, phaseB = 0, phaseC = 0, totalWh = 0;

  for (const record of records) {
    const vals = record.values || record;
    if (Array.isArray(vals)) {
      if (idxA >= 0 && vals[idxA] != null) phaseA += vals[idxA];
      if (idxB >= 0 && vals[idxB] != null) phaseB += vals[idxB];
      if (idxC >= 0 && vals[idxC] != null) phaseC += vals[idxC];
      if (idxTotal >= 0 && vals[idxTotal] != null) totalWh += vals[idxTotal];
    }
  }

  // Si no hi ha total_act, calcular com a suma de fases
  if (totalWh === 0 && (phaseA + phaseB + phaseC) > 0) {
    totalWh = phaseA + phaseB + phaseC;
  }

  // Convertir Wh a kWh
  return {
    phaseA: phaseA / 1000,
    phaseB: phaseB / 1000,
    phaseC: phaseC / 1000,
    totalKwh: totalWh / 1000,
    records: records.length,
  };
}

/**
 * Sincronitza un dia: descarrega dades i upsert a la BD
 */
async function syncDay(date) {
  const creds = await getCredentials();
  if (!creds) throw new Error('Shelly no configurat');

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  try {
    const data = await fetchDayData(dateOnly);

    await prisma.shellyEnergyReading.upsert({
      where: {
        date_deviceId: {
          date: dateOnly,
          deviceId: creds.deviceId,
        },
      },
      update: {
        whPhaseA: data.phaseA,
        whPhaseB: data.phaseB,
        whPhaseC: data.phaseC,
        totalKwh: data.totalKwh,
        minuteRecords: data.records,
        syncedAt: new Date(),
      },
      create: {
        date: dateOnly,
        deviceId: creds.deviceId,
        whPhaseA: data.phaseA,
        whPhaseB: data.phaseB,
        whPhaseC: data.phaseC,
        totalKwh: data.totalKwh,
        minuteRecords: data.records,
      },
    });

    logger.info(`Shelly syncDay: ${dateOnly.toISOString().split('T')[0]} → ${data.totalKwh.toFixed(2)} kWh (${data.records} registres)`);
    return data;
  } catch (err) {
    logger.error(`Shelly syncDay error (${dateOnly.toISOString().split('T')[0]}): ${err.message}`);
    throw err;
  }
}

/**
 * Sincronitza un rang de dates
 */
async function syncDateRange(from, to) {
  const results = [];
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    try {
      const data = await syncDay(new Date(current));
      results.push({ date: current.toISOString().split('T')[0], ...data });
    } catch (err) {
      results.push({ date: current.toISOString().split('T')[0], error: err.message });
    }
    current.setDate(current.getDate() + 1);
    // Petit delay per no sobrecarregar l'API
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

/**
 * Obté les lectures emmagatzemades per un període
 * @returns {{ totalKwh, days, dailyBreakdown[] }}
 */
async function getConsumption(from, to) {
  const readings = await prisma.shellyEnergyReading.findMany({
    where: {
      date: {
        gte: new Date(from),
        lte: new Date(to),
      },
    },
    orderBy: { date: 'asc' },
  });

  let totalKwh = 0;
  const dailyBreakdown = readings.map((r) => {
    const kwh = parseFloat(r.totalKwh);
    totalKwh += kwh;
    return {
      date: r.date.toISOString().split('T')[0],
      phaseA: parseFloat(r.whPhaseA),
      phaseB: parseFloat(r.whPhaseB),
      phaseC: parseFloat(r.whPhaseC),
      totalKwh: kwh,
      minuteRecords: r.minuteRecords,
      completeness: Math.round((r.minuteRecords / 1440) * 100),
    };
  });

  return {
    totalKwh: Math.round(totalKwh * 100) / 100,
    days: readings.length,
    dailyBreakdown,
  };
}

/**
 * Calcula el suggeriment de split per una factura de llum
 * @param {Date} from - Inici del període de facturació
 * @param {Date} to - Fi del període
 * @param {number} totalBillKwh - kWh totals de la factura de llum
 */
async function suggestSplit(from, to, totalBillKwh) {
  const consumption = await getConsumption(from, to);

  if (consumption.days === 0) {
    return { error: 'No hi ha dades de consum per aquest període' };
  }

  const shellyKwh = consumption.totalKwh; // Consum no-Seito
  const seitoKwh = Math.max(0, totalBillKwh - shellyKwh);

  const logistikPercent = totalBillKwh > 0
    ? Math.round((shellyKwh / totalBillKwh) * 10000) / 100
    : 50;
  const seitoPercent = Math.round((100 - logistikPercent) * 100) / 100;

  return {
    shellyKwh,
    seitoKwh: Math.round(seitoKwh * 100) / 100,
    totalBillKwh,
    seitoPercent,
    logistikPercent,
    daysWithData: consumption.days,
    dailyBreakdown: consumption.dailyBreakdown,
  };
}

/**
 * Test de connexió
 */
async function testConnection() {
  try {
    const response = await callRpc('Shelly.GetStatus');
    return {
      connected: true,
      deviceId: response.data?.sys?.id || 'desconegut',
      model: response.data?.sys?.model || 'desconegut',
      uptime: response.data?.sys?.uptime,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = {
  getCredentials,
  isAvailable,
  fetchDayData,
  syncDay,
  syncDateRange,
  getConsumption,
  suggestSplit,
  testConnection,
};
