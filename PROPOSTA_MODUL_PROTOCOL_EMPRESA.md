# Mòdul "Protocol d'Empresa" — Proposta Tècnica Completa

## SeitoCamera Admin — Manual Operatiu Intern

**Data:** 28 abril 2026  
**Versió:** 1.0  
**Stack:** PostgreSQL + Prisma ORM + Express.js + React

---

## 1. Visió General

El mòdul "Protocol d'Empresa" converteix el coneixement operatiu del rental en un sistema estructurat dins l'app. L'objectiu és que els processos no depenguin de persones concretes sinó de **rols ben definits**, amb traçabilitat completa de cada projecte des que es confirma fins que es tanca.

El mòdul s'integra amb les entitats existents (User, Equipment, Client) i afegeix 10 noves taules al schema Prisma.

---

## 2. Esquema de Base de Dades (Prisma)

### 2.1 Enums nous

```prisma
enum OperationalRole {
  ADMIN_COORDINATION     // Administració i coordinació externa
  WAREHOUSE_LEAD         // Responsable principal de magatzem
  WAREHOUSE_SUPPORT      // Responsable de magatzem / suport operatiu
  TECH_LEAD              // Responsable tècnic
  INTERN_SUPPORT         // Becaris / personal de suport
  GENERAL_MANAGER        // Direcció / encarregat general
}

enum ProjectStatus {
  PENDING_PREP           // Pendent de preparar
  IN_PREPARATION         // En preparació
  PENDING_TECH_REVIEW    // Pendent de revisió tècnica
  PENDING_FINAL_CHECK    // Pendent de validació final
  READY                  // Preparat
  PENDING_LOAD           // Pendent de càrrega
  OUT                    // Sortit
  RETURNED               // Retornat
  RETURN_REVIEW          // En revisió de devolució
  WITH_INCIDENT          // Amb incidència
  EQUIPMENT_BLOCKED      // Material bloquejat
  CLOSED                 // Tancat
}

enum IncidentStatus {
  OPEN                   // Oberta
  IN_PROGRESS            // En investigació / reparació
  WAITING_PARTS          // Esperant peces / recanvis
  WAITING_CLIENT         // Esperant resposta client
  RESOLVED               // Resolta
  CLOSED                 // Tancada
}

enum IncidentSeverity {
  LOW                    // No afecta sortides
  MEDIUM                 // Pot afectar sortides futures
  HIGH                   // Afecta una sortida propera
  CRITICAL               // Bloqueja una sortida imminent
}

enum TaskStatus {
  PENDING
  IN_PROGRESS
  DONE
  CANCELLED
}

enum PermissionLevel {
  NONE                   // Sense accés
  VIEW                   // Només veure
  OPERATE                // Veure + executar tasques
  MANAGE                 // Operar + assignar + validar
  ADMIN                  // Tot, inclòs editar protocols i rols
}
```

### 2.2 Taules noves

#### `RoleDefinition` — Definició de rols operatius

Aquesta taula defineix els rols de l'empresa. No depèn de persones, sinó que descriu responsabilitats.

```prisma
model RoleDefinition {
  id              String          @id @default(cuid())
  code            OperationalRole @unique
  name            String                    // "Responsable principal de magatzem"
  shortName       String                    // "Mag. Principal"
  description     String?                   // Descripció lliure del rol
  responsibilities Json                     // String[] de responsabilitats
  limitations     Json?                     // String[] de limitacions (becaris)
  sortOrder       Int             @default(0)
  isActive        Boolean         @default(true)
  color           String          @default("#2390A0")  // Color per UI
  icon            String?                   // Icona (ex: "warehouse", "wrench", "phone")
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relacions
  assignments     RoleAssignment[]
  permissions     RolePermission[]

  @@map("role_definitions")
}
```

#### `RoleAssignment` — Assignació temporal de persones a rols

```prisma
model RoleAssignment {
  id              String          @id @default(cuid())
  roleId          String
  userId          String
  isPrimary       Boolean         @default(true)   // Assignació principal vs suplent
  startDate       DateTime        @default(now())
  endDate         DateTime?                         // null = actiu indefinidament
  notes           String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relacions
  role            RoleDefinition  @relation(fields: [roleId], references: [id])
  user            User            @relation(fields: [userId], references: [id])

  @@unique([roleId, userId, startDate])
  @@index([userId])
  @@index([roleId])
  @@map("role_assignments")
}
```

#### `RolePermission` — Permisos per rol sobre seccions del mòdul

```prisma
model RolePermission {
  id              String          @id @default(cuid())
  roleId          String
  section         String                    // "projects", "incidents", "protocols", "daily_plan", "roles", "equipment_blocking"
  level           PermissionLevel @default(VIEW)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relacions
  role            RoleDefinition  @relation(fields: [roleId], references: [id])

  @@unique([roleId, section])
  @@map("role_permissions")
}
```

#### `RentalProject` — Projectes de lloguer (sortides de material)

Aquesta és la taula central del mòdul. Cada sortida de material és un projecte.

```prisma
model RentalProject {
  id                  String         @id @default(cuid())
  name                String                     // "Rodatge Estrella Damm"
  clientName          String?                    // Nom del client (o FK a Client)
  clientId            String?                    // FK opcional a Client existent
  
  // Dates i horaris
  departureDate       DateTime                   // Data de sortida
  departureTime       String?                    // Hora de sortida "09:00"
  returnDate          DateTime                   // Data de devolució prevista
  returnTime          String?                    // Hora de devolució prevista
  actualReturnDate    DateTime?                  // Data de devolució real
  
  // Estat
  status              ProjectStatus  @default(PENDING_PREP)
  priority            Int            @default(0) // 0=normal, 1=alta, 2=urgent
  
  // Responsables
  leadUserId          String?                    // Responsable principal del projecte (User)
  leadRoleCode        OperationalRole?           // Rol del responsable
  
  // Transport
  transportType       String?                    // "INTERN", "EXTERN", "CLIENT_PICKUP"
  transportNotes      String?                    // Detalls del transport
  pickupTime          String?                    // Hora de recollida/entrega
  
  // Validacions
  warehouseValidated  Boolean        @default(false)
  warehouseValidatedBy String?
  warehouseValidatedAt DateTime?
  techValidated       Boolean        @default(false)
  techValidatedBy     String?
  techValidatedAt     DateTime?
  techValidationRequired Boolean     @default(false) // Si requereix revisió tècnica
  
  // Referències externes
  rentmanProjectId    String?                    // ID del projecte a Rentman
  budgetReference     String?                    // Referència del pressupost
  
  // Observacions
  internalNotes       String?                    // Notes internes
  clientNotes         String?                    // Notes per comunicar al client
  
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  // Relacions
  client              Client?        @relation(fields: [clientId], references: [id])
  leadUser            User?          @relation("ProjectLead", fields: [leadUserId], references: [id])
  assignments         ProjectAssignment[]
  statusHistory       ProjectStatusChange[]
  incidents           Incident[]
  tasks               ProjectTask[]
  equipmentItems      ProjectEquipment[]
  communications      ProjectCommunication[]

  @@index([departureDate])
  @@index([returnDate])
  @@index([status])
  @@index([leadUserId])
  @@index([priority])
  @@map("rental_projects")
}
```

#### `ProjectAssignment` — Personal assignat a cada projecte

```prisma
model ProjectAssignment {
  id              String          @id @default(cuid())
  projectId       String
  userId          String
  roleCode        OperationalRole              // Rol amb què participa
  isLead          Boolean         @default(false) // Si és el responsable principal
  notes           String?
  createdAt       DateTime        @default(now())

  // Relacions
  project         RentalProject   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id])

  @@unique([projectId, userId])
  @@index([userId])
  @@map("project_assignments")
}
```

#### `ProjectStatusChange` — Historial de canvis d'estat

```prisma
model ProjectStatusChange {
  id              String         @id @default(cuid())
  projectId       String
  fromStatus      ProjectStatus?
  toStatus        ProjectStatus
  changedBy       String?                     // userId
  reason          String?                     // Motiu del canvi
  createdAt       DateTime       @default(now())

  // Relacions
  project         RentalProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([createdAt])
  @@map("project_status_changes")
}
```

#### `ProjectEquipment` — Material assignat a cada projecte

```prisma
model ProjectEquipment {
  id              String         @id @default(cuid())
  projectId       String
  equipmentId     String?                     // FK a Equipment existent (opcional)
  itemName        String                      // Nom de l'equip (pot ser lliure si no està a inventari)
  quantity        Int            @default(1)
  isCheckedOut    Boolean        @default(false)  // Marcat com a sortit
  isReturned      Boolean        @default(false)  // Marcat com a retornat
  returnCondition String?                     // "OK", "DAMAGED", "MISSING", "CONSUMABLE_USED"
  notes           String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  // Relacions
  project         RentalProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  equipment       Equipment?     @relation(fields: [equipmentId], references: [id])

  @@index([projectId])
  @@index([equipmentId])
  @@map("project_equipment")
}
```

#### `ProjectTask` — Subtasques dins d'un projecte

```prisma
model ProjectTask {
  id              String         @id @default(cuid())
  projectId       String
  title           String                      // "Netejar òptiques", "Embalar flight cases"
  description     String?
  assignedToId    String?                     // userId assignat
  status          TaskStatus     @default(PENDING)
  dueAt           DateTime?
  completedAt     DateTime?
  completedById   String?
  requiresSupervision Boolean   @default(false) // Si la tasca requereix supervisió d'un responsable
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  // Relacions
  project         RentalProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([assignedToId])
  @@index([status])
  @@map("project_tasks")
}
```

#### `Incident` — Incidències

```prisma
model Incident {
  id              String           @id @default(cuid())
  projectId       String?                      // Projecte relacionat (pot ser independent)
  equipmentId     String?                      // Equip afectat
  
  title           String                       // Resum curt
  description     String                       // Descripció detallada
  severity        IncidentSeverity @default(MEDIUM)
  status          IncidentStatus   @default(OPEN)
  
  // Qui i quan
  reportedById    String                       // userId que detecta la incidència
  assignedToId    String?                      // userId responsable de resoldre-la
  assignedRoleCode OperationalRole?            // Rol responsable
  
  // Impacte
  affectsFutureDeparture Boolean  @default(false)
  affectedProjectId      String?              // Projecte futur afectat
  requiresClientNotification Boolean @default(false)
  clientNotified  Boolean        @default(false)
  equipmentBlocked Boolean       @default(false) // Material queda bloquejat
  
  // Resolució
  actionTaken     String?                      // Acció recomanada / executada
  resolvedAt      DateTime?
  resolvedById    String?
  resolutionNotes String?
  
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  // Relacions
  project         RentalProject?   @relation(fields: [projectId], references: [id])
  equipment       Equipment?       @relation(fields: [equipmentId], references: [id])

  @@index([projectId])
  @@index([equipmentId])
  @@index([status])
  @@index([severity])
  @@index([reportedById])
  @@map("incidents")
}
```

#### `DailyPlan` — Planificació diària

```prisma
model DailyPlan {
  id              String         @id @default(cuid())
  date            DateTime       @unique        // Un pla per dia
  
  // Resum del dia
  summary         String?                      // Notes generals del dia
  availableStaff  Json?                        // String[] de userIds disponibles
  urgentNotes     String?                      // Alertes o notes urgents
  
  // Qui ha creat/revisat
  createdById     String?
  reviewedById    String?
  reviewedAt      DateTime?
  
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([date])
  @@map("daily_plans")
}
```

#### `ProjectCommunication` — Comunicacions internes registrades

```prisma
model ProjectCommunication {
  id              String         @id @default(cuid())
  projectId       String
  authorId        String                       // Qui escriu
  targetRoleCode  OperationalRole?             // Rol destinatari (o null = tots)
  message         String
  isUrgent        Boolean        @default(false)
  isRead          Boolean        @default(false)
  readAt          DateTime?
  createdAt       DateTime       @default(now())

  // Relacions
  project         RentalProject  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([targetRoleCode])
  @@index([isRead])
  @@map("project_communications")
}
```

#### `Protocol` — Protocols operatius (manual editable)

```prisma
model Protocol {
  id              String         @id @default(cuid())
  title           String                       // "Preparació de sortides"
  slug            String         @unique        // "preparacio-sortides"
  category        String                       // "daily", "departure", "return", "incident", "maintenance"
  content         String                       // Contingut en Markdown
  sortOrder       Int            @default(0)
  isActive        Boolean        @default(true)
  lastEditedById  String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([category])
  @@map("protocols")
}
```

### 2.3 Modificacions a taules existents

```prisma
// Afegir a User:
model User {
  // ... camps existents ...
  roleAssignments     RoleAssignment[]
  projectAssignments  ProjectAssignment[]
  ledProjects         RentalProject[]   @relation("ProjectLead")
}

// Afegir a Client:
model Client {
  // ... camps existents ...
  rentalProjects      RentalProject[]
}

// Afegir a Equipment:
model Equipment {
  // ... camps existents ...
  projectEquipment    ProjectEquipment[]
  incidents           Incident[]
}
```

---

## 3. Estructura de Pantalles

### 3.1 Navegació (Sidebar)

Nova secció "Operacions" al menú lateral amb les subpàgines:

```
📋 Operacions
  ├── 📅 Pla del Dia          → /operations/daily
  ├── 📦 Projectes            → /operations/projects
  ├── ⚠️ Incidències          → /operations/incidents
  ├── 👥 Rols i Personal      → /operations/roles
  ├── 📖 Protocols            → /operations/protocols
  └── ⚙️ Configuració Ops     → /operations/settings
```

### 3.2 Pantalla: Pla del Dia (`/operations/daily`)

**Propòsit:** Vista matinal per coordinar el dia. Primera pantalla que es mira cada matí.

**Seccions:**

1. **Capçalera del dia**
   - Data actual + selector de dia
   - Personal disponible avui (avatars/noms amb el seu rol)
   - Alertes urgents (badge vermell)

2. **Sortides d'avui** (cards amb estat, hora de sortida, responsable)
   - Filtre ràpid per estat
   - Indicador de prioritat (urgent = vermell, alta = taronja)
   - Botó "Marcar com preparat" directe

3. **Sortides de demà** (mateixa estructura, per planificar)

4. **Devolucions previstes avui**
   - Llista de projectes que tornen avui
   - Estat de la revisió de devolució

5. **Transports** (interns i externs, amb horaris)

6. **Incidències obertes** (resum amb severitat)

7. **Assignació de becaris/suport**
   - Drag & drop dels becaris disponibles a projectes
   - Qui està assignat on

**Permisos:**
- Tots els rols: poden veure
- WAREHOUSE_LEAD, ADMIN_COORDINATION: poden editar assignacions
- INTERN_SUPPORT: només veuen les seves tasques assignades

---

### 3.3 Pantalla: Projectes (`/operations/projects`)

**Propòsit:** Gestió completa del cicle de vida de cada sortida.

**Vista principal: Kanban o Llista**

Columnes Kanban (una per estat):
```
Pendent preparar → En preparació → Revisió tècnica → Validació final → Preparat → Pendent càrrega → Sortit → ...
```

**Detall del projecte (modal o pàgina):**

- **Tab "General"**
  - Nom, client, dates, horaris, transport
  - Responsable principal (dropdown d'usuaris filtrats per rol)
  - Personal de suport assignat
  - Estat actual + botó de transició
  - Referència Rentman / pressupost

- **Tab "Material"**
  - Llista d'equips assignats (del inventari o lliure)
  - Checkbox de sortida i devolució per ítem
  - Condició de retorn per ítem
  - Botó "Afegir des d'inventari"

- **Tab "Tasques"**
  - Subtasques assignades a personal
  - Qui l'ha de fer, estat, supervisió requerida
  - Progress bar general

- **Tab "Incidències"**
  - Incidències vinculades al projecte
  - Botó per crear-ne de noves

- **Tab "Comunicacions"**
  - Fil de missatges interns sobre el projecte
  - Indicador si van dirigits a un rol concret
  - Missatges urgents destacats

- **Tab "Historial"**
  - Timeline de tots els canvis d'estat
  - Qui, quan, motiu

- **Tab "Validacions"**
  - Validació magatzem: ✅/❌ + qui + quan
  - Validació tècnica: ✅/❌ + qui + quan (si requerida)
  - Observacions internes

**Permisos:**
- ADMIN_COORDINATION: pot crear projectes, editar dades de client/pressupost/transport
- WAREHOUSE_LEAD: pot assignar tasques, canviar estats de preparació, validar
- WAREHOUSE_SUPPORT: pot canviar estats de preparació, marcar tasques com fetes
- TECH_LEAD: pot marcar validació tècnica, bloquejar material
- INTERN_SUPPORT: pot marcar subtasques bàsiques, no pot validar projectes
- GENERAL_MANAGER: accés total

---

### 3.4 Pantalla: Incidències (`/operations/incidents`)

**Propòsit:** Registre centralitzat de tot el que va malament.

**Vista principal: Taula filtrable**

Columnes: Severitat | Títol | Projecte | Equip | Estat | Responsable | Data

**Filtres:** Per estat, severitat, projecte, equip, responsable

**Detall d'incidència:**
- Projecte relacionat (selector)
- Equip afectat (selector de l'inventari)
- Descripció del problema
- Persona que la detecta (auto: usuari logat)
- Severitat
- Responsable assignat
- Acció recomanada
- Checkboxes: afecta sortida futura? Cal avisar client? Material bloquejat?
- Històric d'actualitzacions

**Permisos:**
- Tots poden crear incidències (qualsevol pot detectar un problema)
- TECH_LEAD: pot assignar-se, canviar estat, bloquejar material
- WAREHOUSE_LEAD: pot canviar estat, assignar a tècnic
- INTERN_SUPPORT: pot crear, no pot resoldre ni bloquejar

---

### 3.5 Pantalla: Rols i Personal (`/operations/roles`)

**Propòsit:** Gestionar qui fa què a l'empresa. Els rols són fixos, les persones canvien.

**Seccions:**

1. **Rols definits** (cards)
   - Cada card mostra: nom del rol, descripció, responsabilitats, limitacions
   - Persones assignades actualment (amb foto/avatar)
   - Botó "Assignar persona" / "Desassignar"
   - Indicador principal vs suplent

2. **Matriu de permisos**
   - Taula: files = rols, columnes = seccions del mòdul
   - Cada cel·la: selector de nivell (NONE/VIEW/OPERATE/MANAGE/ADMIN)

3. **Cadena de responsabilitat** (diagrama visual)
   - Qui reporta a qui
   - Flux de comunicació entre rols

**Permisos:**
- GENERAL_MANAGER: pot editar rols, permisos, assignacions
- Resta: només veure

---

### 3.6 Pantalla: Protocols (`/operations/protocols`)

**Propòsit:** Manual operatiu digital, editable i consultable.

**Vista:** Llista de protocols agrupats per categoria

**Categories:**
- Diari: "Revisió inicial del dia", "Assignació de responsables"
- Sortides: "Preparació de sortides", "Validació final"
- Devolucions: "Revisió de devolucions", "Comprovació de material"
- Incidències: "Gestió d'incidències", "Comunicació al client"
- Manteniment: "Revisió tècnica periòdica", "Col·limació i backfocus"

**Editor:** Markdown amb preview (similar a un wiki intern)

**Permisos:**
- Tots: poden consultar
- GENERAL_MANAGER: pot editar
- ADMIN_COORDINATION: pot suggerir canvis (via comunicacions)

---

### 3.7 Pantalla: Configuració Ops (`/operations/settings`)

**Propòsit:** Configurar estats, alertes, integracions.

- Personalitzar estats de projecte (afegir/treure estats)
- Configurar alertes automàtiques
- Integració amb Rentman (importar projectes)
- Plantilles de tasques recurrents

---

## 4. Fluxos Principals

### 4.1 Flux de Preparació de Sortida

```
1. ADMIN_COORDINATION confirma projecte
   → Crea RentalProject amb estat PENDING_PREP
   → Afegeix dades: client, dates, horaris, transport, pressupost
   → Notifica WAREHOUSE_LEAD

2. WAREHOUSE_LEAD rep notificació
   → Revisa el projecte al Pla del Dia
   → Assigna responsable del projecte (ell/ella o WAREHOUSE_SUPPORT)
   → Assigna INTERN_SUPPORT com a suport
   → Crea subtasques: "Recollir material", "Netejar òptiques", etc.
   → Canvia estat a IN_PREPARATION

3. WAREHOUSE_SUPPORT + INTERN_SUPPORT preparen
   → Marquen subtasques com a fetes
   → Si troben material dubtós → creen Incident + notifiquen TECH_LEAD
   → Si necessiten aclariment → escriuen a ProjectCommunication

4. WAREHOUSE_LEAD revisa preparació
   → Comprova que tot el material hi és
   → Si requereix revisió tècnica → estat PENDING_TECH_REVIEW + notifica TECH_LEAD
   → Si no → marca warehouseValidated = true

5. TECH_LEAD (si cal)
   → Valida equips crítics (càmeres, òptiques)
   → Si OK → techValidated = true → estat PENDING_FINAL_CHECK
   → Si KO → Incident + equipmentBlocked + busca substitut + notifica ADMIN_COORDINATION

6. Validació final
   → WAREHOUSE_LEAD fa darrera revisió
   → Estat passa a READY

7. Sortida
   → Estat PENDING_LOAD quan es carrega
   → Estat OUT quan surt
```

### 4.2 Flux de Revisió de Devolució

```
1. Material arriba
   → WAREHOUSE_LEAD o WAREHOUSE_SUPPORT canvien estat a RETURNED

2. Revisió
   → Es comprova ítem per ítem (ProjectEquipment)
   → Cada ítem es marca: OK / DAMAGED / MISSING / CONSUMABLE_USED
   → Estat passa a RETURN_REVIEW

3. Detecció de problemes
   → Si falta material o hi ha danys → Incident amb severity adequada
   → Si cal avisar client → requiresClientNotification = true
   → Notifica ADMIN_COORDINATION
   → Si cal reparació → notifica TECH_LEAD

4. Tancament
   → Quan tot està revisat i les incidències resoltes
   → Estat CLOSED
```

### 4.3 Flux de Gestió d'Incidències

```
1. Qualsevol persona detecta un problema → Crea Incident
   → S'assigna automàticament segons el tipus:
     - Avaria/reparació → TECH_LEAD
     - Falta/pèrdua → WAREHOUSE_LEAD
     - Afecta client → ADMIN_COORDINATION

2. Responsable assignat investiga
   → Actualitza estat: IN_PROGRESS
   → Si l'equip no pot sortir → equipmentBlocked = true
   → Si afecta sortida futura → affectsFutureDeparture = true

3. Resolució
   → Es repara / substitueix / documenta
   → Es desbloqueja l'equip si ja està bé
   → Es notifica als afectats

4. Tancament
   → Estat RESOLVED → CLOSED
```

### 4.4 Flux Diari (Protocol Matinal)

```
Cada matí, el WAREHOUSE_LEAD obre /operations/daily:

1. Revisa sortides d'avui
   → Totes READY? Si no, prioritza les pendents.

2. Revisa sortides de demà
   → Assigna responsables i suport si no estan assignats.

3. Revisa devolucions previstes
   → Assigna qui revisarà.

4. Revisa incidències obertes
   → Hi ha alguna que afecta sortides d'avui/demà?

5. Assigna becaris
   → Distribueix el personal de suport segons càrrega.

6. Anota observacions urgents
   → Notes al DailyPlan.

7. Comunica a ADMIN_COORDINATION
   → Canvis d'horari, material no disponible, etc.
```

---

## 5. Matriu de Permisos per Rol

| Secció | ADMIN_COORD | WAREHOUSE_LEAD | WAREHOUSE_SUPPORT | TECH_LEAD | INTERN_SUPPORT | GENERAL_MANAGER |
|--------|:-----------:|:--------------:|:------------------:|:---------:|:--------------:|:---------------:|
| Pla del dia | VIEW | MANAGE | OPERATE | VIEW | VIEW | ADMIN |
| Projectes — crear | MANAGE | MANAGE | NONE | NONE | NONE | ADMIN |
| Projectes — preparar | NONE | MANAGE | OPERATE | NONE | OPERATE* | ADMIN |
| Projectes — validar magatzem | NONE | MANAGE | NONE | NONE | NONE | ADMIN |
| Projectes — validar tècnic | NONE | NONE | NONE | MANAGE | NONE | ADMIN |
| Projectes — dades client/pressupost | MANAGE | VIEW | NONE | NONE | NONE | ADMIN |
| Incidències — crear | MANAGE | MANAGE | OPERATE | MANAGE | OPERATE | ADMIN |
| Incidències — resoldre | NONE | MANAGE | NONE | MANAGE | NONE | ADMIN |
| Material — bloquejar | NONE | NONE | NONE | MANAGE | NONE | ADMIN |
| Rols i assignacions | VIEW | VIEW | VIEW | VIEW | VIEW | ADMIN |
| Protocols — editar | NONE | NONE | NONE | NONE | NONE | ADMIN |
| Configuració | NONE | NONE | NONE | NONE | NONE | ADMIN |

*OPERATE amb supervisió = pot marcar subtasques però no validar el projecte sencer.

---

## 6. Cadena de Responsabilitat

```
                    ┌─────────────────┐
                    │    DIRECCIÓ     │
                    │ General Manager │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
  ┌─────────┴──────┐  ┌─────┴───────┐  ┌─────┴──────────┐
  │  ADMINISTRACIÓ │  │  MAGATZEM   │  │    TÈCNIC      │
  │  Coordinació   │  │  Principal  │  │  Reparacions   │
  │  externa       │  │             │  │  i validació   │
  └────────────────┘  └──────┬──────┘  └────────────────┘
                             │
                    ┌────────┴────────┐
                    │  MAGATZEM       │
                    │  Suport operatiu│
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │    BECARIS      │
                    │  Personal suport│
                    └─────────────────┘
```

**Comunicació entre àrees:**

- **Client → Administració:** Administració és l'únic punt de contacte amb el client. Mai el magatzem ni els becaris parlen directament amb clients.
- **Administració → Magatzem:** Canvis de pressupost, horaris, transport es comuniquen via l'app (ProjectCommunication), mai només verbalment.
- **Magatzem → Tècnic:** Material dubtós o avariat es reporta via Incident, no per WhatsApp.
- **Tècnic → Administració:** Si una incidència afecta un pressupost o cal informar el client, el tècnic ho indica a la incidència i l'app notifica administració.

---

## 7. Alertes i Notificacions

### 7.1 Notificacions dins l'app (badge + toast)

| Trigger | Destinatari | Prioritat |
|---------|-------------|-----------|
| Nou projecte creat | WAREHOUSE_LEAD | Normal |
| Projecte passa a IN_PREPARATION | ADMIN_COORDINATION | Baixa |
| Projecte requereix revisió tècnica | TECH_LEAD | Alta |
| Material bloquejat afecta sortida propera | ADMIN_COORD + WAREHOUSE_LEAD | Urgent |
| Incidència CRITICAL creada | Tots els responsables | Urgent |
| Cal avisar client (incident) | ADMIN_COORDINATION | Alta |
| Subtasques assignades | INTERN_SUPPORT corresponent | Normal |
| Canvi d'horari o transport | WAREHOUSE_LEAD | Alta |
| Projecte no preparat faltant < 2h per sortida | WAREHOUSE_LEAD | Urgent |
| Devolució no revisada > 24h | WAREHOUSE_LEAD | Alta |
| Material no retornat passat 1 dia | ADMIN_COORDINATION | Alta |

### 7.2 Implementació tècnica

```prisma
model Notification {
  id              String         @id @default(cuid())
  userId          String                       // Destinatari
  type            String                       // "project_created", "incident_critical", etc.
  title           String
  message         String
  entityType      String?                      // "rental_project", "incident"
  entityId        String?
  priority        String         @default("normal") // "low", "normal", "high", "urgent"
  isRead          Boolean        @default(false)
  readAt          DateTime?
  createdAt       DateTime       @default(now())

  @@index([userId, isRead])
  @@index([createdAt])
  @@map("notifications")
}
```

### 7.3 Futures: Push Notifications (PWA)

Quan s'implementi la PWA amb Web Push, les notificacions de prioritat "alta" i "urgent" es podran enviar com a push notifications al mòbil/iPad.

---

## 8. Protocols Interns (Contingut Inicial)

El mòdul vindria precarregat amb els protocols següents a la taula `Protocol`:

### Protocol 1: Revisió inicial del dia
**Categoria:** daily  
**Contingut:** Cada matí, el responsable principal de magatzem revisa el Pla del Dia a l'app. Ha de comprovar les sortides d'avui i de demà, les devolucions previstes, els transports programats, les incidències obertes que afectin sortides, el personal disponible i l'assignació de becaris. Qualsevol canvi important s'ha de comunicar a administració abans de començar.

### Protocol 2: Preparació de sortides
**Categoria:** departure  
**Contingut:** Administració confirma projecte, pressupost, horaris i transport a l'app. El responsable de magatzem organitza la preparació i assigna tasques al personal de suport. El personal de suport ajuda sota supervisió directa. El responsable de magatzem revisa la preparació completa. Si hi ha equips crítics (càmeres de cinema, òptiques de gamma alta), el responsable tècnic valida abans de marcar com preparat. El projecte passa a "Preparat" quan té la validació de magatzem i, si cal, la validació tècnica.

### Protocol 3: Revisió de devolucions
**Categoria:** return  
**Contingut:** Quan el material arriba, es comprova que torna tot ítem per ítem. Es detecten faltes, trencaments o consumibles gastats. Es separa el material amb incidència i es crea un registre a l'app. Si cal informar el client, es marca a la incidència i administració rep la notificació. Si cal reparació, es notifica el responsable tècnic. El projecte es tanca quan tot queda revisat i documentat.

### Protocol 4: Gestió d'incidències
**Categoria:** incident  
**Contingut:** Qualsevol persona que detecti un problema crea una incidència a l'app indicant el projecte, l'equip, la descripció i la severitat. L'app assigna automàticament al rol corresponent. El responsable avalua si l'equip pot continuar sortint o queda bloquejat. Si la incidència afecta una sortida futura o un pressupost, es registra a l'app i es notifica administració. Tota acció es documenta per mantenir la traçabilitat.

### Protocol 5: Comunicació interna
**Categoria:** daily  
**Contingut:** Els canvis importants (modificacions de client, horaris, pressupostos, transports, material no disponible) s'han de registrar dins l'app, no comunicar-se només verbalment. Cada projecte té un fil de comunicacions on es poden deixar missatges dirigits a un rol concret. Els missatges urgents es marquen com a tals i generen una alerta immediata al destinatari.

### Protocol 6: Limitacions del personal de suport
**Categoria:** daily  
**Contingut:** El personal de suport (becaris) no pot validar un projecte com a preparat sense la supervisió d'un responsable. No pot decidir substitucions importants de material. No pot gestionar incidències directament amb clients. No pot modificar pressupostos. No pot fer col·limació, backfocus o validacions tècniques crítiques sense autorització explícita del responsable tècnic.

---

## 9. Exemple Pràctic: Un Dia de Treball al Rental

### Dilluns 28 d'abril, 8:30h — Inici de jornada

**Cristina** (Responsable principal magatzem) obre l'app al **Pla del Dia**:

#### Sortides d'avui:
- **"Rodatge Estrella Damm"** — Sortida 11:00h — 2 càmeres Sony FX6, 4 òptiques Canon CN-E, il·luminació Arri. Estat: READY. Transport extern a les 10:30h. ✅ Tot OK.
- **"Sessió fotogràfica Mango"** — Sortida 14:00h — 1 càmera Canon R5, 3 òptiques RF, reflectors. Estat: IN_PREPARATION. Responsable: Noa. Suport: Paula.

#### Sortides de demà:
- **"Documental TV3"** — Sortida 8:00h — Material extens. Estat: PENDING_PREP. Cristina s'assigna com a responsable. Assigna Javi i Alex de suport.

#### Devolucions d'avui:
- **"Curta Festival Sitges"** — Previst arribar a les 16:00h.

#### Incidències obertes:
- ⚠️ **Objectiu Canon CN-E 35mm T1.5** — "Possible descentrament detectat diumenge". Severitat: MEDIUM. Assignat a Marc (tècnic). Afecta "Documental TV3" de demà.

---

### 9:00h — Cristina coordina

1. **Cristina** veu que l'incident de l'objectiu CN-E 35mm pot afectar el documental de demà. Escriu una comunicació al projecte "Documental TV3": *"@TECH_LEAD: L'objectiu CN-E 35mm que necessitem per demà té un incident obert. Pots revisar-lo avui i confirmar si pot sortir?"*

2. **Marc** (Tècnic) rep la notificació. Obre la incidència. Fa la revisió de col·limació. Actualitza la incidència: *"Revisada col·limació. Lleuger descentrament corregit. L'objectiu pot sortir."* Canvia estat a RESOLVED. Desbloqueja l'equip.

3. **Cristina** rep notificació de la resolució. Actualitza la comunicació: *"Confirmat, l'objectiu surt demà."*

---

### 10:00h — Preparació en curs

4. **Noa** (Magatzem suport) prepara "Sessió fotogràfica Mango" amb **Paula** (becària).
   - Noa assigna subtasques a Paula: "Recollir reflectors del prestatge B3", "Netejar filtres Canon".
   - Paula marca les subtasques com a fetes.
   - Noa revisa i detecta que un filtre ND variable no gira bé. **Crea incidència**: "Filtre ND Hoya 77mm — rosca dura, no gira amb fluïdesa". Severitat: LOW. No afecta sortida d'avui (hi ha recanvi).

---

### 10:30h — Transport

5. **Ferran** (Administració) confirma a l'app que el transport extern per "Rodatge Estrella Damm" arriba a les 10:30h. Marca estat: PENDING_LOAD. Quan el material surt, marca: OUT.

---

### 12:00h — Preparació demà

6. **Cristina** comença a preparar "Documental TV3" amb **Javi** i **Alex**.
   - Crea subtasques: "Preparar flight cases audio", "Verificar bateries FX6", "Embalar trípodes".
   - Javi i Alex marquen tasques.
   - Cristina marca `techValidationRequired = true` perquè hi ha càmera de cinema.
   - Canvia estat: PENDING_TECH_REVIEW.

7. **Marc** rep notificació. Revisa la càmera FX6 (backfocus OK), les òptiques (col·limació OK). Marca `techValidated = true`. Estat passa a PENDING_FINAL_CHECK.

8. **Cristina** fa la revisió final. Comprova la llista completa. `warehouseValidated = true`. Estat: READY.

---

### 16:00h — Devolució

9. Arriba el material de "Curta Festival Sitges". **Noa** ho revisa.
   - Marca cada ítem com a retornat amb la condició.
   - Detecta que falta un cable SDI de 3m. Crea incidència: "Cable SDI BNC 3m no retornat". Marca `requiresClientNotification = true`.
   - **Ferran** rep notificació automàtica. Contacta el client per recuperar el cable.

10. Quan tot queda resolt (cable recuperat o documentat), **Noa** tanca el projecte: estat CLOSED.

---

### 17:30h — Fi de jornada

**Cristina** revisa el Pla del Dia:
- ✅ "Rodatge Estrella Damm" — SORTIT
- ✅ "Sessió fotogràfica Mango" — SORTIT (sortit a les 14:00h)
- ✅ "Documental TV3" — READY per demà a les 8:00h
- ⚠️ "Curta Festival Sitges" — Pendent recuperar cable SDI
- ✅ Incidència CN-E 35mm — RESOLTA
- 📋 Incidència filtre ND Hoya — OBERTA, baixa prioritat, per quan Marc tingui un moment

---

## 10. Integracions amb Mòduls Existents

### 10.1 Rentman
- Importar projectes de Rentman com a RentalProject automàticament
- Vincular `rentmanProjectId` per mantenir traçabilitat
- Sincronitzar llista de material del projecte Rentman → ProjectEquipment

### 10.2 Equipment (Inventari)
- Cada ProjectEquipment pot vincular-se a un Equipment existent
- Les incidències es vinculen a equips de l'inventari
- Quan un equip es bloqueja via incident, el seu `status` a Equipment passa a "BLOCKED"

### 10.3 Clients
- RentalProject es vincula opcionalment a un Client existent
- Reutilitza dades de contacte per comunicacions

### 10.4 Factures Emeses
- Possibilitat futura: vincular projectes amb factures emeses via `projectReference`

---

## 11. Roadmap d'Implementació Suggerit

### Fase 1 — Fonaments (2-3 setmanes)
- Migració Prisma (noves taules)
- API CRUD: RoleDefinition, RoleAssignment, RentalProject
- Pantalla Rols i Personal (gestió bàsica)
- Pantalla Projectes (llista + creació + detall bàsic)

### Fase 2 — Operacions (2-3 setmanes)
- Flux complet de preparació i devolució
- Subtasques (ProjectTask)
- Material del projecte (ProjectEquipment)
- Historial de canvis d'estat
- Pantalla Pla del Dia

### Fase 3 — Incidències i Comunicació (1-2 setmanes)
- CRUD Incidències complet
- Bloqueig d'equips
- Comunicacions internes per projecte
- Sistema de notificacions

### Fase 4 — Protocols i Permisos (1 setmana)
- Pantalla Protocols (wiki editable)
- Matriu de permisos per rol
- Validació de permisos al backend

### Fase 5 — Integracions (1-2 setmanes)
- Import de projectes des de Rentman
- Vinculació amb inventari d'equips
- Alertes automàtiques temporals

---

## 12. Resum de Taules

| Taula | Registres esperats | Relacions principals |
|-------|-------------------|---------------------|
| RoleDefinition | 6 (fixos) | → RoleAssignment, RolePermission |
| RoleAssignment | 5-10 | → User, RoleDefinition |
| RolePermission | ~36 (6 rols × 6 seccions) | → RoleDefinition |
| RentalProject | Creixent (~500/any) | → Client, User, ProjectAssignment, Incident |
| ProjectAssignment | 2-5 per projecte | → RentalProject, User |
| ProjectStatusChange | 3-8 per projecte | → RentalProject |
| ProjectEquipment | 5-30 per projecte | → RentalProject, Equipment |
| ProjectTask | 3-10 per projecte | → RentalProject |
| Incident | Creixent (~100/any) | → RentalProject, Equipment |
| DailyPlan | 1 per dia (~365/any) | — |
| ProjectCommunication | Variable | → RentalProject |
| Protocol | ~10 (editables) | — |
| Notification | Alt volum, purgable | — |
