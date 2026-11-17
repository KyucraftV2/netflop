import {
  check,
  index,
  integer,
  boolean,
  jsonb,
  pgEnum,
  real,
  serial,
  uniqueIndex,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import { PLATFORM_IDS } from "../platforms";

/* ------------------------------------------------------------------ */
/* Énumérations                                                        */
/* ------------------------------------------------------------------ */

export const platformEnum = pgEnum("platform", PLATFORM_IDS);
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const videoQualityEnum = pgEnum("video_quality", ["normal", "saver", "auto"]);
export const browserStatusEnum = pgEnum("browser_status", ["starting", "ready", "stopping"]);
export const mediaTypeEnum = pgEnum("media_type", ["movie", "tv"]);

/* ------------------------------------------------------------------ */
/* Utilisateurs (table de l'adapter Auth.js + champs Netflop)          */
/* ------------------------------------------------------------------ */

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Champs attendus par l'adapter Auth.js
  name: text("name"),
  email: text("email"),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  // Champs Netflop
  authentikSub: text("authentik_sub").notNull().unique(),
  /** ^[a-z0-9_-]{1,32}$ — JAMAIS modifié après création (conteneur, volume, /b/<slug>). */
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull().default("user"),
  videoQuality: videoQualityEnum("video_quality").notNull().default("normal"),
  /** Qualité « auto » : dernière estimation de la connexion envoyée par l'appareil. */
  autoQualityHint: videoQualityEnum("auto_quality_hint"),
  /** Délai avant arrêt sur pause (minutes), plafonné par PAUSED_STOP_MINUTES. NULL = défaut. */
  pausedStopMinutes: integer("paused_stop_minutes"),
  onboardedAt: timestamp("onboarded_at", { mode: "date", withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable(
  "session",
  {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const userSubscriptions = pgTable(
  "user_subscription",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.platform] })],
);

/* ------------------------------------------------------------------ */
/* Cycle de vie des navigateurs (étape 3)                              */
/* ------------------------------------------------------------------ */

/** Contenu ouvert depuis Netflop (étape 4) : sert à l'identification au suivi (étape 5). */
export interface OpenedContent {
  platform: (typeof PLATFORM_IDS)[number];
  url: string;
  tmdbId?: number;
  type?: "movie" | "tv";
  title?: string;
  season?: number;
  episode?: number;
  openedAt: string;
}

/**
 * Une ligne = un navigateur existant. Unicité du slot ET de l'utilisateur :
 * deux clics simultanés ne peuvent pas obtenir le même slot (contrainte en base).
 * La ligne est supprimée quand le conteneur est supprimé.
 */
export const browserSessions = pgTable(
  "browser_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull().unique(),
    containerId: text("container_id"),
    status: browserStatusEnum("status").notNull().default("starting"),
    platform: platformEnum("platform").notNull(),
    /** URL à ouvrir dès que le navigateur est prêt (étape 4). */
    pendingUrl: text("pending_url"),
    /** Dernier contenu ouvert depuis Netflop (étape 5). */
    openedContent: jsonb("opened_content").$type<OpenedContent>(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    stopRequestedAt: timestamp("stop_requested_at", { mode: "date", withTimezone: true }),
    lastInteractionAt: timestamp("last_interaction_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    stillWatchingPromptAt: timestamp("still_watching_prompt_at", {
      mode: "date",
      withTimezone: true,
    }),
    readyAt: timestamp("ready_at", { mode: "date", withTimezone: true }),
    /** Minuteur de sommeil : arrêt à cette heure… */
    sleepAt: timestamp("sleep_at", { mode: "date", withTimezone: true }),
    /** …ou à la fin de l'épisode / du film en cours. */
    sleepAfterEpisode: boolean("sleep_after_episode").notNull().default(false),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("browser_session_slot_range", sql`${t.slot} >= 0 and ${t.slot} < 32`)],
);

export const browserQueue = pgTable(
  "browser_queue",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    pendingUrl: text("pending_url"),
    openedContent: jsonb("opened_content").$type<OpenedContent>(),
    requestedAt: timestamp("requested_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Mis à jour par l'écran d'attente : une entrée abandonnée est retirée de la file. */
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("browser_queue_requested_idx").on(t.requestedAt)],
);

export type BrowserSession = typeof browserSessions.$inferSelect;
export type BrowserQueueEntry = typeof browserQueue.$inferSelect;

/* ------------------------------------------------------------------ */
/* Cache des API externes (étape 4) : TMDB, JustWatch                  */
/* ------------------------------------------------------------------ */

export const apiCache = pgTable(
  "api_cache",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_cache_expires_idx").on(t.expiresAt)],
);

/* ------------------------------------------------------------------ */
/* Suivi de visionnage (étape 5)                                       */
/* ------------------------------------------------------------------ */

/** Données brutes du tracker, purgées après 30 jours. */
export const watchSamples = pgTable(
  "watch_sample",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    url: text("url").notNull(),
    rawTitle: text("raw_title"),
    position: real("position"),
    duration: real("duration"),
    paused: boolean("paused"),
    capturedAt: timestamp("captured_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("watch_sample_user_idx").on(t.userId, t.capturedAt),
    index("watch_sample_captured_idx").on(t.capturedAt),
  ],
);

/**
 * Progression par œuvre/épisode. season = episode = 0 pour un film (évite les NULL
 * dans la contrainte d'unicité). tmdb_id NULL = contenu non identifié (« à confirmer »).
 */
export const watchProgress = pgTable(
  "watch_progress",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id"),
    type: mediaTypeEnum("type"),
    season: integer("season").notNull().default(0),
    episode: integer("episode").notNull().default(0),
    platform: platformEnum("platform").notNull(),
    title: text("title").notNull(),
    rawTitle: text("raw_title"),
    episodeTitle: text("episode_title"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    resumeUrl: text("resume_url"),
    position: real("position").notNull().default(0),
    duration: real("duration").notNull().default(0),
    percent: real("percent").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    manual: boolean("manual").notNull().default(false),
    confidence: real("confidence").notNull().default(0),
    needsReview: boolean("needs_review").notNull().default(false),
    dismissedAt: timestamp("dismissed_at", { mode: "date", withTimezone: true }),
    lastWatchedAt: timestamp("last_watched_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("watch_progress_identified_uq")
      .on(t.userId, t.tmdbId, t.season, t.episode)
      .where(sql`${t.tmdbId} is not null`),
    uniqueIndex("watch_progress_unidentified_uq")
      .on(t.userId, t.platform, t.rawTitle, t.season, t.episode)
      .where(sql`${t.tmdbId} is null`),
    index("watch_progress_user_recent_idx").on(t.userId, t.lastWatchedAt),
  ],
);

export type WatchProgress = typeof watchProgress.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/* ------------------------------------------------------------------ */
/* Ma liste                                                            */
/* ------------------------------------------------------------------ */

/** Titres mis de côté par l'utilisateur pour plus tard. */
export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id").notNull(),
    type: mediaTypeEnum("type").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    posterPath: text("poster_path"),
    /** Plateformes connues à l'ajout (rafraîchies à l'affichage via TMDB). */
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    addedAt: timestamp("added_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("watchlist_user_title_uq").on(t.userId, t.tmdbId, t.type),
    index("watchlist_user_added_idx").on(t.userId, t.addedAt),
  ],
);

export type WatchlistEntry = typeof watchlist.$inferSelect;

/* ------------------------------------------------------------------ */
/* Journal des séances (tableau de bord admin)                         */
/* ------------------------------------------------------------------ */

/** Une ligne par séance terminée (purgée après 90 jours). */
export const browserEvents = pgTable(
  "browser_event",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    platform: platformEnum("platform").notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    stoppedAt: timestamp("stopped_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    durationSeconds: integer("duration_seconds").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("browser_event_stopped_idx").on(t.stoppedAt)],
);

export type BrowserEvent = typeof browserEvents.$inferSelect;
