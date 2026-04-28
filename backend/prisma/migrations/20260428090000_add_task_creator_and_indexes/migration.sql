ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS "createdById" text;
CREATE INDEX IF NOT EXISTS "project_tasks_createdById_idx" ON project_tasks("createdById");
CREATE INDEX IF NOT EXISTS "project_tasks_dueAt_idx" ON project_tasks("dueAt");
ALTER TABLE project_tasks ADD CONSTRAINT "project_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE project_tasks ADD CONSTRAINT "project_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE project_tasks ADD CONSTRAINT "project_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "rental_projects_rentmanProjectId_idx" ON rental_projects("rentmanProjectId");
