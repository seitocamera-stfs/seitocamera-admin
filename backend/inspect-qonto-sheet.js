require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

const SHEET_ID = '1mFFXYlH1hwyJ-dHg9o7Sf6hnsVdbamPEeFUQ2RTGNBw';

(async () => {
  // Autenticar amb service account
  let auth;
  try {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    let credentials;
    if (keyFile && fs.existsSync(keyFile)) {
      credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    } else if (keyFile) {
      credentials = JSON.parse(keyFile);
    }
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  } catch (e) {
    console.error('Error auth:', e.message);
    process.exit(1);
  }

  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Llistar fulls del document
  console.log('=== FULLS DEL DOCUMENT ===');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  for (const s of meta.data.sheets) {
    console.log(`  - "${s.properties.title}" (${s.properties.gridProperties.rowCount} files x ${s.properties.gridProperties.columnCount} columnes)`);
  }

  // 2. Llegir les primeres files del primer full
  const sheetName = meta.data.sheets[0].properties.title;
  console.log(`\n=== CAPÇALERA + 5 PRIMERES FILES de "${sheetName}" ===`);

  const range = `'${sheetName}'!A1:Z6`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });

  const rows = res.data.values || [];
  if (rows.length > 0) {
    console.log('\nCOLUMNES:', rows[0].join(' | '));
    console.log('---');
    for (let i = 1; i < rows.length; i++) {
      // Mostrar cada camp amb el nom de la columna
      const obj = {};
      for (let j = 0; j < rows[0].length; j++) {
        obj[rows[0][j]] = rows[i][j] || '';
      }
      console.log(`\nFila ${i}:`, JSON.stringify(obj, null, 2));
    }
  }

  // 3. Comptar files totals
  const countRange = `'${sheetName}'!A:A`;
  const countRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: countRange,
  });
  console.log(`\n=== TOTAL FILES: ${(countRes.data.values || []).length - 1} transaccions ===`);

  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
