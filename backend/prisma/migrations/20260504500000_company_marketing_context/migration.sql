-- Marketing/brand context for the Company.
-- Free-form JSON so we can evolve the shape without migrations.
-- Expected shape (mirrors src/schemas/business.py BusinessContext in marketing/):
--   {
--     "vertical":            "audiovisual equipment rental",
--     "language":            "ca",
--     "target_customers":    ["...", "..."],
--     "unique_strengths":    ["...", "..."],
--     "known_competitors":   ["...", "..."],
--     "excluded_segments":   ["...", "..."],
--     "goals":               ["...", "..."],
--     "brand_voice":         "..."   -- free text, optional
--   }
ALTER TABLE "companies"
  ADD COLUMN "marketingContext" JSONB;
