require('dotenv').config();
const gdrive = require('./src/services/gdriveService');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const drive = gdrive.getDriveClient();

  // Buscar fitxer Qonto a tot el Drive
  console.log('Buscant fitxers Qonto...');
  const res = await drive.files.list({
    q: "name contains 'Qonto' and trashed=false",
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, parents)',
    orderBy: 'modifiedTime desc',
  });

  const files = res.data.files || [];
  console.log(`Trobats: ${files.length} fitxers\n`);

  for (const f of files) {
    console.log(`Nom: ${f.name}`);
    console.log(`Tipus: ${f.mimeType}`);
    console.log(`Mida: ${f.size ? Math.round(f.size / 1024) + ' KB' : '-'}`);
    console.log(`Modificat: ${f.modifiedTime}`);
    console.log(`ID: ${f.id}`);
    console.log('---');
  }

  // Descarregar el primer fitxer no-carpeta per inspeccionar-lo
  const dataFile = files.find(f => f.mimeType !== 'application/vnd.google-apps.folder');
  if (dataFile) {
    const ext = dataFile.name.split('.').pop() || 'dat';
    const tmp = path.join(os.tmpdir(), `qonto_inspect.${ext}`);
    console.log(`\nDescarregant "${dataFile.name}" per inspeccionar...`);
    await gdrive.downloadFile(dataFile.id, tmp);
    console.log(`Guardat a: ${tmp}`);

    // Si és CSV o similar, mostrar primeres línies
    if (['csv', 'tsv', 'txt'].includes(ext.toLowerCase())) {
      const content = fs.readFileSync(tmp, 'utf-8');
      const lines = content.split('\n');
      console.log(`\n=== PRIMERES 10 LÍNIES (${lines.length} total) ===`);
      for (let i = 0; i < Math.min(10, lines.length); i++) {
        console.log(lines[i]);
      }
    } else if (ext.toLowerCase() === 'xlsx' || ext.toLowerCase() === 'xls') {
      console.log('Fitxer Excel detectat - cal obrir-lo amb una llibreria');
      // Mostrar mida
      const stats = fs.statSync(tmp);
      console.log(`Mida: ${stats.size} bytes`);
    }
  }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
