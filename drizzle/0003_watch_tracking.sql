CREATE TABLE "watch_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tmdb_id" integer,
	"type" "media_type",
	"season" integer DEFAULT 0 NOT NULL,
	"episode" integer DEFAULT 0 NOT NULL,
	"platform" "platform" NOT NULL,
	"title" text NOT NULL,
	"raw_title" text,
	"episode_title" text,
	"poster_path" text,
	"backdrop_path" text,
	"resume_url" text,
	"position" real DEFAULT 0 NOT NULL,
	"duration" real DEFAULT 0 NOT NULL,
	"percent" real DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone,
	"last_watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_sample" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"url" text NOT NULL,
	"raw_title" text,
	"position" real,
	"duration" real,
	"paused" boolean,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_sample" ADD CONSTRAINT "watch_sample_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_progress_identified_uq" ON "watch_progress" USING btree ("user_id","tmdb_id","season","episode") WHERE "watch_progress"."tmdb_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_progress_unidentified_uq" ON "watch_progress" USING btree ("user_id","platform","raw_title","season","episode") WHERE "watch_progress"."tmdb_id" is null;--> statement-breakpoint
CREATE INDEX "watch_progress_user_recent_idx" ON "watch_progress" USING btree ("user_id","last_watched_at");--> statement-breakpoint
CREATE INDEX "watch_sample_user_idx" ON "watch_sample" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX "watch_sample_captured_idx" ON "watch_sample" USING btree ("captured_at");