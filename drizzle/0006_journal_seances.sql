CREATE TABLE "browser_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"slug" text NOT NULL,
	"platform" "platform" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_seconds" integer NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browser_event" ADD CONSTRAINT "browser_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_event_stopped_idx" ON "browser_event" USING btree ("stopped_at");