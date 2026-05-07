-- Pre-fill marketingContext de la primera Company amb les dades de
-- marketing/examples/seito_camera.json — sols si encara no està definit.
-- Si ja hi ha context (l'usuari l'ha editat des de /marketing/settings),
-- no es toca.

UPDATE companies
SET "marketingContext" = '{
  "description": "Lloguer de material audiovisual professional: càmeres ARRI (Alexa Mini, Mini LF), òptiques de cinema, material d''il·luminació i accessoris de producció. Forma part d''un hub audiovisual integrat a Sant Just (Barcelona) amb serveis complementaris paret amb paret: dos platós (un sinfin de 10m i una caixa negra de 280m²), taller de construcció de decorats, serveis de grua telescòpica i transport de producció. El client pot cobrir tots els serveis necessaris d''una producció en una sola localització amb una sola coordinació.",
  "vertical": "audiovisual equipment rental",
  "language": "ca",
  "target_customers": [
    "Productores audiovisuals (productoras) a Barcelona",
    "Productors executius / caps executius / CEOs de productores — prenen decisions estructurals de proveïdors",
    "Caps de producció / line producers freelance — molts es mouen entre productores, així que guanyar una relació individual es multiplica entre projectes. A Espanya/Catalunya la seva presència professional és tant a Instagram com a LinkedIn",
    "DPs (directors de fotografia) independents",
    "Agències de publicitat"
  ],
  "unique_strengths": [
    "One-stop shop real: Seito lloga càmeres, òptiques de cinema I il·luminació — més el hub de Sant Just amb dos platós adjacents (sinfin 10m + caixa negra 280m²), taller de construcció de decorats, grues telescòpiques i transport. El client pot cobrir tot un rodatge en una sola adreça amb una sola coordinació",
    "Inventari especialitzat ARRI (Alexa Mini, Mini LF) ben mantingut i revisat — risc reduït de fallades a mig rodatge",
    "Suport tècnic on-set hands-on — humans reals que coneixen l''equip, no només una taula de lloguer",
    "Assessoria liderada per DP: el CEO és director de fotografia en actiu, així que la guia tècnica ve d''algú que dispara, no d''un comercial",
    "Xarxa de tècnics qualificats (operadors, ACs, DITs) que ja coneixen l''inventari Seito — Seito pot recomanar el crew adient per al rodatge",
    "Flexibilitat comercial: tarifes diàries competitives, descomptes per volum significatius per a clients preferents, finestres de disponibilitat flexibles (no només 9-18h)",
    "Relació personal i boutique vs. l''actitud d''escala dels grans (Camaleón, Ovide, Servicevision)"
  ],
  "known_competitors": [
    "Napalm Rentals",
    "Zig Zag Rental",
    "Servicevision",
    "Camera Lenses Rental",
    "Ovide"
  ],
  "excluded_segments": [
    "Videoaficionats",
    "Particulars sense projecte audiovisual professional"
  ],
  "goals": [
    "Captar més clients d''alta gamma a Barcelona",
    "Reforçar relacions amb caps de producció freelance que es mouen entre productores",
    "Posicionar el hub de Sant Just com a one-stop shop integral"
  ],
  "brand_voice": "Professional però proper. Tècnic sense ser esnob. Confiat: parlem com algú que coneix la indústria des de dins (com fa el CEO, que és DP). En català per defecte; castellà i anglès si el client ho prefereix."
}'::jsonb
WHERE "marketingContext" IS NULL
  OR "marketingContext"::text = '{}'
  OR "marketingContext"::text = 'null';
