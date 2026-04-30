-- Nous enums
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "ProjectType" AS ENUM ('DOCUMENTAL', 'INTERVIEW', 'EVENT', 'ADVERTISING', 'CORPORATE', 'MUSIC_VIDEO', 'FILM', 'TV', 'PHOTO', 'OTHER');

-- Nous camps a rental_projects
ALTER TABLE "rental_projects" ADD COLUMN "projectType" "ProjectType";

-- Nous camps a project_tasks
ALTER TABLE "project_tasks" ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "project_tasks" ADD COLUMN "templateId" TEXT;
CREATE INDEX "project_tasks_priority_idx" ON "project_tasks"("priority");

-- Plantilles de tasques
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "projectType" "ProjectType",
    "category" "TaskCategory" NOT NULL DEFAULT 'GENERAL',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_templates_projectType_idx" ON "task_templates"("projectType");
CREATE INDEX "task_templates_isDefault_idx" ON "task_templates"("isDefault");

-- Items de plantilla
CREATE TABLE "task_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "TaskCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "daysOffset" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assignToRole" TEXT,
    "checklistItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_template_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_template_items_templateId_idx" ON "task_template_items"("templateId");

-- Subtasques / Checklist items
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_checklist_items_taskId_idx" ON "task_checklist_items"("taskId");

-- Comentaris de tasques
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- Activitat de tasques
CREATE TABLE "task_activities" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_activities_taskId_idx" ON "task_activities"("taskId");
CREATE INDEX "task_activities_createdAt_idx" ON "task_activities"("createdAt");

-- Foreign keys
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_template_items" ADD CONSTRAINT "task_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Inserir plantilles per defecte
INSERT INTO "task_templates" ("id", "name", "description", "projectType", "category", "isDefault", "sortOrder", "updatedAt")
VALUES
  ('tpl_documental', 'Preparació documental', 'Tasques estàndard per projectes de documental', 'DOCUMENTAL', 'TECH', true, 1, NOW()),
  ('tpl_interview', 'Preparació entrevista', 'Tasques estàndard per entrevistes', 'INTERVIEW', 'TECH', true, 2, NOW()),
  ('tpl_event', 'Preparació event', 'Tasques estàndard per esdeveniments', 'EVENT', 'TECH', true, 3, NOW()),
  ('tpl_advertising', 'Preparació publicitat', 'Tasques estàndard per rodatges publicitaris', 'ADVERTISING', 'TECH', true, 4, NOW()),
  ('tpl_general', 'Preparació general', 'Tasques estàndard per qualsevol projecte', NULL, 'TECH', true, 10, NOW()),
  ('tpl_return', 'Inspecció retorn', 'Tasques de verificació al retorn de material', NULL, 'WAREHOUSE', false, 20, NOW());

-- Items per plantilla general (s'aplica a tots els tipus)
INSERT INTO "task_template_items" ("id", "templateId", "title", "category", "priority", "daysOffset", "sortOrder", "checklistItems", "updatedAt")
VALUES
  ('tpli_backfocus', 'tpl_general', 'Backfocus càmera', 'TECH', 'HIGH', -2, 1, '["Comprovar backfocus amb chart","Ajustar si cal","Verificar amb objectiu zoom"]', NOW()),
  ('tpli_optics', 'tpl_general', 'Col·limar òptiques', 'TECH', 'HIGH', -2, 2, '["Netejar lents","Col·limar cada objectiu","Verificar focus marks"]', NOW()),
  ('tpli_batteries', 'tpl_general', 'Revisar i carregar bateries', 'TECH', 'HIGH', -1, 3, '["Comprovar estat bateries","Carregar totes","Verificar carregadors","Etiquetar bateries plenes"]', NOW()),
  ('tpli_teradek', 'tpl_general', 'Linkar teradeks', 'TECH', 'NORMAL', -1, 4, '["Vincular TX i RX","Comprovar senyal","Test de rang"]', NOW()),
  ('tpli_gps', 'tpl_general', 'Posar GPS', 'TECH', 'NORMAL', -1, 5, '["Instal·lar GPS al case","Activar tracking","Verificar senyal"]', NOW()),
  ('tpli_cards', 'tpl_general', 'Preparar targetes memòria', 'TECH', 'HIGH', -1, 6, '["Formatejar targetes","Verificar velocitat","Etiquetar"]', NOW()),
  ('tpli_cables', 'tpl_general', 'Verificar cables i adaptadors', 'TECH', 'NORMAL', -1, 7, '["Comprovar SDI","Comprovar HDMI","Comprovar alimentació","Adaptadors necessaris"]', NOW()),
  ('tpli_packing', 'tpl_general', 'Preparar flight cases', 'WAREHOUSE', 'HIGH', -1, 8, '["Col·locar equip als cases","Etiquetar cada case","Verificar llista de sortida","Tancar i precinte"]', NOW());

-- Items per plantilla retorn
INSERT INTO "task_template_items" ("id", "templateId", "title", "category", "priority", "daysOffset", "sortOrder", "checklistItems", "updatedAt")
VALUES
  ('tpli_ret_check', 'tpl_return', 'Verificar material retornat', 'WAREHOUSE', 'HIGH', 0, 1, '["Comprovar llista vs material rebut","Anotar peces que falten","Fotografiar estat general"]', NOW()),
  ('tpli_ret_damage', 'tpl_return', 'Inspeccionar desperfectes', 'TECH', 'HIGH', 0, 2, '["Revisar cossos càmera","Revisar objectius","Revisar accessoris","Fotografiar qualsevol dany"]', NOW()),
  ('tpli_ret_clean', 'tpl_return', 'Netejar i guardar equip', 'WAREHOUSE', 'NORMAL', 0, 3, '["Netejar lents","Netejar cossos","Assecar si cal","Retornar a ubicació magatzem"]', NOW()),
  ('tpli_ret_data', 'tpl_return', 'Backup i formatejar targetes', 'TECH', 'NORMAL', 0, 4, '["Backup dades si el client ho demana","Formatejar targetes","Retornar a caixa"]', NOW());

-- Items específics per documental (a més dels generals)
INSERT INTO "task_template_items" ("id", "templateId", "title", "category", "priority", "daysOffset", "sortOrder", "checklistItems", "updatedAt")
VALUES
  ('tpli_doc_audio', 'tpl_documental', 'Preparar equip de so', 'TECH', 'HIGH', -2, 1, '["Comprovar micròfons","Verificar gravadora","Preparar perxa","Comprovar petaques"]', NOW()),
  ('tpli_doc_light', 'tpl_documental', 'Preparar il·luminació', 'TECH', 'NORMAL', -1, 2, '["Verificar panels LED","Comprovar difusors/banderes","Preparar trípodes llum"]', NOW()),
  ('tpli_doc_monitor', 'tpl_documental', 'Preparar monitors i video assist', 'TECH', 'NORMAL', -1, 3, '["Comprovar monitors camp","Calibrar color si cal","Verificar cablejat SDI/HDMI"]', NOW());

-- Items específics per entrevista
INSERT INTO "task_template_items" ("id", "templateId", "title", "category", "priority", "daysOffset", "sortOrder", "checklistItems", "updatedAt")
VALUES
  ('tpli_int_audio', 'tpl_interview', 'Preparar micro entrevista', 'TECH', 'HIGH', -1, 1, '["Comprovar micro corbata","Verificar receptor wireless","Preparar micro perxa backup","Test àudio"]', NOW()),
  ('tpli_int_prompt', 'tpl_interview', 'Preparar prompter si cal', 'TECH', 'NORMAL', -1, 2, '["Muntar prompter","Carregar guió","Verificar control remot"]', NOW());

-- Items específics per event
INSERT INTO "task_template_items" ("id", "templateId", "title", "category", "priority", "daysOffset", "sortOrder", "checklistItems", "updatedAt")
VALUES
  ('tpli_evt_multi', 'tpl_event', 'Preparar multicàmera', 'TECH', 'HIGH', -2, 1, '["Configurar totes les càmeres igual","Sincronitzar timecode","Preparar switcher si cal"]', NOW()),
  ('tpli_evt_stream', 'tpl_event', 'Preparar streaming si cal', 'TECH', 'HIGH', -2, 2, '["Verificar encoder","Comprovar connexió internet lloc","Test streaming","Backup enregistrament local"]', NOW()),
  ('tpli_evt_power', 'tpl_event', 'Preparar alimentació', 'TECH', 'NORMAL', -1, 3, '["Allargadors i regletes","Verificar accés a corrent al lloc","Bateries backup"]', NOW());
