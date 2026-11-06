-- Additive baseline: compatible pre-Drizzle installations are validated by db:migrate.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pilot_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text,
	"subject" text,
	"key" text,
	"category" text DEFAULT 'general' NOT NULL,
	"content" text NOT NULL,
	"source_message_id" text,
	"last_message_id" text,
	"last_editor_id" text,
	"origin" text NOT NULL,
	"legacy_id" text,
	"embedding" vector,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_memories_legacy_id_key" UNIQUE("legacy_id"),
	CONSTRAINT "pilot_memories_content_check" CHECK (length("pilot_memories"."content") BETWEEN 1 AND 1200),
	CONSTRAINT "pilot_memories_origin_check" CHECK ("pilot_memories"."origin" IN ('explicit_request','legacy_import')),
	CONSTRAINT "pilot_memories_check" CHECK (("pilot_memories"."embedding" IS NULL) = ("pilot_memories"."embedding_model" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pilot_memory_operations" (
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"author_id" text NOT NULL,
	"operation" text NOT NULL,
	"memory_id" uuid,
	CONSTRAINT "pilot_memory_operations_pkey" PRIMARY KEY("guild_id","channel_id","message_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pilot_memory_operations'::regclass AND conname='pilot_memory_operations_memory_id_fkey') THEN
    ALTER TABLE "pilot_memory_operations" ADD CONSTRAINT "pilot_memory_operations_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "public"."pilot_memories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_memories_scope" ON "pilot_memories" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_memories_author_key" ON "pilot_memories" USING btree ("guild_id","channel_id","author_id","key") WHERE "pilot_memories"."key" IS NOT NULL;
