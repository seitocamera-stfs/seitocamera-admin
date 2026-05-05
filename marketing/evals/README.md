# Eval datasets — Seito Camera

Ground truth per validar l'AI Marketing Agency sobre el cas Seito Camera.

## Fitxers

- `golden_competitors/seito_camera.json` — 5 competidors que l'**Investigator** ha de trobar
- `golden_leads/seito_camera.json` — 11 productores que el **Lead Hunter** ha de trobar

## Com enriquir els camps `TO_FILL`

Per cada empresa:

1. **`website`**: obrir la seva pàgina i posar l'URL exacta (amb `https://`).
2. **`notes_for_evaluator` / `why_ideal`**: 1-2 frases concretes. Per què és competidor fort / per què seria client ideal. Exemples:
   - Bon: "Tenen stock propi d'ARRI Alexa Mini LF i preus publicats entre 180-220€/dia, apunten a ad agencies"
   - Dolent: "És un bon competidor"
3. **`known_contacts_pattern`**: quin format d'email prefereixen (`info@`, `hola@`, `booking@`...). Si no el saps sense haver-hi parlat, deixa `null`.
4. **`verified_at`**: data en què has comprovat que la web està viva (format `2026-04-21`).

## Criteris d'avaluació

**Investigator (competidors):**
- Pass: recall ≥ 0.6 (troba ≥3 dels 5)
- Strong pass: recall ≥ 0.8 (troba ≥4 dels 5)
- Matches per aliases estan permesos

**Lead Hunter (productores):**
- Pass: ≥4 de les 11 a la llista final
- Strong pass: ≥8 de les 11
- Matches per aliases estan permesos (ex: "Altipla Films" vs "Altiplà Films", "La Diferència" vs "La Diferencia")

## Quan ampliar

El conjunt de leads (11) ja és suficient per Fase 1. Els competidors (5) caldria ampliar a ~10 abans de Fase 2 (MVP). La idea és fer-ho progressivament: cada vegada que un run reveli una empresa rellevant que no estava a la llista, afegir-la.
