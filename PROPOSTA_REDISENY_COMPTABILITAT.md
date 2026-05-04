# Redisseny del Mòdul de Comptabilitat — SeitoCamera Admin

**Data:** 3 maig 2026
**Versió:** 1.0 (esborrany inicial)
**Stack:** PostgreSQL + Prisma ORM + Express.js + React
**Objectiu:** Convertir el mòdul de comptabilitat actual (workflow de factures + classificació PGC textual + declaracions trimestrals) en una **comptabilitat formal completa** apta per substituir/donar suport a la gestoria.

---

## 1. Decisions arquitectòniques fixades

Aquestes decisions són el punt de partida i no es revisaran sense motiu.

| # | Decisió | Detall |
|---|---|---|
| D1 | **Una sola empresa comptabilitzada: SEITO** | El repartiment Seito↔Logistik (`SharedPeriodLock`, `isShared`, `sharedPercentSeito/Logistik`) es **manté tal com està avui**. La part de Logistik queda fora de la comptabilitat formal. |
| D2 | **Factura i Assentament són entitats separades vinculades (Opció A)** | La factura conserva els seus camps actuals. Quan es marca com a "comptabilitzada", es genera un `JournalEntry` automàticament. Editar la factura pot disparar re-comptabilització. |
| D3 | **Llibre Diari amb partida doble és el cor del mòdul** | Tot informe (llibre major, sumes i saldos, balanç, P&G, models AEAT) es **deriva del diari**, no de les factures. El diari és l'única font de veritat comptable. |
| D4 | **Pla de comptes jeràrquic (PGC PYMES espanyol)** | Substitueix el camp `pgcAccount` text lliure de `ReceivedInvoice`. Cada subcompte té codi 4-8 dígits, jerarquia grup→subgrup→compte→subcompte i tipus (actiu/passiu/patrimoni/ingrés/despesa). |
| D5 | **Suport multi-exercici amb obertura/tancament** | Cada exercici es pot **bloquejar**. Un cop bloquejat, no es pot crear/editar cap assentament d'aquell exercici sense desbloqueig explícit (per ADMIN). |
| D6 | **Payroll fora de scope** | No hi ha entitat "Treballador" amb fitxa. Si cal registrar dietes/avançaments puntuals, s'assenten directament a 460 sense entitat. |
| D7 | **Analítica per projecte: camp present, lògica post-MVP** | Cada `JournalLine` té un `projectId` opcional (FK a `RentalProject`) des del dia 1. La UI per analítica per projecte es construeix més tard. |
| D8 | **Impost de societats: càlcul simplificat al MVP** | Resultat comptable × tipus impositiu + ajustos manuals (caixa per al diferiment, etc.). Càlcul rigorós (BIN, deduccions, retencions a compte) post-MVP. |
| D9 | **Models fiscals MVP** | 303 (IVA trimestral), 390 (IVA anual), 111 (IRPF trimestral), 347 (operacions amb tercers >3.005,06€), 349 (intracomunitàries). Pendents post-MVP: 130, 190, 180. |
| D10 | **Auditoria total i bloqueig d'exercicis** | Cada CRUD a `JournalEntry`, `JournalLine`, `Invoice*`, `FixedAsset` queda registrat a `AuditLog` amb usuari, timestamp, valor anterior i nou. Bloqueig per `FiscalYear.locked = true`. |
| D11 | **L'agent IA es manté i s'adapta** | El `accountingAgentService` segueix existint, però en lloc de proposar `pgcAccount` text proposa **subcompte concret + esborrany d'assentament complet** que l'usuari accepta o ajusta. |
| D12 | **Migració sense pèrdua de dades** | L'històric de factures/moviments/conciliacions es preserva. Es generen assentaments retroactius per l'exercici en curs. Exercicis anteriors es marquen com a "extracomptables" (només a efectes de consulta). |

---

## 2. Estratègia Factura ↔ Assentament (Opció A en detall)

### 2.1 Estats d'una factura amb la nova lògica

```
DRAFT → REVIEWED → POSTED ←→ PAID/PARTIALLY_PAID
                     ↑
                     └─ JournalEntry generat
```

- **DRAFT** — Acabada de crear (manual o per OCR), encara no revisada.
- **REVIEWED** — Validada per l'usuari (dades, NIF, imports correctes), però **sense assentament**.
- **POSTED** — Té un `JournalEntry` vinculat al diari. A partir d'aquí compta a balanç, IVA, etc.
- **PAID / PARTIALLY_PAID** — Ortogonal a l'estat comptable. Pot ser POSTED i PENDING de cobrar, o POSTED i PARTIALLY_PAID.

### 2.2 Generació automàtica d'assentaments

Quan una factura passa a **POSTED**, el sistema crea un `JournalEntry` amb el patró estàndard.

#### Factura rebuda (servei amb IVA 21% i sense IRPF)

```
Concepte: "Factura nº FRA-2026-001 de Cromalite, S.L."
Data: issueDate de la factura
Línies:
  Deure  629000 (Altres serveis)              ............ 100,00€
  Deure  472000 (H.P. IVA suportat)           ............  21,00€
    Haver 410001 (Cromalite, S.L. - subcompte) ............ 121,00€
```

#### Factura rebuda (servei professional amb IRPF 15%)

```
Concepte: "Factura nº 2026/12 de Joan Pla (advocat)"
Línies:
  Deure  623000 (Serveis professionals)       ............ 1.000,00€
  Deure  472000 (H.P. IVA suportat)           ............   210,00€
    Haver 410015 (Joan Pla - subcompte)       ............ 1.060,00€
    Haver 4751   (H.P. creditora retencions IRPF) .........   150,00€
```

#### Factura rebuda d'inversió (immobilitzat material)

```
Concepte: "Factura nº FA-345 de Foto Casanova (càmera Sony FX6)"
Línies:
  Deure  217000 (Equips processos d'informació) ........ 5.000,00€
  Deure  472000 (H.P. IVA suportat)             ........ 1.050,00€
    Haver 410023 (Foto Casanova - subcompte)    ........ 6.050,00€

→ A més: es crea automàticament un FixedAsset i el seu calendari d'amortització.
```

#### Factura emesa (servei amb IVA)

```
Concepte: "Factura nº F2026/045 a Mango (sessió fotogràfica)"
Línies:
  Deure  430001 (Mango España - subcompte)    ............ 2.420,00€
    Haver 705000 (Prestacions de serveis)     ............ 2.000,00€
    Haver 477000 (H.P. IVA repercutit)        ............   420,00€
```

#### Cobrament d'una factura emesa (al conciliar moviment bancari)

```
Concepte: "Cobrament factura F2026/045 - transferència Mango"
Línies:
  Deure  572001 (Banc Qonto principal)        ............ 2.420,00€
    Haver 430001 (Mango España)               ............ 2.420,00€
```

#### Pagament d'una factura rebuda

```
Concepte: "Pagament factura FRA-2026-001 a Cromalite"
Línies:
  Deure  410001 (Cromalite, S.L.)             ............ 121,00€
    Haver 572001 (Banc Qonto principal)       ............ 121,00€
```

### 2.3 Re-comptabilització

Si una factura POSTED s'edita, el sistema:

1. **Anul·la** l'assentament anterior (no l'esborra: crea un assentament invers o el marca com `REVERSED` amb FK al nou).
2. **Crea** un nou `JournalEntry` amb les dades actualitzades.
3. Tot queda traçat a `AuditLog` (qui, quan, què va canviar).

Si l'exercici de la factura ja està **bloquejat**, l'edició està bloquejada. Cal desbloqueig explícit.

---

## 3. Schema Prisma — models nous

### 3.1 `Company` — Dades de l'empresa

```prisma
model Company {
  id              String    @id @default(cuid())
  legalName       String                                  // "SEITO CAMERA, S.L."
  commercialName  String?                                 // "SeitoCamera"
  nif             String    @unique                       // "B12345678"
  address         String?
  postalCode      String?
  city            String?
  province        String?
  country         String    @default("ES")
  phone           String?
  email           String?
  website         String?

  // Configuració comptable
  fiscalYearStartMonth Int  @default(1)                   // 1=gener
  defaultCurrency      String @default("EUR")
  defaultVatRate       Decimal @default(21) @db.Decimal(5, 2)
  defaultIrpfRate      Decimal @default(15) @db.Decimal(5, 2)
  corporateTaxRate     Decimal @default(25) @db.Decimal(5, 2) // tipus IS

  // Configuració AEAT
  aeatRegime           String  @default("GENERAL")        // "GENERAL", "RECARGO_EQUIVALENCIA", etc.
  is347Threshold       Decimal @default(3005.06) @db.Decimal(12, 2)
  vatPeriod            String  @default("QUARTERLY")      // "QUARTERLY" o "MONTHLY"

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relacions
  fiscalYears     FiscalYear[]

  @@map("companies")
}
```

> **Nota:** Encara que avui hi ha una sola empresa, el model permet ampliar a multi-empresa més endavant (Logistik com a empresa pròpia, p. ex.). Tots els models comptables porten `companyId`.

### 3.2 `FiscalYear` — Exercicis comptables

```prisma
model FiscalYear {
  id              String    @id @default(cuid())
  companyId       String
  year            Int                                     // 2026
  startDate       DateTime                                // 2026-01-01
  endDate         DateTime                                // 2026-12-31
  status          FiscalYearStatus @default(OPEN)         // OPEN, CLOSING, CLOSED
  locked          Boolean   @default(false)               // No es pot afegir/editar res
  lockedAt        DateTime?
  lockedById      String?

  // Resultats del tancament (omplerts en CLOSED)
  totalRevenue    Decimal?  @db.Decimal(14, 2)
  totalExpenses   Decimal?  @db.Decimal(14, 2)
  netResult       Decimal?  @db.Decimal(14, 2)            // Resultat exercici (129)
  corporateTax    Decimal?  @db.Decimal(14, 2)            // IS calculat

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relacions
  company         Company   @relation(fields: [companyId], references: [id])
  journalEntries  JournalEntry[]
  lockedBy        User?     @relation("fiscalYearLocked", fields: [lockedById], references: [id])

  @@unique([companyId, year])
  @@index([status])
  @@map("fiscal_years")
}

enum FiscalYearStatus {
  OPEN          // Es poden crear/editar assentaments
  CLOSING       // En procés de tancament (regularització)
  CLOSED        // Tancat, només lectura
}
```

### 3.3 `ChartOfAccount` — Pla comptable

```prisma
model ChartOfAccount {
  id              String    @id @default(cuid())
  companyId       String
  code            String                                  // "629000", "430001"
  name            String                                  // "Altres serveis"
  description     String?

  // Jerarquia
  parentId        String?                                 // Compte pare (629 → 6290)
  level           Int       @default(0)                   // 0=grup, 1=subgrup, 2=compte, 3=subcompte
  isLeaf          Boolean   @default(true)                // Si es pot usar a apunts

  // Classificació
  type            AccountType                             // ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
  subtype         String?                                 // "CURRENT_ASSET", "FIXED_ASSET", "VAT_INPUT", etc.

  // Configuració
  isActive        Boolean   @default(true)
  isSystem        Boolean   @default(false)               // Compte del sistema (no editable)
  defaultVatRate  Decimal?  @db.Decimal(5, 2)             // IVA per defecte si s'usa en factura
  taxBookType     String?                                 // "VAT_INPUT", "VAT_OUTPUT", "IRPF" (per llibres)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relacions
  parent          ChartOfAccount?  @relation("AccountHierarchy", fields: [parentId], references: [id])
  children        ChartOfAccount[] @relation("AccountHierarchy")
  journalLines    JournalLine[]

  @@unique([companyId, code])
  @@index([type])
  @@index([parentId])
  @@map("chart_of_accounts")
}

enum AccountType {
  ASSET           // Actiu (grups 1, 2, 3, 4 deutor, 5 deutor)
  LIABILITY       // Passiu (grups 1, 4 creditor, 5 creditor)
  EQUITY          // Patrimoni net (grup 1, 12)
  INCOME          // Ingressos (grup 7)
  EXPENSE         // Despeses (grup 6)
}
```

> **Seed inicial:** El sistema vindrà amb els ~80 subcomptes essencials del PGC PYMES (vegeu §6) precarregats i marcats com a `isSystem=true`. L'usuari pot afegir subcomptes nous (típicament 4xxxxx per cada client/proveïdor) però no esborrar els del sistema.

### 3.4 `JournalEntry` — Assentaments del Llibre Diari

```prisma
model JournalEntry {
  id              String    @id @default(cuid())
  companyId       String
  fiscalYearId    String
  entryNumber     Int                                     // Correlatiu dins de l'exercici (1, 2, 3...)

  date            DateTime                                // Data comptable
  description     String                                  // Concepte breu

  // Origen
  type            JournalEntryType                        // Tipus d'assentament
  source          JournalEntrySource @default(MANUAL)     // Com s'ha creat
  sourceRef       String?                                 // FK polimòrfic: invoice ID, movement ID, etc.

  // Vincles directes opcionals (més pràctics que polimòrfic per consultes)
  receivedInvoiceId  String?
  issuedInvoiceId    String?
  bankMovementId     String?
  fixedAssetId       String?

  // Estat
  status          JournalEntryStatus @default(DRAFT)      // DRAFT, POSTED, REVERSED
  reversedById    String?                                 // Si REVERSED: FK a l'assentament que el corregeix
  reversesId      String?                                 // Si correu d'inversió: FK al que anul·la

  // Auditoria bàsica (la completa va a AuditLog)
  createdById     String
  createdAt       DateTime  @default(now())
  postedById      String?
  postedAt        DateTime?
  updatedAt       DateTime  @updatedAt

  // Relacions
  company         Company         @relation(fields: [companyId], references: [id])
  fiscalYear      FiscalYear      @relation(fields: [fiscalYearId], references: [id])
  lines           JournalLine[]
  receivedInvoice ReceivedInvoice? @relation(fields: [receivedInvoiceId], references: [id])
  issuedInvoice   IssuedInvoice?   @relation(fields: [issuedInvoiceId], references: [id])
  bankMovement    BankMovement?    @relation(fields: [bankMovementId], references: [id])
  fixedAsset      FixedAsset?      @relation(fields: [fixedAssetId], references: [id])
  reversedBy      JournalEntry?    @relation("JournalEntryReversal", fields: [reversedById], references: [id])
  reversed        JournalEntry?    @relation("JournalEntryReversal")
  createdBy       User             @relation("journalCreated", fields: [createdById], references: [id])
  postedBy        User?            @relation("journalPosted", fields: [postedById], references: [id])

  @@unique([companyId, fiscalYearId, entryNumber])
  @@index([date])
  @@index([type])
  @@index([status])
  @@index([fiscalYearId, date])
  @@map("journal_entries")
}

enum JournalEntryType {
  RECEIVED_INVOICE      // Factura rebuda
  ISSUED_INVOICE        // Factura emesa
  PAYMENT               // Pagament a proveïdor
  COLLECTION            // Cobrament de client
  BANK_TRANSFER         // Transferència entre comptes
  BANK_FEE              // Comissió bancària
  AMORTIZATION          // Quota d'amortització mensual
  PAYROLL               // Nòmina (futur)
  TAX_PAYMENT           // Pagament d'impostos (303, 111, IS)
  TAX_ACCRUAL           // Devengament d'impostos (regularització IVA, IS)
  YEAR_CLOSING          // Tancament d'exercici
  YEAR_OPENING          // Obertura d'exercici
  ADJUSTMENT            // Ajust manual (regularitzacions, etc.)
  OTHER                 // Manual lliure
}

enum JournalEntrySource {
  MANUAL                // Creat manualment per l'usuari
  AUTO_INVOICE          // Generat des d'una factura
  AUTO_BANK             // Generat des d'una conciliació
  AUTO_AMORTIZATION     // Generat per la rutina d'amortització
  AUTO_CLOSING          // Generat pel procés de tancament
  AGENT                 // Suggerit i acceptat des de l'agent IA
}

enum JournalEntryStatus {
  DRAFT                 // Esborrany, encara no comptabilitzat
  POSTED                // Llançat al diari (definitiu)
  REVERSED              // Anul·lat per un assentament d'inversió
}
```

### 3.5 `JournalLine` — Apunts (línies d'assentament)

```prisma
model JournalLine {
  id              String    @id @default(cuid())
  journalEntryId  String
  accountId       String                                  // FK a ChartOfAccount

  // Imports — un dels dos és 0
  debit           Decimal   @default(0) @db.Decimal(14, 2)
  credit          Decimal   @default(0) @db.Decimal(14, 2)

  // Detall opcional
  description     String?                                 // Concepte de la línia (si difereix de l'assentament)
  counterpartyId  String?                                 // FK a Supplier o Client (per major analític)
  counterpartyType String?                                // "SUPPLIER" o "CLIENT"

  // Analítica per projecte (post-MVP, però camp ja present)
  projectId       String?                                 // FK opcional a RentalProject

  // Camps fiscals (per al càlcul del 303/390 sense haver de recórrer a la factura)
  vatRate         Decimal?  @db.Decimal(5, 2)             // % IVA aplicat (si la línia és de IVA)
  vatBase         Decimal?  @db.Decimal(14, 2)            // Base imposable associada
  irpfRate        Decimal?  @db.Decimal(5, 2)
  irpfBase        Decimal?  @db.Decimal(14, 2)

  // Ordre dins de l'assentament
  sortOrder       Int       @default(0)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relacions
  journalEntry    JournalEntry    @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  account         ChartOfAccount  @relation(fields: [accountId], references: [id])
  project         RentalProject?  @relation(fields: [projectId], references: [id])

  @@index([journalEntryId])
  @@index([accountId])
  @@index([projectId])
  @@map("journal_lines")
}
```

> **Validació de quadrament:** Sempre que un `JournalEntry` passi a status `POSTED`, el backend valida que `SUM(debit) === SUM(credit)` per totes les línies. Si no quadra, retorna error i no es passa de DRAFT.

### 3.6 `FixedAsset` — Immobilitzat

```prisma
model FixedAsset {
  id              String    @id @default(cuid())
  companyId       String
  code            String                                  // Codi intern: "FA-2026-001"
  name            String                                  // "Sony FX6 + Kit"
  description     String?

  // Vincles
  equipmentId     String?                                 // FK opcional a Equipment existent
  receivedInvoiceId String?                               // Factura d'origen
  accountId       String                                  // Subcompte d'immobilitzat (213, 217, etc.)
  amortizationAccountId String                            // Subcompte amortització acumulada (281x)
  expenseAccountId      String                            // Subcompte despesa amortització (681x)

  // Dades de l'actiu
  acquisitionDate DateTime                                // Data de compra
  acquisitionValue Decimal  @db.Decimal(14, 2)            // Valor d'adquisició
  residualValue   Decimal   @default(0) @db.Decimal(14, 2) // Valor residual estimat

  // Amortització
  usefulLifeYears Decimal   @db.Decimal(5, 2)             // Anys de vida útil
  amortizationMethod String @default("LINEAR")            // "LINEAR" (futur: degressiu)
  monthlyAmortization Decimal @db.Decimal(14, 2)          // Calculat: (val.adq - val.res) / vida_anys / 12

  // Estat
  status          FixedAssetStatus @default(ACTIVE)       // ACTIVE, FULLY_AMORTIZED, DISPOSED
  disposalDate    DateTime?
  disposalNotes   String?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // Relacions
  company         Company           @relation(fields: [companyId], references: [id])
  equipment       Equipment?        @relation(fields: [equipmentId], references: [id])
  receivedInvoice ReceivedInvoice?  @relation(fields: [receivedInvoiceId], references: [id])
  account         ChartOfAccount    @relation("FixedAssetAccount", fields: [accountId], references: [id])
  amortizationAccount ChartOfAccount @relation("AmortizationAccumAccount", fields: [amortizationAccountId], references: [id])
  expenseAccount  ChartOfAccount    @relation("AmortizationExpenseAccount", fields: [expenseAccountId], references: [id])
  amortizationEntries AmortizationEntry[]
  journalEntries  JournalEntry[]

  @@unique([companyId, code])
  @@index([equipmentId])
  @@index([status])
  @@map("fixed_assets")
}

enum FixedAssetStatus {
  ACTIVE
  FULLY_AMORTIZED
  DISPOSED                // Donat de baixa (venda, baixa, robatori)
}
```

### 3.7 `AmortizationEntry` — Calendari d'amortitzacions

```prisma
model AmortizationEntry {
  id              String    @id @default(cuid())
  fixedAssetId    String

  year            Int                                     // 2026
  month           Int                                     // 1-12
  amount          Decimal   @db.Decimal(14, 2)            // Quota del període
  accumulated     Decimal   @db.Decimal(14, 2)            // Amortització acumulada al final del període
  netValue        Decimal   @db.Decimal(14, 2)            // Valor net comptable resultant

  // Comptabilització
  status          String    @default("PENDING")           // PENDING, POSTED
  journalEntryId  String?                                 // Assentament generat (si POSTED)
  postedAt        DateTime?

  createdAt       DateTime  @default(now())

  // Relacions
  fixedAsset      FixedAsset @relation(fields: [fixedAssetId], references: [id], onDelete: Cascade)

  @@unique([fixedAssetId, year, month])
  @@index([year, month, status])
  @@map("amortization_entries")
}
```

### 3.8 `AuditLog` — Traçabilitat universal

```prisma
model AuditLog {
  id              String    @id @default(cuid())
  companyId       String?

  // Què
  entityType      String                                  // "JournalEntry", "ReceivedInvoice", "FixedAsset", etc.
  entityId        String                                  // ID de l'entitat afectada
  action          String                                  // "CREATE", "UPDATE", "DELETE", "POST", "REVERSE", "LOCK"

  // Diferències (snapshot abans/després)
  beforeData      Json?
  afterData       Json?
  changedFields   String[]  @default([])                  // Llista de camps modificats

  // Qui i quan
  userId          String
  userEmail       String?                                 // Snapshot per si l'usuari es desactiva
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime  @default(now())

  // Relacions
  user            User      @relation(fields: [userId], references: [id])

  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### 3.9 `TaxBookEntry` — Llibres registre IVA (suportat / repercutit)

> **Decisió:** Aquesta taula és **opcional** i es pot derivar de les línies d'assentament que tinguin `vatRate IS NOT NULL`. Però materialitzar-la dóna molt millor performance per als llibres formals i les exportacions AEAT. Recomanació: implementar-la com a vista materialitzada o com a taula real actualitzada per trigger.

```prisma
model TaxBookEntry {
  id              String    @id @default(cuid())
  companyId       String
  fiscalYearId    String

  bookType        TaxBookType                             // VAT_INPUT, VAT_OUTPUT, IRPF
  date            DateTime                                // Data factura
  documentNumber  String                                  // Nº factura
  counterpartyName String                                 // Nom client/proveïdor
  counterpartyNif  String?

  base            Decimal   @db.Decimal(14, 2)
  vatRate         Decimal   @db.Decimal(5, 2)
  vatAmount       Decimal   @db.Decimal(14, 2)
  irpfRate        Decimal   @default(0) @db.Decimal(5, 2)
  irpfAmount      Decimal   @default(0) @db.Decimal(14, 2)
  total           Decimal   @db.Decimal(14, 2)

  // Vincles
  journalEntryId  String?
  invoiceId       String?                                 // Factura rebuda o emesa
  invoiceType     String?                                 // "RECEIVED" o "ISSUED"

  createdAt       DateTime  @default(now())

  @@index([fiscalYearId, bookType, date])
  @@map("tax_book_entries")
}

enum TaxBookType {
  VAT_INPUT       // IVA suportat (factures rebudes)
  VAT_OUTPUT      // IVA repercutit (factures emeses)
  IRPF            // Retencions practicades a tercers
}
```

---

## 4. Modificacions a models existents

### 4.1 `ReceivedInvoice` — afegits

```prisma
// Afegir aquests camps:
companyId         String?                                  // FK a Company
journalEntryId    String?  @unique                         // Assentament generat (si POSTED)
accountId         String?                                  // ChartOfAccount: subcompte de despesa o immobilitzat (substitueix pgcAccount text)
counterpartyAccountId String?                              // Subcompte 410xxx del proveïdor
fixedAssetId      String?                                  // Si genera immobilitzat
postedAt          DateTime?

// Mantenir existents (pgcAccount, pgcAccountName, etc.) durant la migració,
// després deprecar-los en favor de accountId / FixedAsset.

// Nova relació:
journalEntry      JournalEntry?    @relation(fields: [journalEntryId], references: [id])
account           ChartOfAccount?  @relation("ReceivedInvoiceAccount", fields: [accountId], references: [id])
counterpartyAccount ChartOfAccount? @relation("ReceivedInvoiceCounterparty", fields: [counterpartyAccountId], references: [id])
fixedAssetGenerated FixedAsset?    @relation
```

### 4.2 `IssuedInvoice` — afegits

```prisma
companyId         String?
journalEntryId    String?  @unique
accountId         String?                                  // Subcompte d'ingrés (700, 705, etc.)
counterpartyAccountId String?                              // Subcompte 430xxx del client
postedAt          DateTime?

journalEntry      JournalEntry?    @relation(fields: [journalEntryId], references: [id])
account           ChartOfAccount?  @relation("IssuedInvoiceAccount", fields: [accountId], references: [id])
counterpartyAccount ChartOfAccount? @relation("IssuedInvoiceCounterparty", fields: [counterpartyAccountId], references: [id])
```

### 4.3 `BankMovement` — afegits

```prisma
journalEntryId    String?  @unique                         // Assentament generat (si comptabilitzat)
accountId         String?                                  // Subcompte 572 del banc

journalEntry      JournalEntry?    @relation(fields: [journalEntryId], references: [id])
account           ChartOfAccount?  @relation("BankMovementAccount", fields: [accountId], references: [id])
```

### 4.4 `BankAccount` — afegits

```prisma
accountId         String   @unique                         // Subcompte 572xxx associat a aquest compte bancari

account           ChartOfAccount   @relation(fields: [accountId], references: [id])
```

### 4.5 `Supplier` — afegits

```prisma
defaultExpenseAccountId String?                            // Subcompte despesa habitual (629, 623, etc.)
counterpartyAccountId   String?  @unique                   // Subcompte 410xxx propi del proveïdor

defaultExpenseAccount   ChartOfAccount? @relation("SupplierDefaultExpense", fields: [defaultExpenseAccountId], references: [id])
counterpartyAccount     ChartOfAccount? @relation("SupplierCounterparty", fields: [counterpartyAccountId], references: [id])
```

### 4.6 `Client` — afegits

```prisma
defaultRevenueAccountId String?                            // Subcompte ingrés habitual (705, 700, etc.)
counterpartyAccountId   String?  @unique                   // Subcompte 430xxx propi del client

defaultRevenueAccount   ChartOfAccount? @relation("ClientDefaultRevenue", fields: [defaultRevenueAccountId], references: [id])
counterpartyAccount     ChartOfAccount? @relation("ClientCounterparty", fields: [counterpartyAccountId], references: [id])
```

### 4.7 `User` — afegits per auditoria/diari

```prisma
journalEntriesCreated  JournalEntry[] @relation("journalCreated")
journalEntriesPosted   JournalEntry[] @relation("journalPosted")
fiscalYearsLocked      FiscalYear[]   @relation("fiscalYearLocked")
auditLogs              AuditLog[]
```

---

## 5. Models que es mantenen sense canvis (o canvis mínims)

- `SharedPeriodLock`, repartiment Seito↔Logistik (`isShared`, `sharedPercentSeito/Logistik`, `origin`, `paidBy`) — **es manté literalment com és**.
- `Conciliation` — es manté. La novetat és que en confirmar una conciliació, **a més** es genera un `JournalEntry` de cobrament/pagament.
- `CounterpartyMap`, `CommissionRule` — es mantenen.
- `AgentRule`, `AgentJob`, `AgentSuggestion` — es mantenen. Les `AgentSuggestion` evolucionen: en lloc de suggerir `pgcAccount` text, suggereixen `accountId` (FK) i, opcionalment, l'**esborrany complet de l'assentament**.
- `SupplierTemplate` — es manté (és per a OCR, no comptabilitat).
- `ReminderLog`, `Reminder`, `Note` — es mantenen.
- Tot el mòdul d'**operacions** (RentalProject, Incident, etc.) — sense canvis, però `JournalLine` pot opcionalment apuntar a `RentalProject.id` per analítica.

---

## 6. Pla de comptes inicial (PGC PYMES espanyol)

Es seedarà la taula `ChartOfAccount` amb aquests subcomptes mínims (~85 entrades). L'usuari pot afegir-ne més; els del sistema són `isSystem=true` i no es poden esborrar.

### Grup 1 — Finançament bàsic
- `100` Capital
- `112` Reserva legal
- `113` Reserves voluntàries
- `120` Romanent
- `121` Resultats negatius d'exercicis anteriors
- `129` Resultat de l'exercici

### Grup 2 — Actiu no corrent (immobilitzat)
- `213` Maquinària
- `216` Mobiliari
- `217` Equips per a processos d'informació
- `218` Elements de transport
- `219` Altre immobilitzat material
- `2813` Amortització acumulada de maquinària
- `2816` Amortització acumulada de mobiliari
- `2817` Amortització acumulada d'equips per a processos d'informació
- `2818` Amortització acumulada d'elements de transport
- `2819` Amortització acumulada d'altre immobilitzat material

### Grup 4 — Creditors i deutors
- `400` Proveïdors
- `4000xxxx` (subcomptes per proveïdor) — generats dinàmicament
- `410` Creditors per prestació de serveis
- `4100xxxx` (subcomptes per creditor)
- `430` Clients
- `4300xxxx` (subcomptes per client)
- `432` Clients, factura pendent emetre
- `460` Avançaments de remuneracions
- `465` Remuneracions pendents de pagament
- `472` H.P. IVA suportat
- `4709` H.P. deutora per IVA
- `4750` H.P. creditora per IVA
- `4751` H.P. creditora per retencions practicades
- `4752` H.P. creditora per Impost de societats
- `477` H.P. IVA repercutit

### Grup 5 — Comptes financers
- `570` Caixa
- `572` Bancs c/c (un subcompte per cada `BankAccount`: `5720001`, `5720002`...)
- `5230` Préstecs a curt termini

### Grup 6 — Compres i despeses
- `621` Arrendaments i cànons
- `622` Reparacions i conservació
- `623` Serveis professionals independents
- `624` Transports
- `625` Primes d'assegurances
- `626` Serveis bancaris i similars
- `627` Publicitat, propaganda i RR.PP.
- `628` Subministraments
- `629` Altres serveis
- `631` Altres tributs
- `640` Sous i salaris (sense ús actiu, payroll fora)
- `642` Seguretat social a càrrec empresa
- `669` Altres despeses financeres
- `678` Despeses excepcionals
- `681` Amortització de l'immobilitzat material
- `694` Pèrdues per deteriorament de crèdits comercials

### Grup 7 — Vendes i ingressos
- `700` Vendes de mercaderies
- `705` Prestacions de serveis (lloguer d'equip principal de Seito)
- `759` Ingressos per serveis diversos
- `769` Altres ingressos financers
- `778` Ingressos excepcionals

### Comptes especials per al càlcul de l'IS
- `630` Impost sobre beneficis
- `4752` H.P. creditora per Impost de societats

---

## 7. Comportament dels processos clau

### 7.1 Creació d'una factura rebuda

```
1. Usuari puja PDF (o arriba per email/Drive).
2. OCR extreu dades → ReceivedInvoice status=DRAFT.
3. Agent IA suggereix:
   - account: subcompte despesa més probable
   - counterpartyAccount: subcompte 410xxx del proveïdor (es crea automàticament la primera vegada)
   - Si confiança alta → estat REVIEWED automàtic
4. Usuari revisa, ajusta si cal, prem "Comptabilitzar".
5. Backend valida: dades completes, exercici no bloquejat, comptes vàlids.
6. Es crea JournalEntry amb les línies de §2.2.
7. Estat passa a POSTED.
8. Si era inversió (compte grup 2x): es crea FixedAsset + calendari d'amortització.
9. Auditoria: registre a AuditLog.
```

### 7.2 Conciliació d'un cobrament

```
1. Moviment bancari arriba via QontoSync (BankMovement creat).
2. Conciliació proposa match amb factura emesa pendent.
3. Usuari confirma → Conciliation status=CONFIRMED.
4. **Nou:** Es crea JournalEntry tipus COLLECTION:
     Deure 572xxxx (Banc) ............ totalAmount
       Haver 4300xxxx (Client) ....... totalAmount
5. Es marca IssuedInvoice.status=PAID (o paidAmount += parcial).
6. Auditoria.
```

### 7.3 Tancament de mes (rutina automàtica)

```
Dia 1 de cada mes, un job:
1. Per cada FixedAsset ACTIVE:
   - Calcula AmortizationEntry del mes anterior.
   - Crea JournalEntry tipus AMORTIZATION:
       Deure 681x (despesa) ............ monthly
         Haver 281x (acum.) ............ monthly
   - Marca AmortizationEntry com POSTED.
2. Email/notificació de resum a l'usuari.
```

### 7.4 Tancament d'exercici

```
Procés guiat (UI específica):
1. FiscalYear status passa a CLOSING.
2. Verificacions: totes les factures POSTED, totes les conciliacions OK,
   totes les amortitzacions del 12è mes generades.
3. Càlcul de regularització IVA del 4t trimestre.
4. Càlcul del resultat: SUM(Grup 7) - SUM(Grup 6).
5. Càlcul d'IS simplificat: resultat × 25% → assentament 630/4752.
6. Assentament de tancament: traspàs comptes 6 i 7 a 129.
7. FiscalYear status=CLOSED, locked=true.
8. Genera assentament d'obertura de l'exercici següent (sumes i saldos d'actius/passius).
```

---

## 8. Matriu de migració des del schema actual

| Entitat actual | Acció | Detall |
|---|---|---|
| `Supplier` | Conservar + ampliar | Afegir `counterpartyAccountId` (genera `4100xxxx` per a cada proveïdor). |
| `Client` | Conservar + ampliar | Afegir `counterpartyAccountId` (genera `4300xxxx` per a cada client). |
| `ReceivedInvoice` | Conservar + ampliar + backfill | Camp `pgcAccount` (text) → mapejar a `accountId` (FK). Generar `JournalEntry` retroactiu per cada factura de l'exercici en curs. |
| `IssuedInvoice` | Conservar + ampliar + backfill | Igual. |
| `BankAccount` | Conservar + ampliar | Crear subcompte `572xxxx` per cada compte. |
| `BankMovement` | Conservar + backfill | Per als ja conciliats, generar `JournalEntry` de cobrament/pagament retroactiu. |
| `Conciliation` | Conservar | El flux nou afegirà generació d'assentament al confirmar. |
| `SharedPeriodLock` + camps `isShared`/`origin`/`paidBy` | **No tocar** | Funciona com avui. |
| `AgentRule`, `AgentJob` | Conservar | Sense canvis. |
| `AgentSuggestion` | Adaptar | El JSON `suggestedValue` evoluciona: en lloc de `{ pgcAccount: "629", ... }` ara és `{ accountId: "...", journalDraft: {...} }`. |
| `pgcAccount` / `pgcAccountName` text | **Deprecar** | Mantenir camps un exercici complet per consultes històriques, després esborrar. |
| `accountingType` (EXPENSE/INVESTMENT) | Deprecar | Es deriva del `type` del `ChartOfAccount` (EXPENSE vs ASSET). |

### 8.1 Backfill — algoritme

```
Per cada exercici amb dades (començar pel 2026 actual):
  1. Crear FiscalYear si no existeix.
  2. Per cada ReceivedInvoice POSTED en aquest exercici:
       a. Resoldre accountId del pgcAccount actual (mapping manual o suggerit per agent).
       b. Resoldre counterpartyAccountId (crear 410xxxx si cal).
       c. Generar JournalEntry tipus RECEIVED_INVOICE amb les línies estàndard.
       d. Vincular receivedInvoice.journalEntryId.
  3. Igual per IssuedInvoice.
  4. Per cada BankMovement conciliat:
       a. Generar JournalEntry tipus COLLECTION o PAYMENT.
  5. Validar que sumes de Diari quadren amb sumes de factures (test de coherència).
  6. Si tot OK, marcar com a "migrat".

Exercicis anteriors: opcional. Es poden marcar com "extracomptables"
(consulta sí, no entren al diari formal).
```

---

## 9. Estructura de pantalles (UI)

### 9.1 Sidebar — secció "Comptabilitat" reorganitzada

```
🏢 Empresa
   ├── Dades fiscals
   ├── Exercicis comptables
   └── Pla de comptes

👥 Tercers
   ├── Clients
   ├── Proveïdors
   ├── Bancs
   └── Comptes públics (AEAT, Generalitat, SS...)  ← com a "proveïdors especials" amb fitxa simplificada

📄 Facturació
   ├── Factures emeses
   ├── Factures rebudes
   ├── Compartides Seito↔Logistik   ← intacte
   └── Recordatoris de cobrament

📓 Comptabilitat
   ├── Llibre diari
   ├── Llibre major
   ├── Sumes i saldos
   ├── Nou assentament manual
   └── Comptes pendents de comptabilitzar  ← cua de DRAFT

🏦 Banc i tresoreria
   ├── Comptes bancaris
   ├── Moviments bancaris
   ├── Conciliació
   └── Previsió de tresoreria  ← post-MVP

🧾 Impostos
   ├── IVA suportat (llibre)
   ├── IVA repercutit (llibre)
   ├── Models AEAT  ← 303, 390, 111, 347, 349
   ├── Retencions IRPF
   └── Impost de societats

📦 Actius i amortitzacions
   ├── Immobilitzat
   └── Calendari d'amortitzacions

📊 Informes
   ├── Balanç de situació
   ├── Compte de pèrdues i guanys
   ├── Clients pendents de cobrar
   ├── Proveïdors pendents de pagar
   └── IVA pendent de liquidar

🤖 Agent IA
   ├── Chat
   ├── Regles
   └── Supervisor

🔍 Auditoria
   └── Historial de canvis
```

### 9.2 Pantalles noves clau

| Pantalla | Funcionalitat principal |
|---|---|
| **Dades fiscals** | Editor del registre `Company` (NIF, adreça, configuració IVA/IRPF/IS). |
| **Exercicis comptables** | Llista d'exercicis (any, estat, dates), botons obrir/tancar/desbloquejar. |
| **Pla de comptes** | Arbre jeràrquic dels subcomptes, creació de nous, import/export. |
| **Llibre diari** | Taula de tots els assentaments amb filtres (data, tipus, status, compte). Click → detall. |
| **Llibre major** | Per un compte triat: tots els apunts, saldo a cada data. |
| **Sumes i saldos** | Taula amb tots els comptes amb deure, haver, saldo deutor, saldo creditor. Filtre per nivell de jerarquia. |
| **Nou assentament manual** | Editor amb capçalera (data, descripció) + línies (compte, deure, haver). Validació de quadrament en temps real. |
| **Cua a comptabilitzar** | Llista de factures REVIEWED encara no POSTED. Botó massiu "Comptabilitzar totes". |
| **Immobilitzat** | Llista de FixedAssets amb valor net actual i amortització acumulada. |
| **Calendari d'amortitzacions** | Vista mensual de les quotes pendents/llançades. |
| **Balanç de situació** | Actiu / Passiu+PN a una data triada. Comparativa exercici anterior. |
| **Compte P&G** | Ingressos - Despeses ordenats. Comparativa. |
| **Auditoria** | Cerca per entitat, usuari, data. Diff abans/després. |

### 9.3 Pantalles existents que es modifiquen

- **ReceivedInvoices.jsx** — afegir columna "Compte", "Comptabilitzada (sí/no)", botó "Comptabilitzar".
- **IssuedInvoices.jsx** — igual.
- **Conciliation.jsx** — al confirmar, mostrar visualment l'assentament generat.
- **AccountingAgent.jsx** — el suggeriment ja no és text, és previsualització d'un assentament editable.
- **Fiscal.jsx** — reorganitzar; ara és la fitxa de "Models AEAT".
- **DashboardComptabilitat.jsx** — afegir cards: "Saldo de tresoreria", "Resultat de l'exercici en curs", "IVA pendent del trimestre".

---

## 10. Fasing del MVP

Cada sprint és una unitat completa que es pot llançar a producció. Tots els sprints conserven el funcionament actual; el nou es va activant per sobre.

### Sprint 1 — Fonaments (1.5 setmanes)
**Què entra:**
- Migració Prisma: `Company`, `FiscalYear`, `ChartOfAccount`, `AuditLog`.
- Seed PGC PYMES (~85 subcomptes).
- API CRUD + UI bàsica per a Empresa, Exercicis, Pla de comptes.
- Generació automàtica de subcomptes 410xxxx i 430xxxx per cada Supplier/Client existent.

**Surt a producció:** Sí, no afecta cap flux existent.

### Sprint 2 — Llibre Diari (2 setmanes)
**Què entra:**
- Migració: `JournalEntry`, `JournalLine`.
- API CRUD complet, validació de quadrament Deure=Haver.
- UI: Llibre diari, Llibre major, Sumes i saldos, Nou assentament manual.

**Surt a producció:** Sí, però encara cap factura genera assentaments — ús només manual.

### Sprint 3 — Comptabilització de factures (2 setmanes)
**Què entra:**
- Modificacions a `ReceivedInvoice`/`IssuedInvoice` (camps nous, FK a JournalEntry).
- Lògica: factura REVIEWED → "Comptabilitzar" → genera JournalEntry.
- Adaptació de l'agent IA: ara suggereix `accountId` + draft d'assentament.
- Backfill per a l'exercici 2026 (amb script `npm run accounting:backfill`).

**Surt a producció:** Sí. A partir d'aquí, tot ingrés/despesa nou ja queda al diari.

### Sprint 4 — Comptabilització bancària (1.5 setmanes)
**Què entra:**
- Modificacions a `BankMovement`/`BankAccount` (camps nous).
- Subcompte 572xxxx automàtic per cada compte bancari.
- En confirmar Conciliation → generar JournalEntry de COLLECTION/PAYMENT.
- Comissions bancàries (CommissionRule actual) també generen assentament.
- Backfill de moviments conciliats existents.

**Surt a producció:** Sí. A partir d'aquí, el saldo del 572 reflecteix el del banc.

### Sprint 5 — Llibres IVA + Models AEAT reescrits (2 setmanes)
**Què entra:**
- Migració: `TaxBookEntry`.
- Trigger/job de manteniment de TaxBookEntry des de JournalLine.
- Reescriure `fiscalService` per calcular 303, 390, 111, 347, 349 sobre el llibre diari (no sobre les factures directament).
- UI: Llibres IVA suportat/repercutit, exportació Excel.

**Surt a producció:** Sí. Es podrà comparar el resultat dels models nous amb els antics durant un trimestre per validar.

### Sprint 6 — Immobilitzat i amortitzacions (2 setmanes)
**Què entra:**
- Migració: `FixedAsset`, `AmortizationEntry`.
- Lògica: factura amb `account.type=ASSET` → genera FixedAsset + calendari.
- Job mensual d'amortització (el 1r dia de cada mes).
- Vinculació opcional amb `Equipment` existent.
- UI: Immobilitzat, calendari, valor net per actiu.

**Surt a producció:** Sí.

### Sprint 7 — Tancament d'exercici i Impost de societats (2 setmanes)
**Què entra:**
- UI guiada de tancament (checklist, regularitzacions).
- Càlcul d'IS simplificat (resultat × 25% + ajustos manuals).
- Assentaments automàtics: regularització IVA Q4, regularització grups 6/7, IS, traspàs a 129.
- Bloqueig de l'exercici tancat.
- Generació d'assentament d'obertura de l'exercici següent.

**Surt a producció:** Just abans del tancament del 2026.

### Sprint 8 — Informes financers (1.5 setmanes)
**Què entra:**
- Balanç de situació (actiu/passiu/PN) en una data triada.
- Compte de pèrdues i guanys.
- Comparatives amb exercici anterior.
- Exportació PDF/Excel.

**Surt a producció:** Sí, completa el cicle.

### Post-MVP (priorització a decidir)

- Analítica per projecte: UI per veure rendibilitat per `RentalProject`.
- Models 130, 190, 180.
- Càlcul d'IS rigorós (BIN, deduccions, retencions).
- Previsió de tresoreria.
- Multi-empresa real (Logistik com a empresa pròpia, no només repartiment).
- SII, si arriba el cas.
- Importació SAF-T / formats AEAT directament.

### Estimació total

≈ **14-16 setmanes** de desenvolupament focalitzat per al MVP complet (sprints 1-8). Cada sprint pot anar a producció independentment, així que el risc és controlat.

---

## 11. Punts oberts pendents de validar

Aquests són els únics punts on encara em cal una decisió o confirmació de l'usuari abans d'implementar:

1. **Mapeig dels `pgcAccount` text actuals al pla nou**: hi ha unes ~600 factures amb `pgcAccount` com a string lliure. Vols revisar el mapping a mà, o que l'agent IA ho proposi i tu només validis els dubtosos?
2. **Comptes públics (AEAT, SS, Generalitat) a "Tercers"**: vols fitxa pròpia per tenir històric de pagaments, o n'hi ha prou amb subcomptes (4750, 4751, 4752, 476)?
3. **Recàrrec d'equivalència o règim general d'IVA**: confirmo que Seito està a règim general?
4. **Pla 2008 PYMES o PGC general**: el seed proposat és PGC PYMES. És correcte per a Seito?
5. **Numeració del llibre diari**: correlatiu únic per exercici (1, 2, 3...) o per tipus d'assentament? Recomano el primer.
6. **Caixa (570)**: l'empresa fa servir efectiu, o tot va per banc? Si tot per banc, podem deixar el subcompte però sense ús.
7. **Préstecs / línies de crèdit**: hi ha algun préstec actiu que cal modelar des del Sprint 1?

---

## 12. Resum executiu — què canvia respecte d'ara

| Avui | Després |
|---|---|
| `pgcAccount` és un string lliure dins de la factura. | Pla de comptes jeràrquic (ChartOfAccount). |
| No hi ha llibre diari. | Llibre diari amb partida doble validat. |
| 303/111/347/349 calculats des de les factures. | Calculats des del llibre diari (font única de veritat). |
| `accountingType=INVESTMENT` és només una etiqueta. | Genera FixedAsset amb calendari d'amortització i assentaments mensuals automàtics. |
| No hi ha tancament d'exercici. | Procés guiat amb regularització i càlcul d'IS. |
| Auditoria parcial (createdAt/updatedAt). | AuditLog universal amb diff abans/després. |
| Cap exercici és "tancat". | Bloqueig per FiscalYear. |
| Agent IA suggereix text. | Agent IA suggereix assentament complet editable. |
| Repartiment Seito↔Logistik | **Igual que ara, intacte.** |

---

## 13. Annex — Dependències amb mòduls existents

- **Operacions / RentalProject**: `JournalLine.projectId` opcional, post-MVP.
- **Equipment**: `FixedAsset.equipmentId` opcional. Quan una factura d'inversió té equipment ja a inventari, es vinculen.
- **Rentman**: les `IssuedInvoice` que arriben de Rentman no canvien — només passen pel mateix flux de comptabilització.
- **Qonto**: `BankMovement` igual; afegit pas de generació d'assentament al confirmar conciliació.
- **Push notifications**: nous tipus — "amortització mensual generada", "exercici a punt de tancar", "factura sense comptabilitzar > N dies".
- **Permisos / RoleGuard**: noves seccions necessiten permisos: `accounting`, `journal`, `closing`, `audit`. Cal afegir-los a la matriu de `RolePermission`.

---

**Fi del document.**
