/**
 * Configuració d'empresa — centralitza totes les dades de l'empresa
 * per evitar hardcodes escampats pel codi.
 *
 * Llegeix de variables d'entorn amb fallbacks per compatibilitat.
 */

const company = {
  name: process.env.COMPANY_NAME || 'Seito Camera',
  legalName: process.env.COMPANY_LEGAL_NAME || 'Seito Camera S.L.',
  nif: process.env.COMPANY_NIF || 'B09805995',
  // NIFs alternatius (empreses anteriors, filials) separats per comes
  altNifs: process.env.COMPANY_ALT_NIFS ? process.env.COMPANY_ALT_NIFS.split(',').map(n => n.trim()) : [],
  // Noms alternatius (anteriors o variants) — per reconèixer factures adreçades a nosaltres
  altNames: process.env.COMPANY_ALT_NAMES
    ? process.env.COMPANY_ALT_NAMES.split(',').map(n => n.trim())
    : ['Seitofilms', 'Seito Films', 'Seito Films S.L.'],
  sector: process.env.COMPANY_SECTOR || "lloguer d'equips audiovisuals i fotografia",
  city: process.env.COMPANY_CITY || 'Barcelona',
  bankName: process.env.COMPANY_BANK_NAME || 'SEITO CAMERA',
  appName: process.env.COMPANY_APP_NAME || `${process.env.COMPANY_NAME || 'SeitoCamera'} Admin`,
};

// Helper: tots els NIFs propis (principal + alternatius)
company.allNifs = [company.nif, ...company.altNifs].filter(Boolean);
// Helper: tots els noms propis (per excloure com a proveïdor)
company.allNames = [
  company.name,
  company.legalName,
  company.name.replace(/\s+/g, ''),  // "SeitoCamera"
  ...company.altNames,
].filter(Boolean);

module.exports = company;
