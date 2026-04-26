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
  sector: process.env.COMPANY_SECTOR || "lloguer d'equips audiovisuals i fotografia",
  city: process.env.COMPANY_CITY || 'Barcelona',
  bankName: process.env.COMPANY_BANK_NAME || 'SEITO CAMERA',
  appName: process.env.COMPANY_APP_NAME || `${process.env.COMPANY_NAME || 'SeitoCamera'} Admin`,
};

module.exports = company;
