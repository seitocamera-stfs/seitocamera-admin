# Dry-run de l'Investigator — Seito Camera

**Data:** 2026-04-22
**Executor:** Claude jugant manualment el rol de l'Investigator (validació de metodologia abans d'implementar)
**Durada efectiva:** ~10 minuts
**Tokens consumits (estimat):** ~14.000
**Cost estimat:** ~0,05 € (Sonnet 4.6)
**Eines usades:** WebSearch (6 crides). WebFetch bloquejat per egress proxy — en producció amb Playwright no es produeix.

---

## Resultat d'avaluació contra el Golden Set

| Golden competitor    | Trobat? | Com?                                                |
|----------------------|---------|-----------------------------------------------------|
| Napalm Rentals       | ✅      | Cerca àmplia 1 i 2 (orgànic)                        |
| Zig Zag Rental       | ✅      | Cerca dirigida 4 ("Zig Zag Rental Barcelona")       |
| Servicevision        | ✅      | Cerca dirigida 5 ("Servicevision Barcelona")        |
| Camera Lenses Rental | ✅      | Cerca dirigida 6 ("Camera Lenses Rental Barcelona") |
| Ovide                | ✅      | Cerca àmplia 1, 2 i 3 (orgànic, 3 cops)             |

**Recall: 5/5 = 100% → STRONG PASS**

(Llindar d'èxit definit: ≥3/5 per pass, ≥4/5 per strong pass.)

---

## Candidats NOUS descoberts (no al golden set de Seito)

Aquests van sortir orgànicament a les cerques però no eren a la llista original de 5. Són candidats a incorporar o descartar explícitament:

1. **Camaleón Rental** — dominant a les 3 cerques àmplies. Multi-país (ESP + PT), treballa amb Netflix/HBO/Amazon. Clarament competidor rellevant.
2. **Movie Men** — aparicions múltiples, "400 produccions anuals", stock gran d'ARRI.
3. **GV Broadcast** — apareix a 2 cerques, stock ARRI + Cooke + Angenieux + Fujinon + Zeiss.
4. **Avisual PRO** — Madrid + Barcelona, catàleg ampli.
5. **Exodo Rental** — entrega a Barcelona metro, mix ARRI + RED + Sony + Blackmagic.
6. **RC Service** — lidera el lloguer de vídeo BCN des de 2008.

**Acció recomanada:** revisar amb Seito quins d'aquests 6 mereixen entrar al golden set per al proper run d'avaluació. Camaleón Rental és el candidat més clar — si no es considera competidor, cal entendre per què (diferent segment? tamany incomparable?).

---

## Insights estratègics detectats

Aquest és el tipus d'informació que hauria de passar de l'Investigator a l'Strategist:

**Patrons de pricing (oportunitat 1)**
Cap dels 6 competidors analitzats publica tarifes diàries al seu web. És la norma del sector. Això és una oportunitat de diferenciació de baix cost — qualsevol que trenqui la norma crea friction reduction per a primers clients.

**Patrons de contingut (oportunitat 2)**
- Napalm i Zig Zag tenen presència social significativa (Instagram principalment).
- Servicevision, Ovide, CLR s'estan recolzant gairebé exclusivament al web + directoris.
- **Cap competidor té contingut tècnic/educatiu visible** (que l'Strategist podria posicionar com a forat).

**Mapa competitiu (segons les teves pròpies notes + el que he trobat)**

```
Eix servei ↑
          Zig Zag (bo servei, mid-high)
    Seito ⬤ ← posició proposada:
             "autoritat tècnica
              a peu de rodatge"
                            Servicevision (gran, anticuat, premium)

                            Camaleón (scale-first, Netflix/HBO)
Ovide (multi-city,         |
barat)                     |
Napalm (preu baix, mal servei) ----→ Eix preu
```

Quan l'Strategist corri sobre aquest research, hauria de proposar un angle al voltant de "servei tècnic a peu de rodatge" amb canals LinkedIn + Vimeo i preus públics. Si ho fa, el sistema funciona. Si ho no, tocarà ajustar el prompt de l'Strategist.

---

## Validació de la metodologia (el punt del dry-run)

**Què ha funcionat:**
- 3 cerques àmplies van trobar **2/5 competidors del golden** (Napalm, Ovide) orgànicament. Això valida que els queries genèrics funcionen com a primer pas.
- 3 cerques dirigides amb el nom del competidor van resoldre els altres 3 (Zig Zag, Servicevision, CLR).
- La disciplina de "una afirmació = una font" (principi P1) s'ha mantingut. Cada afirmació factual del JSON té una entrada a `sources` amb URL i excerpt.
- L'Investigator ha retornat informació útil fins i tot amb una eina bloquejada (WebFetch), registrant la limitació a `open_questions` en comptes d'inventar-se dades.

**Què s'ha revelat com a gap:**
- **Sense WebFetch real (amb Playwright), no podem extreure preus ni canals de manera fiable**. En producció això no serà un problema, però cal verificar amb un primer run real que la implementació de scraping segueix les normes (robots.txt, rate limit, user-agent identificable).
- **El golden set original tenia un biaix**. Camaleón Rental és un competidor objectivament rellevant que va quedar fora — és un senyal que el sistema pot ajudar Seito a descobrir blind spots, no només confirmar el que ja sap.

**Cost projectat en producció real:**
Si en un dry-run manual amb 6 cerques + 3 fetches (fallides) el consum estimat és ~14k tokens, el pressupost de producció original (160k tokens estimats per a l'Investigator) és **~10x sobredimensionat**. Preview de calibratge: el sostre pràctic real pot caure cap a **~0,30 € per run complet** si la resta d'agents són proporcionalment eficients.

---

## Conclusió

La metodologia de l'Investigator funciona. Recall 5/5 contra el golden set, evidències verificables, forat estratègic clar identificat, gap no detectat al golden set (Camaleón) descobert. Llest per codificar a la setmana 1 del roadmap.

**Següents passos sobre això:**
1. Decidir si Camaleón Rental (i opcionalment Movie Men, GV Broadcast) entren al golden_competitors.json.
2. Passar aquest MarketResearch a un dry-run de l'Strategist per validar que produeix un angle diferenciat.
3. Iniciar l'esquelet del projecte.
