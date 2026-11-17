CREATE TYPE "public"."browser_status" AS ENUM('starting', 'ready', 'stopping');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('movie', 'tv');--> statement-breakpoint
CREATE TABLE "browser_queue" (
	"user_id" text PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"pending_url" text,
	"opened_content" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"slot" integer NOT NULL,
	"container_id" text,
	"status" "browser_status" DEFAULT 'starting' NOT NULL,
	"platform" "platform" NOT NULL,
	"pending_url" text,
	"opened_content" jsonb,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stop_requested_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone DEFAULT now() NOT NULL,
	"still_watching_prompt_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_session_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "browser_session_slot_unique" UNIQUE("slot"),
	CONSTRAINT "browser_session_slot_range" CHECK ("browser_session"."slot" >= 0 and "browser_session"."slot" < 32)
);
--> statement-breakpoint
ALTER TABLE "browser_queue" ADD CONSTRAINT "browser_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session" ADD CONSTRAINT "browser_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_queue_requested_idx" ON "browser_queue" USING btree ("requested_at");