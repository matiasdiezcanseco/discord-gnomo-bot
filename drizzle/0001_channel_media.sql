CREATE TABLE "channel_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"source_attachment_id" text NOT NULL,
	"object_key" text NOT NULL,
	"url" text NOT NULL,
	"media_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_media_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "channel_media_title_check" CHECK (length("channel_media"."title") BETWEEN 1 AND 100),
	CONSTRAINT "channel_media_description_check" CHECK (length("channel_media"."description") BETWEEN 1 AND 1500),
	CONSTRAINT "channel_media_embedding_check" CHECK (("channel_media"."embedding" IS NULL) = ("channel_media"."embedding_model" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "channel_media_scope" ON "channel_media" USING btree ("guild_id","channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_media_content" ON "channel_media" USING btree ("guild_id","channel_id","sha256");