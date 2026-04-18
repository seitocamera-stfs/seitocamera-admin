#!/usr/bin/env node
/**
 * LLISTAR TOTS ELS COMPTES DE ZOHO MAIL
 *
 * Usa l'API de Zoho per obtenir tots els Account IDs
 * de l'organització, per poder configurar el sync multi-compte.
 *
 * EXECUTAR: node scripts/zoho-list-accounts.js
 */
require('dotenv').config();

const https = require('https');

function zohoRequest(method, hostname, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method, headers: { ...extraHeaders } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Resposta no JSON: ${data.substring(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const data = await zohoRequest('POST', 'accounts.zoho.eu', '/oauth/v2/token', params.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (data.error) throw new Error(`OAuth error: ${data.error}`);
  return data.access_token;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  ZOHO MAIL — LLISTAR COMPTES');
  console.log('═══════════════════════════════════════════════\n');

  const token = await getAccessToken();
  console.log('✅ Token obtingut\n');

  // Mètode 1: Obtenir el compte actual
  const currentAccountId = process.env.ZOHO_ACCOUNT_ID;
  console.log(`Compte configurat al .env: ${currentAccountId}\n`);

  // Mètode 2: Llistar tots els comptes de l'organització
  // Zoho API: GET /api/accounts
  const accountsData = await zohoRequest('GET', 'mail.zoho.eu', '/api/accounts', null, {
    Authorization: `Zoho-oauthtoken ${token}`,
    Accept: 'application/json',
  });

  if (accountsData.data && Array.isArray(accountsData.data)) {
    console.log(`📋 Comptes trobats: ${accountsData.data.length}\n`);
    for (const acc of accountsData.data) {
      console.log(`  📧 ${acc.mailId || acc.emailAddress || acc.primaryEmailAddress || '?'}`);
      console.log(`     Account ID: ${acc.accountId}`);
      console.log(`     Nom: ${acc.displayName || acc.accountName || '?'}`);
      console.log(`     Tipus: ${acc.type || '?'}`);
      console.log(`     Estat: ${acc.accountStatus || acc.status || '?'}`);
      console.log('');
    }

    // Generar la config per .env
    console.log('═══════════════════════════════════════════════');
    console.log('  CONFIGURACIÓ PER AL .env:');
    console.log('═══════════════════════════════════════════════\n');
    console.log('# Zoho Mail — Comptes a escanejar (separats per coma)');
    const ids = accountsData.data.map((a) => a.accountId).join(',');
    console.log(`ZOHO_ACCOUNT_IDS=${ids}`);
    console.log('');
    for (const acc of accountsData.data) {
      const email = acc.mailId || acc.emailAddress || acc.primaryEmailAddress || '?';
      console.log(`# ${email} → ${acc.accountId}`);
    }
  } else {
    console.log('⚠️  No s\'han pogut obtenir comptes. Resposta:');
    console.log(JSON.stringify(accountsData, null, 2));

    // Intentar amb el compte actual per veure les carpetes
    console.log('\n📁 Intentant llistar carpetes del compte actual...');
    const foldersData = await zohoRequest('GET', 'mail.zoho.eu', `/api/accounts/${currentAccountId}/folders`, null, {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: 'application/json',
    });
    if (foldersData.data) {
      console.log(`Carpetes trobades: ${foldersData.data.length}`);
      for (const f of foldersData.data) {
        console.log(`  📁 ${f.path || f.folderName} (ID: ${f.folderId})`);
      }
    }
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
