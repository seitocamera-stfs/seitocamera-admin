require('dotenv').config();
const rentman = require('./src/services/rentmanService');

(async () => {
  try {
    // 1. Obtenir factures
    console.log('=== FACTURES RENTMAN (primeres 3) ===');
    const invoices = await rentman.getInvoices({ limit: 3 });
    const invList = Array.isArray(invoices) ? invoices : (invoices.data || []);

    for (const inv of invList.slice(0, 3)) {
      console.log('\n--- Factura ---');
      console.log(JSON.stringify(inv, null, 2));
    }

    // 2. Si hi ha factura amb detall
    if (invList.length > 0) {
      const firstId = invList[0].id;
      console.log('\n=== DETALL FACTURA', firstId, '===');
      try {
        const detail = await rentman.getInvoice(firstId);
        console.log(JSON.stringify(detail, null, 2));
      } catch (e) {
        console.log('Error detall:', e.message);
      }

      console.log('\n=== LÍNIES FACTURA', firstId, '===');
      try {
        const lines = await rentman.getInvoiceLines(firstId);
        console.log(JSON.stringify(lines, null, 2));
      } catch (e) {
        console.log('Error línies:', e.message);
      }
    }

    // 3. Contactes (primers 2)
    console.log('\n=== CONTACTES (primers 2) ===');
    const contacts = await rentman.getContacts({ limit: 2 });
    const conList = Array.isArray(contacts) ? contacts : (contacts.data || []);
    for (const c of conList.slice(0, 2)) {
      console.log('\n--- Contacte ---');
      console.log(JSON.stringify(c, null, 2));
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
