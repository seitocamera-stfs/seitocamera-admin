#!/usr/bin/env node
/**
 * Vincula Transports antics (amb camp `projecte` text però sense
 * `rentalProjectId`) als seus RentalProject corresponents fent match per nom.
 *
 * Match: case-insensitive, primer exacte i després "contains" si és únic.
 *
 * Flags:
 *   --dry-run    No escriu res, només llista què faria.
 *
 * Executar: node scripts/linkTransportsToProjects.js [--dry-run]
 */
require('dotenv').config();
const { prisma } = require('../src/config/database');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`\n=== Vinculació Transports → RentalProjects ${DRY_RUN ? '(DRY-RUN)' : ''} ===\n`);

  const candidates = await prisma.transport.findMany({
    where: { rentalProjectId: null, projecte: { not: null } },
    select: { id: true, projecte: true },
  });
  console.log(`Transports candidats (sense vincle): ${candidates.length}`);

  const projects = await prisma.rentalProject.findMany({
    select: { id: true, name: true },
  });
  console.log(`Projectes Rentman al sistema: ${projects.length}\n`);

  const norm = (s) => String(s || '').trim().toLowerCase();
  const byName = new Map();
  for (const p of projects) byName.set(norm(p.name), p);

  let exactMatches = 0;
  let containsMatches = 0;
  let ambiguous = 0;
  let noMatch = 0;

  for (const t of candidates) {
    const tName = norm(t.projecte);
    if (!tName) { noMatch++; continue; }

    let matched = byName.get(tName);
    let kind = 'exact';
    if (!matched) {
      // Intent contains: l'únic projecte amb el nom contingut
      const containsList = projects.filter((p) => norm(p.name).includes(tName) || tName.includes(norm(p.name)));
      if (containsList.length === 1) {
        matched = containsList[0];
        kind = 'contains';
      } else if (containsList.length > 1) {
        ambiguous++;
        continue;
      }
    }
    if (!matched) { noMatch++; continue; }

    if (kind === 'exact') exactMatches++;
    else containsMatches++;

    if (!DRY_RUN) {
      await prisma.transport.update({
        where: { id: t.id },
        data: { rentalProjectId: matched.id },
      });
    }
  }

  console.log(`Resum:`);
  console.log(`  Match exacte:    ${exactMatches}`);
  console.log(`  Match per cont.: ${containsMatches}`);
  console.log(`  Ambigus:         ${ambiguous}  (cal vincular manualment)`);
  console.log(`  Sense match:     ${noMatch}    (cal vincular manualment o crear projecte)\n`);
  if (DRY_RUN) console.log('(DRY-RUN: cap canvi escrit)\n');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
