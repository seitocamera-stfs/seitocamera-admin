/**
 * Script per inspeccionar tots els camps que retorna l'API de Rentman per un projecte.
 * Ús: node scripts/inspectRentmanProject.js
 */
require('dotenv').config();
const rentman = require('../src/services/rentmanService');

async function main() {
  try {
    // Agafar els primers 3 projectes actius
    const projects = await rentman.getProjects({ limit: 3 });
    const arr = Array.isArray(projects) ? projects : [];

    if (arr.length === 0) {
      console.log('No s\'han trobat projectes');
      return;
    }

    for (const p of arr) {
      console.log('\n' + '='.repeat(60));
      console.log(`PROJECTE: ${p.displayname || p.name} (ID: ${p.id})`);
      console.log('='.repeat(60));

      // Mostrar TOTS els camps
      const keys = Object.keys(p).sort();
      for (const key of keys) {
        const val = p[key];
        if (val !== null && val !== '' && val !== undefined) {
          console.log(`  ${key}: ${JSON.stringify(val)}`);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
