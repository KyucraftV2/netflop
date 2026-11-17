ALTER TYPE "public"."video_quality" ADD VALUE 'auto';--> statement-breakpoint
ALTER TABLE "browser_session" ADD COLUMN "sleep_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "browser_session" ADD COLUMN "sleep_after_episode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_quality_hint" "video_quality";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paused_stop_minutes" integer;