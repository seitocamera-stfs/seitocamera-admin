#!/usr/bin/env node
/**
 * Script per configurar OAuth2 de Google Drive.
 *
 * PREREQUISITS:
 * 1. Ves a Google Cloud Console: https://console.cloud.google.com/apis/credentials
 *    (projecte: seitocamera-admin)
 * 2. Crea credencials → OAuth 2.0 Client ID → Desktop App
 * 3. Copia el Client ID i Client Secret
 *
 * ÚS:
 *   node scripts/setup-gdrive-oauth.js
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  console.log('=== Configuració OAuth2 Google Drive ===\n');

  const clientId = await ask('Client ID: ');
  const clientSecret = await ask('Client Secret: ');

  if (!clientId || !clientSecret) {
    console.log('Error: Cal proporcionar Client ID i Client Secret');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId.trim(), clientSecret.trim(), REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n--- PAS 1: Autoritza l\'aplicació ---');
  console.log('Obre aquest URL al navegador:\n');
  console.log(authUrl);
  console.log('\nEsperant autorització...\n');

  // Servidor local temporal per capturar el callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === '/callback' && parsed.query.code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Autorització completada!</h1><p>Pots tancar aquesta pestanya.</p>');
        server.close();
        resolve(parsed.query.code);
      } else if (parsed.query.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Error</h1><p>${parsed.query.error}</p>`);
        server.close();
        reject(new Error(parsed.query.error));
      }
    });
    server.listen(PORT, () => {
      console.log(`Servidor escoltant a http://localhost:${PORT}/callback`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error: port ${PORT} ja en ús. Tanca el procés que l'usa o canvia PORT.`);
      }
      reject(err);
    });
  });

  try {
    const { tokens } = await oauth2.getToken(code);

    console.log('\n--- PAS 2: Afegeix al .env ---');
    console.log('Afegeix aquestes línies al fitxer backend/.env:\n');
    console.log(`GOOGLE_CLIENT_ID=${clientId.trim()}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret.trim()}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log();
    console.log('I COMENTA o ELIMINA la línia:');
    console.log('  # GOOGLE_SERVICE_ACCOUNT_KEY=./google-service-account.json');
    console.log();

    // Test ràpid
    oauth2.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2 });
    const about = await drive.about.get({ fields: 'user, storageQuota' });
    console.log('--- Verificació ---');
    console.log(`Connectat com: ${about.data.user?.emailAddress}`);
    const usage = about.data.storageQuota?.usage;
    const limit = about.data.storageQuota?.limit;
    if (usage && limit) {
      console.log(`Quota: ${(usage / 1e9).toFixed(2)} GB / ${(limit / 1e9).toFixed(0)} GB`);
    }
    console.log('\nTot correcte! Reinicia el backend per aplicar els canvis.');

  } catch (err) {
    console.error('\nError obtenint tokens:', err.message);
  }

  rl.close();
}

main();
