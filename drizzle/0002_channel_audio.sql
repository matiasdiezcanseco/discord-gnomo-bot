CREATE TABLE "channel_audio" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"origin" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"transcript" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration_ms" integer NOT NULL,
	"waveform" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"source_message_id" text,
	"source_attachment_id" text,
	"embedding" vector,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_audio_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "channel_audio_origin_check" CHECK ("channel_audio"."origin" IN ('uploaded','generated')),
	CONSTRAINT "channel_audio_title_check" CHECK (length("channel_audio"."title") BETWEEN 1 AND 100),
	CONSTRAINT "channel_audio_description_check" CHECK (length("channel_audio"."description") BETWEEN 1 AND 1500),
	CONSTRAINT "channel_audio_duration_check" CHECK ("channel_audio"."duration_ms" > 0),
	CONSTRAINT "channel_audio_size_check" CHECK ("channel_audio"."size_bytes" > 0),
	CONSTRAINT "channel_audio_embedding_check" CHECK (("channel_audio"."embedding" IS NULL) = ("channel_audio"."embedding_model" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "channel_audio_scope" ON "channel_audio" USING btree ("guild_id","channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_audio_content" ON "channel_audio" USING btree ("guild_id","channel_id","sha256");