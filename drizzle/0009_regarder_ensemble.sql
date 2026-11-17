CREATE TABLE "watch_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"host_user_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"guest_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "watch_invite" ADD CONSTRAINT "watch_invite_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_invite" ADD CONSTRAINT "watch_invite_guest_user_id_user_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_invite_host_idx" ON "watch_invite" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "watch_invite_guest_idx" ON "watch_invite" USING btree ("guest_user_id");