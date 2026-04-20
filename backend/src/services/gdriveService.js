const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { logger } = require('../config/logger');

// Estructura de carpetes a Google Drive:
// SeitoCamera/
//   ├── factures-rebudes/
//   ├── factures-emeses/
//   ├── documents/
//   └── backups/

let driveClient = null;

/**
 * Inicialitza el client de Google Drive.
 * Suporta Service Account (producció) o OAuth2 (dev).
 */
function getDriveClient() {
  if (driveClient) return driveClient;

  // PRIORITAT 1: OAuth2 — funciona amb comptes Gmail/Workspace personals
  // El Service Account no té quota de disc i no pot crear fitxers.
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    driveClient = google.drive({ version: 'v3', auth: oauth2 });
    logger.info('Google Drive: Autenticat amb OAuth2');
  } else {
    // PRIORITAT 2: Service Account (només lectura / Shared Drives)
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const credentials = process.env.GOOGLE_CREDENTIALS_JSON;

    if (keyFile && fs.existsSync(keyFile)) {
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      driveClient = google.drive({ version: 'v3', auth });
      logger.info('Google Drive: Autenticat amb Service Account (fitxer)');
    } else if (credentials) {
      const parsed = JSON.parse(credentials);
      const auth = new google.auth.GoogleAuth({
        credentials: parsed,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      driveClient = google.drive({ version: 'v3', auth });
      logger.info('Google Drive: Autenticat amb Service Account (inline)');
    } else {
      throw new Error(
        'Google Drive no configurat. Executa: node scripts/setup-gdrive-oauth.js'
      );
    }
  }

  return driveClient;
}

/**
 * Busca o crea una carpeta per nom dins d'un pare
 */
async function findOrCreateFolder(name, parentId = null) {
  const drive = getDriveClient();

  // Buscar si ja existeix
  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files.length > 0) {
    return res.data.files[0];
  }

  // Crear
  const fileMetadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) fileMetadata.parents = [parentId];

  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id, name',
    supportsAllDrives: true,
  });

  logger.info(`Carpeta Google Drive creada: ${name} (${folder.data.id})`);
  return folder.data;
}

/**
 * Assegura l'estructura de carpetes:
 * SeitoCamera/ → factures-rebudes/, factures-emeses/, documents/, backups/
 */
async function ensureFolderStructure() {
  const rootName = process.env.GDRIVE_ROOT_FOLDER || 'SeitoCamera';
  const root = await findOrCreateFolder(rootName);

  const subfolders = ['factures-rebudes', 'factures-emeses', 'documents', 'backups'];
  const result = { root };

  for (const name of subfolders) {
    result[name] = await findOrCreateFolder(name, root.id);
  }

  // Crear subcarpetes especials dins factures-rebudes
  const facturesRebudesId = result['factures-rebudes'].id;
  result['inbox'] = await findOrCreateFolder('inbox', facturesRebudesId);
  result['duplicades'] = await findOrCreateFolder('duplicades', facturesRebudesId);

  logger.info('Estructura de carpetes Google Drive inicialitzada (amb inbox i duplicades)');
  return result;
}

/**
 * Obté l'ID de la carpeta arrel (SeitoCamera)
 */
async function getRootFolderId() {
  const rootName = process.env.GDRIVE_ROOT_FOLDER || 'SeitoCamera';
  const folder = await findOrCreateFolder(rootName);
  return folder.id;
}

/**
 * Obté l'ID d'una subcarpeta dins de SeitoCamera
 */
async function getSubfolderId(subfolderName) {
  const rootId = await getRootFolderId();
  const folder = await findOrCreateFolder(subfolderName, rootId);
  return folder.id;
}

/**
 * Calcula el trimestre a partir d'un mes (1-12)
 */
function getQuarter(month) {
  return Math.ceil(month / 3);
}

/**
 * Obté o crea l'estructura de subcarpetes Any/Trimestre/Mes
 * dins d'una carpeta base (ex: factures-rebudes/2026/T2/04/)
 *
 * @param {string} baseSubfolder - Carpeta base (ex: 'factures-rebudes')
 * @param {Date} [date] - Data per determinar any/trimestre/mes (default: ara)
 * @returns {string} ID de la carpeta final (mes)
 */
async function getDateBasedFolderId(baseSubfolder, date = new Date()) {
  const year = date.getFullYear().toString();
  const month = date.getMonth() + 1;
  const quarter = `T${getQuarter(month)}`;
  const monthStr = month.toString().padStart(2, '0');

  // SeitoCamera/ → baseSubfolder/ → any/ → trimestre/ → mes/
  const baseFolderId = await getSubfolderId(baseSubfolder);
  const yearFolder = await findOrCreateFolder(year, baseFolderId);
  const quarterFolder = await findOrCreateFolder(quarter, yearFolder.id);
  const monthFolder = await findOrCreateFolder(monthStr, quarterFolder.id);

  return monthFolder.id;
}

/**
 * Puja un fitxer a Google Drive
 * @param {string} localFilePath - Camí del fitxer local
 * @param {string} subfolder - Subcarpeta destí (ex: 'factures-rebudes')
 * @param {string} [customName] - Nom personalitzat (opcional)
 * @param {Date} [invoiceDate] - Data de la factura per organitzar en Any/Trimestre/Mes
 * @returns {{ id, name, webViewLink }}
 */
async function uploadFile(localFilePath, subfolder, customName = null, invoiceDate = null) {
  const drive = getDriveClient();

  // Si és una carpeta de factures, usar estructura Any/Trimestre/Mes
  const useDataStructure = ['factures-rebudes', 'factures-emeses'].includes(subfolder);
  const folderId = useDataStructure
    ? await getDateBasedFolderId(subfolder, invoiceDate || new Date())
    : await getSubfolderId(subfolder);

  const fileName = customName || path.basename(localFilePath);

  const res = await drive.files.create({
    resource: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: fs.createReadStream(localFilePath),
    },
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  if (useDataStructure) {
    const d = invoiceDate || new Date();
    const m = d.getMonth() + 1;
    logger.info(`Fitxer pujat a Google Drive: ${subfolder}/${d.getFullYear()}/T${getQuarter(m)}/${m.toString().padStart(2, '0')}/${fileName} (${res.data.id})`);
  } else {
    logger.info(`Fitxer pujat a Google Drive: ${fileName} (${res.data.id})`);
  }

  return res.data;
}

/**
 * Llista fitxers d'una subcarpeta
 */
async function listFiles(subfolder, pageSize = 50) {
  const drive = getDriveClient();
  const folderId = await getSubfolderId(subfolder);

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink)',
    orderBy: 'modifiedTime desc',
    pageSize,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files;
}

/**
 * Obté link de visualització/descàrrega d'un fitxer
 */
async function getFileLink(fileId) {
  const drive = getDriveClient();

  const res = await drive.files.get({
    fileId,
    fields: 'id, name, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  return res.data;
}

/**
 * Descarrega un fitxer de Google Drive a disc local
 */
async function downloadFile(fileId, destPath) {
  const drive = getDriveClient();

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data.pipe(dest);
    dest.on('finish', () => {
      logger.info(`Fitxer descarregat de Google Drive: ${fileId} → ${destPath}`);
      resolve(destPath);
    });
    dest.on('error', reject);
  });
}

/**
 * Mou un fitxer d'una carpeta a una altra dins de Google Drive
 * @param {string} fileId - ID del fitxer
 * @param {string} newParentId - ID de la carpeta destí
 * @param {string} [oldParentId] - ID de la carpeta origen (opcional, s'auto-detecta)
 */
async function moveFile(fileId, newParentId, oldParentId = null) {
  const drive = getDriveClient();

  // Obtenir parent actual si no s'ha passat
  if (!oldParentId) {
    const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
    oldParentId = file.data.parents ? file.data.parents[0] : null;
  }

  const params = {
    fileId,
    addParents: newParentId,
    fields: 'id, name, parents',
    supportsAllDrives: true,
  };
  if (oldParentId) params.removeParents = oldParentId;

  const res = await drive.files.update(params);
  logger.info(`Fitxer mogut a Google Drive: ${res.data.name} → carpeta ${newParentId}`);
  return res.data;
}

/**
 * Copia un fitxer a una altra carpeta dins de Google Drive
 * @param {string} fileId - ID del fitxer original
 * @param {string} destinationFolderId - ID de la carpeta destí
 * @param {string} [newName] - Nom opcional per la còpia
 * @returns {Object} - Dades del fitxer copiat (id, name, parents)
 */
async function copyFile(fileId, destinationFolderId, newName = null) {
  const drive = getDriveClient();
  const resource = { parents: [destinationFolderId] };
  if (newName) resource.name = newName;

  const res = await drive.files.copy({
    fileId,
    resource,
    fields: 'id, name, parents',
    supportsAllDrives: true,
  });
  logger.info(`Fitxer copiat a Google Drive: ${res.data.name} → carpeta ${destinationFolderId}`);
  return res.data;
}

/**
 * Busca una carpeta per nom al Drive (a qualsevol nivell).
 * Retorna l'ID de la primera carpeta trobada, o null.
 * @param {string} folderName - Nom exacte de la carpeta
 * @returns {string|null}
 */
async function findFolderByName(folderName) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, parents)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 5,
  });
  return res.data.files?.length > 0 ? res.data.files[0].id : null;
}

/**
 * Elimina un fitxer de Google Drive (el mou a la paperera)
 */
async function deleteFile(fileId) {
  const drive = getDriveClient();
  await drive.files.update({ fileId, resource: { trashed: true }, supportsAllDrives: true });
  logger.info(`Fitxer eliminat de Google Drive: ${fileId}`);
}

/**
 * Detecta fitxers nous a una carpeta (per sincronització)
 * Retorna fitxers modificats/creats després d'una data donada
 */
async function getNewFiles(subfolder, sinceDate) {
  const drive = getDriveClient();
  const folderId = await getSubfolderId(subfolder);
  const since = sinceDate.toISOString();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and modifiedTime > '${since}'`,
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return res.data.files;
}

/**
 * Busca fitxers nous recursivament dins d'una carpeta i totes les subcarpetes.
 * Útil per detectar PDFs pujats manualment a qualsevol nivell de
 * factures-rebudes/2026/T2/04/ o directament a factures-rebudes/.
 *
 * @param {string} subfolder - Carpeta base (ex: 'factures-rebudes')
 * @param {Date} sinceDate - Només fitxers creats/modificats després d'aquesta data
 * @returns {Array<{id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents}>}
 */
async function getNewFilesRecursive(subfolder, sinceDate) {
  const drive = getDriveClient();
  const baseFolderId = await getSubfolderId(subfolder);
  const since = sinceDate.toISOString();

  // Buscar TOTS els fitxers (no carpetes) dins l'arbre, modificats des de sinceDate
  // Google Drive API permet buscar amb "in parents" però no recursivament,
  // així que busquem fitxers recents i comprovem que estiguin dins l'arbre.

  // Estratègia: obtenir totes les subcarpetes primer, després buscar fitxers en cadascuna
  const allFolderIds = [baseFolderId];

  async function collectSubfolders(parentId) {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const folder of res.data.files) {
      allFolderIds.push(folder.id);
      await collectSubfolders(folder.id);
    }
  }

  await collectSubfolders(baseFolderId);

  // Buscar fitxers nous en totes les carpetes
  const allFiles = [];
  for (const fid of allFolderIds) {
    const res = await drive.files.list({
      q: `'${fid}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and createdTime > '${since}'`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents)',
      orderBy: 'createdTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    allFiles.push(...res.data.files);
  }

  return allFiles;
}

/**
 * Obté info del quota de l'usuari/compte
 */
async function getStorageInfo() {
  const drive = getDriveClient();
  const res = await drive.about.get({ fields: 'storageQuota, user' });
  return {
    user: res.data.user?.emailAddress,
    limit: res.data.storageQuota?.limit,
    usage: res.data.storageQuota?.usage,
    usageInDrive: res.data.storageQuota?.usageInDrive,
  };
}

/**
 * Comprova que la connexió funciona
 */
async function testConnection() {
  try {
    const info = await getStorageInfo();
    return { connected: true, email: info.user };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

module.exports = {
  getDriveClient,
  findOrCreateFolder,
  ensureFolderStructure,
  getRootFolderId,
  getSubfolderId,
  getDateBasedFolderId,
  uploadFile,
  listFiles,
  getFileLink,
  downloadFile,
  moveFile,
  copyFile,
  findFolderByName,
  deleteFile,
  getNewFiles,
  getNewFilesRecursive,
  getStorageInfo,
  testConnection,
};
