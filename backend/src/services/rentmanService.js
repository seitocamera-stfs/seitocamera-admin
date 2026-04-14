const https = require('https');
const { URL } = require('url');
const { logger } = require('../config/logger');

const API_URL = process.env.RENTMAN_API_URL || 'https://api.rentman.net';

/**
 * Fa una crida GET a l'API de Rentman
 */
function rentmanGet(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    const token = process.env.RENTMAN_API_TOKEN;
    if (!token) {
      return reject(new Error('RENTMAN_API_TOKEN no configurat'));
    }

    const queryParams = new URLSearchParams(params);
    const url = new URL(`${endpoint}?${queryParams}`, API_URL);

    const options = {
      method: 'GET',
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Rentman error ${res.statusCode}: ${json.message || JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Error parsejant resposta Rentman (status ${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// =============================================
// PROJECTES
// =============================================

/**
 * Llista tots els projectes
 * @param {Object} params - Filtres opcionals (limit, offset, etc.)
 */
async function getProjects(params = {}) {
  const defaultParams = { limit: 300, ...params };
  const result = await rentmanGet('/projects', defaultParams);
  return result.data || result;
}

/**
 * Obté detall d'un projecte
 */
async function getProject(projectId) {
  const result = await rentmanGet(`/projects/${projectId}`);
  return result.data || result;
}

/**
 * Obté els subitems d'un projecte (equip assignat, crew, transport, etc.)
 */
async function getProjectEquipment(projectId) {
  const result = await rentmanGet(`/projects/${projectId}/equipment`);
  return result.data || result;
}

async function getProjectCrew(projectId) {
  const result = await rentmanGet(`/projects/${projectId}/crew`);
  return result.data || result;
}

// =============================================
// FACTURES
// =============================================

/**
 * Llista totes les factures de Rentman
 */
async function getInvoices(params = {}) {
  const defaultParams = { limit: 300, ...params };
  const result = await rentmanGet('/invoices', defaultParams);
  return result.data || result;
}

/**
 * Obté detall d'una factura
 */
async function getInvoice(invoiceId) {
  const result = await rentmanGet(`/invoices/${invoiceId}`);
  return result.data || result;
}

/**
 * Obté les línies d'una factura
 */
async function getInvoiceLines(invoiceId) {
  const result = await rentmanGet(`/invoices/${invoiceId}/lines`);
  return result.data || result;
}

// =============================================
// CONTACTES
// =============================================

/**
 * Llista contactes (per poder linkar amb clients de SeitoCamera)
 */
async function getContacts(params = {}) {
  const defaultParams = { limit: 300, ...params };
  const result = await rentmanGet('/contacts', defaultParams);
  return result.data || result;
}

async function getContact(contactId) {
  const result = await rentmanGet(`/contacts/${contactId}`);
  return result.data || result;
}

// =============================================
// EQUIP
// =============================================

/**
 * Llista l'inventari d'equip
 */
async function getEquipment(params = {}) {
  const defaultParams = { limit: 300, ...params };
  const result = await rentmanGet('/equipment', defaultParams);
  return result.data || result;
}

// =============================================
// UTILITATS
// =============================================

/**
 * Comprova la connexió a l'API de Rentman
 */
async function testConnection() {
  try {
    await rentmanGet('/contacts', { limit: 1 });
    return { connected: true };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

module.exports = {
  rentmanGet,
  getProjects,
  getProject,
  getProjectEquipment,
  getProjectCrew,
  getInvoices,
  getInvoice,
  getInvoiceLines,
  getContacts,
  getContact,
  getEquipment,
  testConnection,
};
