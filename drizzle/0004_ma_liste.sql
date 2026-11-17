CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tmdb_id" integer NOT NULL,
	"type" "media_type" NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"poster_path" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_title_uq" ON "watchlist" USING btree ("user_id","tmdb_id","type");--> statement-breakpoint
CREATE INDEX "watchlist_user_added_idx" ON "watchlist" USING btree ("user_id","added_at");