const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { logger } = require('../config/logger');

// ===========================================
// Servei d'exportació: CSV, Excel, PDF
// ===========================================

/**
 * Genera un CSV a partir de files i columnes
 * @param {Array<Object>} rows - Dades
 * @param {Array<{key, label}>} columns - Definició de columnes
 * @returns {string} CSV string
 */
function generateCsv(rows, columns) {
  const separator = ';'; // Punt i coma per compatibilitat amb Excel en català/espanyol
  const header = columns.map(c => `"${c.label}"`).join(separator);
  const lines = rows.map(row =>
    columns.map(c => {
      let val = row[c.key];
      if (val === null || val === undefined) val = '';
      if (val instanceof Date) val = formatDate(val);
      if (typeof val === 'number') val = val.toString().replace('.', ','); // Format europeu
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(separator)
  );
  // BOM UTF-8 per Excel
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

/**
 * Genera un Excel (.xlsx) a partir de files i columnes
 * @param {Array<Object>} rows - Dades
 * @param {Array<{key, label, width?, type?}>} columns - Definició de columnes
 * @param {string} sheetName - Nom del full
 * @returns {Promise<Buffer>} Buffer del fitxer Excel
 */
async function generateExcel(rows, columns, sheetName = 'Dades') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SeitoCamera Admin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);

  // Definir columnes
  sheet.columns = columns.map(c => ({
    header: c.label,
    key: c.key,
    width: c.width || 18,
  }));

  // Estil capçalera
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 24;

  // Afegir files
  for (const row of rows) {
    const values = {};
    for (const c of columns) {
      let val = row[c.key];
      if (val instanceof Date) val = formatDate(val);
      values[c.key] = val ?? '';
    }
    const excelRow = sheet.addRow(values);

    // Format moneda
    for (const c of columns) {
      if (c.type === 'currency') {
        const cell = excelRow.getCell(c.key);
        cell.numFmt = '#,##0.00 €';
      }
    }
  }

  // Auto-filtre
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length },
    };
  }

  // Bordes
  sheet.eachRow((row, rowNum) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });

  return workbook.xlsx.writeBuffer();
}

/**
 * Genera un PDF amb una taula de dades
 * @param {Array<Object>} rows - Dades
 * @param {Array<{key, label, width?}>} columns - Definició de columnes
 * @param {string} title - Títol del document
 * @param {Object} options - Opcions addicionals
 * @returns {Promise<Buffer>} Buffer del fitxer PDF
 */
async function generatePdf(rows, columns, title, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 40, bottom: 40, left: 30, right: 30 },
        info: {
          Title: title,
          Author: 'SeitoCamera Admin',
          Creator: 'SeitoCamera Admin',
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Títol
      doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown(0.3);

      // Subtítol amb data i filtres
      const now = new Date();
      let subtitle = `Generat: ${formatDate(now)} ${now.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' })}`;
      if (options.filterDescription) subtitle += ` | ${options.filterDescription}`;
      subtitle += ` | ${rows.length} registres`;
      doc.fontSize(8).font('Helvetica').fillColor('#666666').text(subtitle, { align: 'center' });
      doc.moveDown(0.5);
      doc.fillColor('#000000');

      // Calcular amplades de columnes
      const totalWeight = columns.reduce((sum, c) => sum + (c.pdfWidth || 1), 0);
      const colWidths = columns.map(c => ((c.pdfWidth || 1) / totalWeight) * pageWidth);

      // Dibuixar taula
      const startX = doc.page.margins.left;
      let y = doc.y;
      const rowHeight = 18;
      const headerHeight = 22;
      const fontSize = 7;
      const headerFontSize = 7.5;

      // Funció per dibuixar capçalera
      function drawHeader() {
        // Fons capçalera
        doc.rect(startX, y, pageWidth, headerHeight).fill('#1F2937');

        let x = startX;
        doc.font('Helvetica-Bold').fontSize(headerFontSize).fillColor('#FFFFFF');
        for (let i = 0; i < columns.length; i++) {
          doc.text(columns[i].label, x + 3, y + 5, { width: colWidths[i] - 6, height: headerHeight, ellipsis: true });
          x += colWidths[i];
        }
        y += headerHeight;
        doc.fillColor('#000000');
      }

      drawHeader();

      // Files de dades
      doc.font('Helvetica').fontSize(fontSize);
      for (let r = 0; r < rows.length; r++) {
        // Nova pàgina si no hi cap
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = doc.page.margins.top;
          drawHeader();
        }

        // Fons alternat
        if (r % 2 === 0) {
          doc.rect(startX, y, pageWidth, rowHeight).fill('#F9FAFB');
          doc.fillColor('#000000');
        }

        let x = startX;
        for (let i = 0; i < columns.length; i++) {
          let val = rows[r][columns[i].key];
          if (val === null || val === undefined) val = '';
          if (val instanceof Date) val = formatDate(val);
          if (typeof val === 'number' && columns[i].type === 'currency') {
            val = formatCurrency(val);
          }
          doc.text(String(val), x + 3, y + 5, { width: colWidths[i] - 6, height: rowHeight, ellipsis: true });
          x += colWidths[i];
        }

        // Línia separadora
        doc.moveTo(startX, y + rowHeight).lineTo(startX + pageWidth, y + rowHeight).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

        y += rowHeight;
      }

      // Peu de pàgina amb totals si hi ha columnes de moneda
      const currencyCols = columns.filter(c => c.type === 'currency');
      if (currencyCols.length > 0 && rows.length > 0) {
        y += 5;
        if (y + 25 > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = doc.page.margins.top;
        }

        doc.rect(startX, y, pageWidth, 22).fill('#F3F4F6');
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);

        let x = startX;
        for (let i = 0; i < columns.length; i++) {
          if (columns[i].type === 'currency') {
            const total = rows.reduce((sum, row) => sum + (parseFloat(row[columns[i].key]) || 0), 0);
            doc.text(`Total: ${formatCurrency(total)}`, x + 3, y + 6, { width: colWidths[i] - 6 });
          } else if (i === 0) {
            doc.text('TOTALS', x + 3, y + 6, { width: colWidths[i] - 6 });
          }
          x += colWidths[i];
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ===========================================
// Helpers
// ===========================================

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '0,00 €';
  return parseFloat(amount).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ===========================================
// Definicions de columnes per cada entitat
// ===========================================

const COLUMN_DEFS = {
  receivedInvoices: [
    { key: 'invoiceNumber', label: 'Número', pdfWidth: 1.5, width: 20 },
    { key: 'supplierName', label: 'Proveïdor', pdfWidth: 2, width: 25 },
    { key: 'issueDate', label: 'Data', pdfWidth: 1, width: 14 },
    { key: 'totalAmount', label: 'Import', type: 'currency', pdfWidth: 1.2, width: 14 },
    { key: 'taxRate', label: 'IVA %', pdfWidth: 0.7, width: 10 },
    { key: 'status', label: 'Estat', pdfWidth: 1, width: 14 },
    { key: 'source', label: 'Font', pdfWidth: 1, width: 14 },
    { key: 'conciliationStatus', label: 'Conciliació', pdfWidth: 1, width: 14 },
    { key: 'description', label: 'Descripció', pdfWidth: 2, width: 30 },
  ],

  issuedInvoices: [
    { key: 'invoiceNumber', label: 'Número', pdfWidth: 1.5, width: 20 },
    { key: 'clientName', label: 'Client', pdfWidth: 2, width: 25 },
    { key: 'issueDate', label: 'Data', pdfWidth: 1, width: 14 },
    { key: 'totalAmount', label: 'Import', type: 'currency', pdfWidth: 1.2, width: 14 },
    { key: 'taxRate', label: 'IVA %', pdfWidth: 0.7, width: 10 },
    { key: 'status', label: 'Estat', pdfWidth: 1, width: 14 },
    { key: 'description', label: 'Descripció', pdfWidth: 2, width: 30 },
  ],

  bankMovements: [
    { key: 'date', label: 'Data', pdfWidth: 1, width: 14 },
    { key: 'description', label: 'Descripció', pdfWidth: 3, width: 40 },
    { key: 'amount', label: 'Import', type: 'currency', pdfWidth: 1.2, width: 14 },
    { key: 'type', label: 'Tipus', pdfWidth: 1, width: 14 },
    { key: 'reference', label: 'Referència', pdfWidth: 1.5, width: 20 },
    { key: 'isConciliated', label: 'Conciliat', pdfWidth: 0.8, width: 12 },
  ],

  conciliations: [
    { key: 'movementDate', label: 'Data moviment', pdfWidth: 1, width: 14 },
    { key: 'movementDescription', label: 'Moviment', pdfWidth: 2, width: 30 },
    { key: 'movementAmount', label: 'Import moviment', type: 'currency', pdfWidth: 1.2, width: 16 },
    { key: 'invoiceNumber', label: 'Factura', pdfWidth: 1.5, width: 20 },
    { key: 'invoiceAmount', label: 'Import factura', type: 'currency', pdfWidth: 1.2, width: 16 },
    { key: 'entityName', label: 'Proveïdor/Client', pdfWidth: 1.5, width: 20 },
    { key: 'status', label: 'Estat', pdfWidth: 1, width: 14 },
    { key: 'confidence', label: 'Confiança', pdfWidth: 0.8, width: 12 },
  ],
};

// ===========================================
// Transformadors de dades per cada entitat
// ===========================================

const STATUS_LABELS = {
  PENDING: 'Pendent',
  REVIEWED: 'Revisat',
  APPROVED: 'Aprovat',
  REJECTED: 'Rebutjat',
  PAID: 'Pagat',
  PARTIALLY_PAID: 'Parc. pagat',
  PDF_PENDING: 'PDF pendent',
};

const SOURCE_LABELS = {
  MANUAL: 'Manual',
  EMAIL_WITH_PDF: 'Email+PDF',
  EMAIL_NO_PDF: 'Email',
  GDRIVE_SYNC: 'GDrive',
  BANK_DETECTED: 'Banc',
};

const CONCILIATION_LABELS = {
  AUTO_MATCHED: 'Auto',
  MANUAL_MATCHED: 'Manual',
  CONFIRMED: 'Confirmat',
  REJECTED: 'Rebutjat',
};

const TYPE_LABELS = {
  INCOME: 'Ingrés',
  EXPENSE: 'Despesa',
  TRANSFER: 'Transferència',
};

function transformReceivedInvoice(inv) {
  return {
    invoiceNumber: inv.invoiceNumber,
    supplierName: inv.supplier?.name || '',
    issueDate: inv.issueDate ? new Date(inv.issueDate) : null,
    totalAmount: parseFloat(inv.totalAmount) || 0,
    taxRate: parseFloat(inv.taxRate) || 0,
    status: STATUS_LABELS[inv.status] || inv.status,
    source: SOURCE_LABELS[inv.source] || inv.source,
    conciliationStatus: inv.conciliations?.some(c => c.status === 'CONFIRMED') ? 'Conciliat' : 'Pendent',
    description: inv.description || '',
  };
}

function transformIssuedInvoice(inv) {
  return {
    invoiceNumber: inv.invoiceNumber,
    clientName: inv.client?.name || '',
    issueDate: inv.issueDate ? new Date(inv.issueDate) : null,
    totalAmount: parseFloat(inv.totalAmount) || 0,
    taxRate: parseFloat(inv.taxRate) || 0,
    status: STATUS_LABELS[inv.status] || inv.status,
    description: inv.description || '',
  };
}

function transformBankMovement(mov) {
  return {
    date: mov.date ? new Date(mov.date) : null,
    description: mov.description || '',
    amount: parseFloat(mov.amount) || 0,
    type: TYPE_LABELS[mov.type] || mov.type,
    reference: mov.reference || '',
    isConciliated: mov.isConciliated ? 'Sí' : 'No',
  };
}

function transformConciliation(con) {
  return {
    movementDate: con.bankMovement?.date ? new Date(con.bankMovement.date) : null,
    movementDescription: con.bankMovement?.description || '',
    movementAmount: parseFloat(con.bankMovement?.amount) || 0,
    invoiceNumber: con.receivedInvoice?.invoiceNumber || con.issuedInvoice?.invoiceNumber || '',
    invoiceAmount: parseFloat(con.receivedInvoice?.totalAmount || con.issuedInvoice?.totalAmount) || 0,
    entityName: con.receivedInvoice?.supplier?.name || con.issuedInvoice?.client?.name || '',
    status: CONCILIATION_LABELS[con.status] || con.status,
    confidence: con.confidence ? `${Math.round(con.confidence * 100)}%` : '',
  };
}

module.exports = {
  generateCsv,
  generateExcel,
  generatePdf,
  COLUMN_DEFS,
  transformReceivedInvoice,
  transformIssuedInvoice,
  transformBankMovement,
  transformConciliation,
};
