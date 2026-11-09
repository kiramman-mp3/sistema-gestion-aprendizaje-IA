-- Extensiones requeridas: vector para embeddings (ADR-005) y pgcrypto.
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'REJECTED', 'PROCESSING', 'EXTRACTED', 'REVIEWED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionSource" AS ENUM ('AI', 'TEACHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalItemType" AS ENUM ('SECTION', 'ASSIGN', 'FORUM', 'QUIZ', 'LABEL', 'PAGE');

-- CreateEnum
CREATE TYPE "PublishItemStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishOperationStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "MappingSource" AS ENUM ('PROPOSAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "DifficultyRuleType" AS ENUM ('MISSING_REQUIRED', 'GRADE_BELOW_THRESHOLD', 'SUSTAINED_DECLINE', 'REPEATED_OUTCOME_DIFFICULTY');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('GENERATED', 'DISMISSED', 'APPLIED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'ERROR');

-- CreateTable
CREATE TABLE "integration_accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "moodle_base_url" TEXT NOT NULL,
    "token_secret_ref" TEXT NOT NULL,
    "jwt_key_ref" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_documents" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "uploaded_by" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "error_code" TEXT,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabus_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_extractions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "consistency_issues" JSONB NOT NULL DEFAULT '[]',
    "source" "ExtractionSource" NOT NULL,
    "created_by" INTEGER,
    "llm_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "page" INTEGER,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "embedding_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_proposals" (
    "id" UUID NOT NULL,
    "extraction_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "parent_id" UUID,
    "item_type" "ProposalItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "unit_ref" TEXT NOT NULL,
    "learning_outcome_ids" TEXT[],
    "due_date" DATE,
    "weight" DECIMAL(5,2),
    "moodle_item_id" INTEGER,
    "publish_status" "PublishItemStatus" NOT NULL DEFAULT 'PENDING',
    "publish_error" TEXT,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_operations" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "status" "PublishOperationStatus" NOT NULL DEFAULT 'RUNNING',
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "publish_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_user_id" INTEGER NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "title" TEXT,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "tool_name" TEXT,
    "llm_model" TEXT,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_unit_mappings" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "moodle_cm_id" INTEGER NOT NULL,
    "unit_ref" TEXT NOT NULL,
    "learning_outcome_ids" TEXT[],
    "source" "MappingSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_unit_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "moodle_user_id" INTEGER,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "indicators" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "difficulty_rules" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_course_id" INTEGER,
    "rule" "DifficultyRuleType" NOT NULL,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "difficulty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedagogical_recommendations" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID NOT NULL,
    "moodle_course_id" INTEGER NOT NULL,
    "moodle_student_id" INTEGER NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'GENERATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedagogical_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_followups" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "action_taken" TEXT NOT NULL,
    "observed_result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "integration_account_id" UUID,
    "actor_moodle_id" INTEGER,
    "moodle_course_id" INTEGER,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "syllabus_documents_moodle_course_id_created_at_idx" ON "syllabus_documents"("moodle_course_id", "created_at");

-- CreateIndex
CREATE INDEX "syllabus_documents_moodle_course_id_checksum_sha256_idx" ON "syllabus_documents"("moodle_course_id", "checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_extractions_document_id_version_key" ON "syllabus_extractions"("document_id", "version");

-- CreateIndex
CREATE INDEX "document_chunks_moodle_course_id_idx" ON "document_chunks"("moodle_course_id");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_chunk_index_idx" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "course_proposals_moodle_course_id_created_at_idx" ON "course_proposals"("moodle_course_id", "created_at");

-- CreateIndex
CREATE INDEX "proposal_items_proposal_id_position_idx" ON "proposal_items"("proposal_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "publish_operations_idempotency_key_key" ON "publish_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "publish_operations_proposal_id_idx" ON "publish_operations"("proposal_id");

-- CreateIndex
CREATE INDEX "ai_conversations_moodle_user_id_moodle_course_id_idx" ON "ai_conversations"("moodle_user_id", "moodle_course_id");

-- CreateIndex
CREATE INDEX "ai_conversations_retain_until_idx" ON "ai_conversations"("retain_until");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_unit_mappings_moodle_course_id_moodle_cm_id_key" ON "activity_unit_mappings"("moodle_course_id", "moodle_cm_id");

-- CreateIndex
CREATE INDEX "analytics_snapshots_moodle_course_id_moodle_user_id_taken_a_idx" ON "analytics_snapshots"("moodle_course_id", "moodle_user_id", "taken_at");

-- CreateIndex
CREATE INDEX "difficulty_rules_moodle_course_id_idx" ON "difficulty_rules"("moodle_course_id");

-- CreateIndex
CREATE INDEX "pedagogical_recommendations_moodle_course_id_moodle_student_idx" ON "pedagogical_recommendations"("moodle_course_id", "moodle_student_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_moodle_id_created_at_idx" ON "audit_events"("actor_moodle_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_moodle_course_id_created_at_idx" ON "audit_events"("moodle_course_id", "created_at");

-- AddForeignKey
ALTER TABLE "syllabus_documents" ADD CONSTRAINT "syllabus_documents_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_extractions" ADD CONSTRAINT "syllabus_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "syllabus_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "syllabus_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_proposals" ADD CONSTRAINT "course_proposals_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "syllabus_extractions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "course_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "proposal_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_operations" ADD CONSTRAINT "publish_operations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "course_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_unit_mappings" ADD CONSTRAINT "activity_unit_mappings_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "difficulty_rules" ADD CONSTRAINT "difficulty_rules_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedagogical_recommendations" ADD CONSTRAINT "pedagogical_recommendations_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_followups" ADD CONSTRAINT "recommendation_followups_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "pedagogical_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_integration_account_id_fkey" FOREIGN KEY ("integration_account_id") REFERENCES "integration_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
