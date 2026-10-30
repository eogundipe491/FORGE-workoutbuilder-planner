CREATE TABLE "forge_onboarding" (
	"user_id" text PRIMARY KEY,
	"answers" jsonb DEFAULT '{}' NOT NULL,
	"question_index" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"skipped" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
