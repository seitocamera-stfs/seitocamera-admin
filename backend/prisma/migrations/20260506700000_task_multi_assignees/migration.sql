-- Co-assignació de tasques a múltiples usuaris.
--
-- ProjectTask.assignedToId es manté com a "responsable principal" (el primer
-- de la llista) per backward-compat amb totes les rutes/lògica existent.
-- ProjectTaskAssignee és la relació M:N que permet assignar la mateixa tasca
-- a N usuaris simultàniament.
--
-- Migració: per cada tasca existent amb assignedToId, crea una entrada al
-- M:N perquè la realitat actual quedi reflectida correctament.

CREATE TABLE "project_task_assignees" (
  "taskId"        TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "assignedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "assignedById"  TEXT,

  PRIMARY KEY ("taskId", "userId"),

  CONSTRAINT "project_task_assignees_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "project_task_assignees_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "project_task_assignees_userId_idx"
  ON "project_task_assignees" ("userId");

-- Backfill: replica les assignacions actuals (assignedToId) al M:N
INSERT INTO "project_task_assignees" ("taskId", "userId", "assignedAt", "assignedById")
SELECT
  id              AS "taskId",
  "assignedToId"  AS "userId",
  "createdAt"     AS "assignedAt",
  "createdById"   AS "assignedById"
FROM "project_tasks"
WHERE "assignedToId" IS NOT NULL
ON CONFLICT DO NOTHING;
