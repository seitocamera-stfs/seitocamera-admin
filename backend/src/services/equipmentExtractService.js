/**
 * SERVEI D'EXTRACCIÓ D'EQUIPS DES DE FACTURES PDF
 *
 * Utilitza l'API d'OpenAI (ChatGPT) per analitzar el contingut de factures i extreure:
 *   - Nom del producte/model (càmeres, objectius, accessoris, etc.)
 *   - Número de sèrie (S/N)
 *   - Marca i model específic
 *   - Categoria d'equip
 *
 * S'activa quan:
 *   1. Import > 5000€
 *   2. Proveïdor és un dels configurats (Videocineimport, Cattscamera, Moncada y Lorenzo...)
 *   3. Manualment per l'usuari
 */

const { logger } = require('../config/logger');
const { prisma } = require('../config/database');

// ===========================================
// Configuració
// ===========================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MIN_AMOUNT_AUTO = parseFloat(process.env.EQUIPMENT_MIN_AMOUNT || '5000');

// Proveïdors que sempre activen l'extracció (case-insensitive, parcial)
const EQUIPMENT_SUPPLIERS = (process.env.EQUIPMENT_SUPPLIERS || 'videocineimport,cattscamera,moncada y lorenzo,moncada lorenzo').split(',').map((s) => s.trim().toLowerCase());

const SYSTEM_PROMPT = `Ets un expert en equipament audiovisual i fotogràfic. Analitza el text d'una factura i extreu TOTS els equips, productes i articles que hi apareixen.

Per cada article, retorna:
- name: Nom complet del producte tal com apareix a la factura
- serialNumber: Número de sèrie (S/N, Serial, Ref.) si apareix. null si no.
- brand: Marca (Sony, Canon, Arri, Blackmagic, DJI, Godox, Aputure, Tilta, SmallRig, Rode, Sennheiser, Zoom, etc.)
- model: Model específic (FX6, R5, Alexa Mini LF, etc.)
- category: Una de: "camera", "lens", "lighting", "audio", "monitor", "tripod", "stabilizer", "storage", "accessory", "cable", "power", "case", "other"
- unitPrice: Preu unitari si apareix (número, sense IVA si possible). null si no es pot determinar.
- quantity: Quantitat (per defecte 1)

IMPORTANT:
- Extreu CADA línia de producte, inclús si no té número de sèrie
- Si un producte apareix amb quantitat > 1, crea UNA entrada amb quantity > 1
- No incloguis serveis (transport, assegurança, mà d'obra) ni impostos
- Si no pots identificar la marca, deixa-la com el primer mot del nom
- Números de sèrie poden aparèixer com: S/N, SN, Serial, Ref, NS, N/S
- De vegades el número de sèrie apareix a una línia separada sota el producte

Respon SEMPRE en JSON:
{
  "items": [
    {
      "name": "Sony PXW-FX6 Full Frame Cinema Camera",
      "serialNumber": "1234567",
      "brand": "Sony",
      "model": "PXW-FX6",
      "category": "camera",
      "unitPrice": 5499.00,
      "quantity": 1
    }
  ]
}

Si no trobes cap equip a la factura, respon: { "items": [] }`;

// ===========================================
// Funcions auxiliars
// ===========================================

/**
 * Crida a l'API de Claude
 */
async function callLLM(text) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no configurada. Afegeix-la al fitxer .env');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * Comprova si una factura hauria de tenir extracció d'equips
 */
function shouldExtractEquipment(invoice, supplierName) {
  // 1. Import > llindar
  if (parseFloat(invoice.totalAmount) >= MIN_AMOUNT_AUTO) return true;

  // 2. Proveïdor a la llista
  if (supplierName) {
    const name = supplierName.toLowerCase();
    if (EQUIPMENT_SUPPLIERS.some((s) => name.includes(s))) return true;
  }

  return false;
}

/**
 * Obté el text OCR d'una factura (de la BD o re-extraient del PDF)
 */
async function getInvoiceText(invoice) {
  // Primer intentar amb ocrRawData
  if (invoice.ocrRawData?.text) {
    return invoice.ocrRawData.text;
  }

  // Si té PDF a GDrive, descarregar i extreure
  if (invoice.gdriveFileId) {
    try {
      const gdrive = require('./gdriveService');
      const pdfExtract = require('./pdfExtractService');
      const path = require('path');
      const fs = require('fs');
      const os = require('os');

      const tmpPath = path.join(os.tmpdir(), `equip-${invoice.id}.pdf`);
      await gdrive.downloadFile(invoice.gdriveFileId, tmpPath);
      const analysis = await pdfExtract.analyzePdf(tmpPath);
      try { fs.unlinkSync(tmpPath); } catch {}
      return analysis.text || null;
    } catch (err) {
      logger.warn(`Equipment: no s'ha pogut descarregar PDF per factura ${invoice.id}: ${err.message}`);
      return null;
    }
  }

  return null;
}

// ===========================================
// Funcions principals
// ===========================================

/**
 * Extreu equips d'una factura
 * @param {string} invoiceId - ID de la factura
 * @param {Object} options - { force: boolean } - si true, re-extreu encara que ja s'hagi fet
 * @returns {Object} { items: Equipment[], skipped: boolean }
 */
async function extractEquipmentFromInvoice(invoiceId, options = {}) {
  const invoice = await prisma.receivedInvoice.findUnique({
    where: { id: invoiceId },
    include: { supplier: { select: { id: true, name: true } } },
  });

  if (!invoice) throw new Error(`Factura ${invoiceId} no trobada`);

  // Si ja s'ha extret i no forcem, saltar
  if (invoice.equipmentExtracted && !options.force) {
    return { items: [], skipped: true, reason: 'already_extracted' };
  }

  // Obtenir text
  const text = await getInvoiceText(invoice);
  if (!text || text.length < 20) {
    logger.warn(`Equipment: factura ${invoice.invoiceNumber} sense text suficient`);
    // Marcar com a intentat
    await prisma.receivedInvoice.update({
      where: { id: invoiceId },
      data: { equipmentExtracted: true },
    });
    return { items: [], skipped: true, reason: 'no_text' };
  }

  // Construir prompt amb context
  const prompt = `FACTURA:
- Número: ${invoice.invoiceNumber}
- Proveïdor: ${invoice.supplier?.name || 'Desconegut'}
- Data: ${invoice.issueDate?.toISOString().split('T')[0]}
- Import total: ${invoice.totalAmount}€
- Fitxer: ${invoice.originalFileName || 'Desconegut'}

TEXT DE LA FACTURA:
${text.substring(0, 8000)}`;

  // Cridar Claude
  const response = await callLLM(prompt);

  // Parsejar resposta
  let items = [];
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      items = result.items || [];
    }
  } catch (err) {
    logger.error(`Equipment: error parsejant resposta per ${invoice.invoiceNumber}: ${err.message}`);
    throw new Error(`Error interpretant l'extracció: ${response.substring(0, 200)}`);
  }

  // Guardar equips a la BD
  const created = [];
  for (const item of items) {
    // Per cada quantitat, crear registres individuals (cada equip físic és únic)
    const qty = item.quantity || 1;
    for (let i = 0; i < qty; i++) {
      const equipment = await prisma.equipment.create({
        data: {
          name: item.name,
          serialNumber: item.serialNumber || null,
          brand: item.brand || null,
          model: item.model || null,
          category: item.category || 'other',
          purchasePrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
          purchaseDate: invoice.issueDate,
          receivedInvoiceId: invoiceId,
          supplierId: invoice.supplierId || null,
          extractedBy: options.manual ? 'AGENT_MANUAL' : 'AGENT_AUTO',
          rawExtractedData: item,
        },
      });
      created.push(equipment);
    }
  }

  // Auto-agrupar si hi ha >1 equip: el més car és el pare, la resta fills
  if (created.length > 1) {
    const sorted = [...created].sort((a, b) => {
      const pa = parseFloat(a.purchasePrice || 0);
      const pb = parseFloat(b.purchasePrice || 0);
      return pb - pa; // El més car primer
    });
    const parentId = sorted[0].id;
    const childIds = sorted.slice(1).map((c) => c.id);

    await prisma.equipment.updateMany({
      where: { id: { in: childIds } },
      data: { parentId },
    });

    logger.info(`Equipment: auto-agrupats ${childIds.length} subitems sota "${sorted[0].name}" (factura ${invoice.invoiceNumber})`);
  }

  // Marcar factura com a extreta
  await prisma.receivedInvoice.update({
    where: { id: invoiceId },
    data: { equipmentExtracted: true },
  });

  logger.info(`Equipment: ${created.length} equips extrets de factura ${invoice.invoiceNumber}`);

  return { items: created, skipped: false };
}

/**
 * Processa automàticament les factures que compleixen els criteris
 * Cridat des del sync de GDrive o manualment
 */
async function processNewInvoices() {
  // Buscar factures no processades que compleixin criteris
  const candidates = await prisma.receivedInvoice.findMany({
    where: {
      equipmentExtracted: false,
      status: { notIn: ['REJECTED'] },
      OR: [
        { totalAmount: { gte: MIN_AMOUNT_AUTO } },
        // Proveïdors específics: ho filtrem després en memòria
      ],
    },
    include: {
      supplier: { select: { id: true, name: true } },
    },
    take: 10, // Limitar per no saturar l'API
  });

  // Filtrar per proveïdor també
  const toProcess = candidates.filter((inv) =>
    shouldExtractEquipment(inv, inv.supplier?.name)
  );

  const results = [];
  for (const inv of toProcess) {
    try {
      const result = await extractEquipmentFromInvoice(inv.id);
      results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, ...result });
      // Pausa entre crides API
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      logger.error(`Equipment: error processant ${inv.invoiceNumber}: ${err.message}`);
      results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, error: err.message });
    }
  }

  return results;
}

module.exports = {
  extractEquipmentFromInvoice,
  processNewInvoices,
  shouldExtractEquipment,
  EQUIPMENT_SUPPLIERS,
  MIN_AMOUNT_AUTO,
};
