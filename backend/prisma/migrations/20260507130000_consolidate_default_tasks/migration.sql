-- Consolidació de les 5 tasques tècniques predeterminades en 1 sola tasca
-- "Preparació tècnica" amb checklist intern. Reduïm soroll del llistat global.
--
-- Estratègia (per cada projecte):
--   1. Buscar les tasques predeterminades existents (titles concrets, TECH,
--      status pending — les que NO han estat tocades manualment)
--   2. Crear UNA tasca nova "Preparació tècnica" amb 5 checklist items
--   3. Eliminar les 5 tasques antigues (cascade esborra els seus checklist
--      items, comments, activities, attachments)
--
-- Si un projecte té només ALGUNES de les 5 (perquè ja ha sigut treballat),
-- no toquem res — només migrem els que tenen TOTES 5 intactes.

DO $$
DECLARE
  proj RECORD;
  new_task_id TEXT;
  default_titles TEXT[] := ARRAY['Backfocus Camera', 'Col·limar òptiques', 'Revisar bateries', 'Linkar teradeks', 'Posar GPS'];
  cnt INT;
  consolidated INT := 0;
  skipped INT := 0;
BEGIN
  FOR proj IN SELECT id FROM rental_projects LOOP
    -- Comptem quantes de les 5 tasques predeterminades té aquest projecte
    -- en estat pending i sense checklist propi (no toquem si ja les estaven treballant)
    SELECT COUNT(*) INTO cnt
    FROM project_tasks t
    WHERE t."projectId" = proj.id
      AND t.title = ANY(default_titles)
      AND t.category = 'TECH'
      AND t.status = 'OP_PENDING'
      AND t."completedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM task_comments c WHERE c."taskId" = t.id)
      AND NOT EXISTS (SELECT 1 FROM task_checklist_items ci WHERE ci."taskId" = t.id);

    -- Només consolidem si encara hi són les 5 originals i intactes
    IF cnt = 5 THEN
      -- Crear la nova tasca consolidada (id cuid-like)
      new_task_id := 'cm' || lower(substr(md5(random()::text || proj.id), 1, 22));

      INSERT INTO project_tasks (id, "projectId", title, category, status, "createdAt", "updatedAt")
      VALUES (new_task_id, proj.id, 'Preparació tècnica', 'TECH', 'OP_PENDING', NOW(), NOW());

      -- Crear els 5 checklist items
      INSERT INTO task_checklist_items (id, "taskId", title, "sortOrder", "isCompleted", "createdAt", "updatedAt")
      SELECT
        'cm' || lower(substr(md5(random()::text || idx::text), 1, 22)),
        new_task_id,
        title,
        idx - 1,
        FALSE,
        NOW(),
        NOW()
      FROM unnest(default_titles) WITH ORDINALITY AS t(title, idx);

      -- Eliminar les 5 tasques antigues (cascade s'encarrega del que pengi)
      DELETE FROM project_tasks
      WHERE "projectId" = proj.id
        AND title = ANY(default_titles)
        AND category = 'TECH'
        AND status = 'OP_PENDING';

      consolidated := consolidated + 1;
    ELSIF cnt > 0 THEN
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Consolidació tasques: % projectes consolidats, % saltats (parcialment treballats)', consolidated, skipped;
END $$;
