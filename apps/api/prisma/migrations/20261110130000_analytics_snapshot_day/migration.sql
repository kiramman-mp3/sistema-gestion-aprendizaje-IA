-- Snapshots bajo demanda (ADR-018): uno por día, curso y docente que abre el panel.
ALTER TABLE "analytics_snapshots"
  ADD COLUMN "taken_by" INTEGER,
  ADD COLUMN "taken_on" DATE;

CREATE UNIQUE INDEX "analytics_snapshots_day_key"
  ON "analytics_snapshots" ("integration_account_id", "moodle_course_id", "taken_by", "taken_on");
