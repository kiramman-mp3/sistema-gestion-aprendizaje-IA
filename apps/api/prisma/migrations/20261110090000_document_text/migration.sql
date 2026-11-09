-- Texto extraído por el worker documental (RF-04).
ALTER TYPE "DocumentStatus" ADD VALUE 'TEXT_READY' BEFORE 'EXTRACTED';

ALTER TABLE "syllabus_documents"
  ADD COLUMN "extracted_text" JSONB,
  ADD COLUMN "page_count" INTEGER,
  ADD COLUMN "text_extracted_at" TIMESTAMP(3);
