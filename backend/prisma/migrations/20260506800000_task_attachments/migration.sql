-- Arxius adjunts a una tasca (imatges, PDFs, docs).
-- Storage al filesystem local: uploads/task-attachments/{taskId}/{filename}
-- Accés via endpoint backend amb autenticació.

CREATE TABLE "task_attachments" (
  "id"            TEXT PRIMARY KEY,
  "taskId"        TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "originalName"  TEXT NOT NULL,
  "mimeType"      TEXT NOT NULL,
  "sizeBytes"     INTEGER NOT NULL,
  "uploadedById"  TEXT,
  "uploadedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "task_attachments_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "task_attachments_taskId_idx"
  ON "task_attachments" ("taskId");
