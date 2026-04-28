/**
 * Seed: Rols operatius, permisos i protocols inicials
 * Executar: node prisma/seedOperations.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding rols operatius...');

  // ===========================================
  // 1. Definicions de rols
  // ===========================================
  const roles = [
    {
      code: 'ADMIN_COORDINATION',
      name: 'Administració i Coordinació Externa',
      shortName: 'Admin',
      description: 'Gestiona comunicació amb clients, pressupostos, transports i coordinació externa.',
      color: '#3B82F6', // blue
      icon: 'phone',
      sortOrder: 1,
      responsibilities: [
        'Contestar telèfon',
        'Respondre correus',
        'Crear i modificar pressupostos',
        'Coordinar transports externs',
        'Coordinar transports interns',
        'Comunicar canvis de client al magatzem',
        'Confirmar horaris de recollida i entrega',
        'Avisar de prioritats urgents',
        'Centralitzar canvis importants abans que arribin al magatzem',
      ],
      limitations: null,
    },
    {
      code: 'WAREHOUSE_LEAD',
      name: 'Responsable Principal de Magatzem',
      shortName: 'Mag. Principal',
      description: 'Organitza i supervisa totes les operacions del magatzem.',
      color: '#10B981', // green
      icon: 'warehouse',
      sortOrder: 2,
      responsibilities: [
        'Organitzar les sortides del dia i de l\'endemà',
        'Assignar tasques al personal de suport',
        'Supervisar preparacions',
        'Supervisar devolucions',
        'Coordinar-se amb administració si hi ha canvis de pressupost, client o transport',
        'Coordinar-se amb el responsable tècnic si hi ha material dubtós o avariat',
        'Fer una revisió final bàsica abans de marcar un projecte com a preparat',
        'Prioritzar la feina del magatzem segons urgència, hora de sortida i complexitat',
      ],
      limitations: null,
    },
    {
      code: 'WAREHOUSE_SUPPORT',
      name: 'Responsable de Magatzem / Suport Operatiu',
      shortName: 'Mag. Suport',
      description: 'Prepara sortides, revisa devolucions i dona suport al responsable principal.',
      color: '#6EE7B7', // light green
      icon: 'package',
      sortOrder: 3,
      responsibilities: [
        'Preparar sortides',
        'Revisar devolucions',
        'Separar material pendent de revisió',
        'Mantenir l\'ordre del magatzem',
        'Donar suport al responsable principal de magatzem',
        'Assumir projectes concrets com a responsable quan sigui necessari',
        'Supervisar personal de suport si el responsable principal no està disponible',
      ],
      limitations: null,
    },
    {
      code: 'TECH_LEAD',
      name: 'Responsable Tècnic',
      shortName: 'Tècnic',
      description: 'Repara equips, diagnostica incidències i fa revisions tècniques exhaustives.',
      color: '#F59E0B', // amber
      icon: 'wrench',
      sortOrder: 4,
      responsibilities: [
        'Reparar equips',
        'Diagnosticar incidències',
        'Fer revisions tècniques exhaustives',
        'Fer col·limació d\'òptiques',
        'Fer backfocus de càmeres',
        'Validar equips crítics abans de sortida',
        'Decidir si un equip pot sortir o ha de quedar bloquejat',
        'Mantenir una llista de material fora de servei',
        'Informar administració i magatzem quan una incidència afecta una sortida o pressupost',
      ],
      limitations: null,
    },
    {
      code: 'INTERN_SUPPORT',
      name: 'Becaris / Personal de Suport',
      shortName: 'Becari',
      description: 'Personal en formació que ajuda en tasques bàsiques sota supervisió.',
      color: '#8B5CF6', // violet
      icon: 'user',
      sortOrder: 5,
      responsibilities: [
        'Recollir material del magatzem',
        'Netejar equips',
        'Ordenar caixes i accessoris',
        'Ajudar en preparacions',
        'Ajudar en devolucions',
        'Fer comprovacions bàsiques sota supervisió',
        'Fer inventaris guiats',
        'Aprendre processos sota la supervisió d\'un responsable',
      ],
      limitations: [
        'No poden validar un projecte com a preparat sense supervisió',
        'No poden decidir substitucions importants de material',
        'No poden gestionar incidències directament amb clients',
        'No poden modificar pressupostos',
        'No poden fer col·limació, backfocus o validacions tècniques crítiques sense autorització',
      ],
    },
    {
      code: 'GENERAL_MANAGER',
      name: 'Direcció / Encarregat General',
      shortName: 'Direcció',
      description: 'Accés total. Pot editar rols, protocols, permisos i configuració general.',
      color: '#EF4444', // red
      icon: 'shield',
      sortOrder: 0,
      responsibilities: [
        'Supervisar totes les àrees',
        'Editar rols i assignacions',
        'Editar protocols operatius',
        'Configurar permisos',
        'Prendre decisions estratègiques',
      ],
      limitations: null,
    },
  ];

  for (const role of roles) {
    await prisma.roleDefinition.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        shortName: role.shortName,
        description: role.description,
        responsibilities: role.responsibilities,
        limitations: role.limitations,
        color: role.color,
        icon: role.icon,
        sortOrder: role.sortOrder,
      },
      create: role,
    });
    console.log(`  ✓ Rol: ${role.name}`);
  }

  // ===========================================
  // 2. Matriu de permisos
  // ===========================================
  console.log('\nSeeding permisos...');

  const sections = ['projects', 'incidents', 'protocols', 'daily_plan', 'roles', 'equipment_blocking'];

  const permissionMatrix = {
    GENERAL_MANAGER:    ['FULL_ADMIN', 'FULL_ADMIN', 'FULL_ADMIN', 'FULL_ADMIN', 'FULL_ADMIN', 'FULL_ADMIN'],
    ADMIN_COORDINATION: ['MANAGE',     'MANAGE',     'VIEW_ONLY',  'VIEW_ONLY',  'VIEW_ONLY',  'NONE'],
    WAREHOUSE_LEAD:     ['MANAGE',     'MANAGE',     'VIEW_ONLY',  'MANAGE',     'VIEW_ONLY',  'NONE'],
    WAREHOUSE_SUPPORT:  ['OPERATE',    'OPERATE',    'VIEW_ONLY',  'OPERATE',    'VIEW_ONLY',  'NONE'],
    TECH_LEAD:          ['OPERATE',    'MANAGE',     'VIEW_ONLY',  'VIEW_ONLY',  'VIEW_ONLY',  'MANAGE'],
    INTERN_SUPPORT:     ['VIEW_ONLY',  'OPERATE',    'VIEW_ONLY',  'VIEW_ONLY',  'VIEW_ONLY',  'NONE'],
  };

  const roleDefs = await prisma.roleDefinition.findMany();
  const roleMap = Object.fromEntries(roleDefs.map(r => [r.code, r.id]));

  for (const [roleCode, levels] of Object.entries(permissionMatrix)) {
    const roleId = roleMap[roleCode];
    if (!roleId) continue;

    for (let i = 0; i < sections.length; i++) {
      await prisma.rolePermission.upsert({
        where: { roleId_section: { roleId, section: sections[i] } },
        update: { level: levels[i] },
        create: { roleId, section: sections[i], level: levels[i] },
      });
    }
    console.log(`  ✓ Permisos: ${roleCode}`);
  }

  // ===========================================
  // 3. Protocols inicials
  // ===========================================
  console.log('\nSeeding protocols...');

  const protocols = [
    {
      title: 'Revisió inicial del dia',
      slug: 'revisio-inicial-dia',
      category: 'daily',
      sortOrder: 1,
      content: `# Revisió inicial del dia

Cada matí, el responsable principal de magatzem revisa el **Pla del Dia** a l'app.

## Què cal comprovar

1. **Sortides d'avui** — Totes estan en estat "Preparat"? Si no, prioritzar les pendents.
2. **Sortides de demà** — Tenen responsable i personal assignat? Si no, assignar-los ara.
3. **Devolucions previstes** — Qui revisarà cada devolució?
4. **Transports programats** — Horaris confirmats? Interns i externs.
5. **Incidències obertes** — N'hi ha alguna que afecti sortides d'avui o demà?
6. **Personal disponible** — Qui hi és avui? Distribuir becaris segons càrrega.
7. **Assignació de becaris** — Cada becari ha de saber a quin projecte està assignat.

## Comunicació

Qualsevol canvi important s'ha de comunicar a **Administració** abans de començar la jornada.
Utilitzar les comunicacions del projecte a l'app, no només de paraula.`,
    },
    {
      title: 'Assignació de responsables',
      slug: 'assignacio-responsables',
      category: 'daily',
      sortOrder: 2,
      content: `# Assignació de responsables

Cada projecte ha de tenir **sempre** un responsable clar.

## Regles

- El responsable **no ha de fer totes les tasques personalment**, però sí **garantir** que el projecte queda complet, revisat i preparat.
- Si el responsable principal de magatzem no pot assumir un projecte, pot delegar al responsable de magatzem / suport operatiu.
- Els becaris **mai** són responsables d'un projecte. Sempre treballen sota supervisió.
- L'assignació es fa a primera hora del matí, durant la revisió del Pla del Dia.

## Com assignar

1. Obrir el projecte a l'app.
2. Seleccionar el responsable principal al camp "Responsable".
3. Afegir personal de suport a "Assignacions".
4. Crear subtasques si cal.`,
    },
    {
      title: 'Preparació de sortides',
      slug: 'preparacio-sortides',
      category: 'departure',
      sortOrder: 1,
      content: `# Preparació de sortides

## Flux complet

1. **Administració** confirma el projecte: pressupost, horaris i transport.
2. **Magatzem** prepara el material segons la llista del projecte.
3. **Personal de suport** ajuda sota supervisió directa del responsable.
4. El **responsable de magatzem** revisa que tot el material hi és i està en bon estat.
5. Si hi ha equips crítics (càmeres de cinema, òptiques de gamma alta), el **responsable tècnic** valida.
6. El projecte passa a estat **"Preparat"** quan té la validació de magatzem i, si cal, la validació tècnica.

## Equips que requereixen validació tècnica

- Càmeres de cinema (ARRI, RED, Sony Venice)
- Òptiques de cinema (CN-E, Sigma Cine, Cooke)
- Equips amb incidències recents
- Qualsevol equip que el responsable de magatzem consideri dubtós

## Important

- **Mai sortir material sense validació** del responsable de magatzem.
- Si falta material, comunicar immediatament a administració per buscar alternativa.
- Si es fa una substitució, registrar-la al projecte.`,
    },
    {
      title: 'Revisió de devolucions',
      slug: 'revisio-devolucions',
      category: 'return',
      sortOrder: 1,
      content: `# Revisió de devolucions

## Flux complet

1. Es rep el material del client.
2. Es comprova **ítem per ítem** que torna tot el que va sortir.
3. Per cada ítem es marca la condició: OK, Danyat, Falta, Consumible gastat.
4. Es **separa el material amb incidència** i es crea registre a l'app.
5. Si cal informar el client (faltes, danys), es marca a la incidència → Administració rep notificació.
6. Si cal reparació, es notifica el responsable tècnic.
7. El projecte es **tanca** quan tot queda revisat i documentat.

## Terminis

- Les devolucions s'han de revisar el **mateix dia** que arriben.
- Si no és possible, com a màxim en **24 hores**.
- L'app genera alerta si una devolució no s'ha revisat en 24h.`,
    },
    {
      title: 'Gestió d\'incidències',
      slug: 'gestio-incidencies',
      category: 'incident',
      sortOrder: 1,
      content: `# Gestió d'incidències

## Qui pot crear una incidència?

**Qualsevol persona** que detecti un problema pot (i ha de) crear una incidència a l'app.

## Què cal registrar

- **Projecte** relacionat (si n'hi ha)
- **Equip** afectat (del inventari)
- **Descripció** del problema
- **Severitat**: Baixa, Mitjana, Alta, Crítica
- Si **afecta una sortida futura**
- Si **cal avisar el client**
- Si el **material queda bloquejat**

## Assignació automàtica

- Avaria / reparació → Responsable tècnic
- Falta / pèrdua → Responsable magatzem
- Afecta client → Administració

## Resolució

El responsable assignat ha de:
1. Investigar el problema.
2. Decidir si l'equip pot sortir o queda bloquejat.
3. Reparar o documentar.
4. Tancar la incidència amb notes de resolució.

## Severitats

| Severitat | Significat | Acció |
|-----------|-----------|-------|
| Baixa | No afecta sortides | Resoldre quan es pugui |
| Mitjana | Pot afectar sortides futures | Resoldre en 48h |
| Alta | Afecta una sortida propera | Resoldre avui |
| Crítica | Bloqueja una sortida imminent | Aturar tot i resoldre ara |`,
    },
    {
      title: 'Comunicació interna',
      slug: 'comunicacio-interna',
      category: 'daily',
      sortOrder: 3,
      content: `# Comunicació interna

## Regla d'or

> Els canvis importants **s'han de registrar dins l'app**, no comunicar-se només verbalment.

## Què cal registrar

- Modificacions de client (canvi de material, dates, horaris)
- Canvis de pressupost
- Canvis de transport (hora, tipus, vehicle)
- Material no disponible
- Substitucions de material
- Qualsevol cosa que afecti la preparació d'un projecte

## Com comunicar

1. Obrir el projecte afectat.
2. Anar a la pestanya "Comunicacions".
3. Escriure el missatge indicant el rol destinatari.
4. Si és urgent, marcar com a **urgent** → genera alerta immediata.

## Limitacions del personal de suport

- No poden validar un projecte com a preparat sense supervisió.
- No poden decidir substitucions importants de material.
- No poden gestionar incidències directament amb clients.
- No poden modificar pressupostos.
- No poden fer col·limació, backfocus o validacions tècniques crítiques sense autorització.`,
    },
  ];

  for (const proto of protocols) {
    await prisma.protocol.upsert({
      where: { slug: proto.slug },
      update: {
        title: proto.title,
        content: proto.content,
        category: proto.category,
        sortOrder: proto.sortOrder,
      },
      create: proto,
    });
    console.log(`  ✓ Protocol: ${proto.title}`);
  }

  console.log('\n✅ Seed completat!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
