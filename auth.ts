import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import Authentik from "next-auth/providers/authentik";
import { getDb } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { invalidateBrowserAuthCache } from "@/lib/browser-auth";
import { errorMessage, logger } from "@/lib/log";
import { uniqueSlug } from "@/lib/slug";
import {
  authentikIssuer,
  hasAccess,
  SESSION_MAX_AGE_SECONDS,
  parseClaims,
  profileFields,
  type Claims,
} from "@/lib/auth-rules";

export {
  ACCESS_GROUP,
  ADMIN_GROUP,
  authentikEndSessionUrl,
  authentikIssuer,
  hasAccess,
  SESSION_MAX_AGE_SECONDS,
  roleFromGroups,
} from "@/lib/auth-rules";

const log = logger("auth");

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      slug: string;
      role: "user" | "admin";
      displayName: string;
      onboarded: boolean;
    } & DefaultSession["user"];
  }
}

/**
 * Adapter Drizzle + création d'utilisateur Netflop : le slug est dérivé de
 * preferred_username à la création et n'est plus jamais modifié.
 */
function netflopAdapter(): Adapter {
  const db = getDb();
  const base = DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });

  return {
    ...base,
    async createUser(data) {
      const extra = data as AdapterUser & { claims?: Claims };
      const claims = extra.claims;
      if (!claims) throw new Error("Claims Authentik absents");
      const fields = profileFields(claims);

      for (let attempt = 0; attempt < 5; attempt++) {
        const slug = await uniqueSlug(
          claims.preferred_username ?? claims.nickname ?? "",
          async (s) => {
            const found = await db.select({ id: users.id }).from(users).where(eq(users.slug, s));
            return found.length > 0;
          },
        );
        try {
          const [row] = await db
            .insert(users)
            .values({ ...fields, authentikSub: claims.sub, slug, lastLoginAt: new Date() })
            .returning();
          if (!row) throw new Error("Insertion utilisateur vide");
          log.info("utilisateur créé", { slug, role: fields.role });
          return { ...row, emailVerified: row.emailVerified ?? null, email: row.email ?? "" };
        } catch (err) {
          // Collision concurrente sur le slug : on recommence.
          if (/unique/i.test(errorMessage(err)) && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error("Création utilisateur impossible");
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: netflopAdapter(),
  trustHost: true,
  useSecureCookies: (process.env.AUTH_URL ?? "").startsWith("https://"),
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 24 * 60 * 60, // renouvellement glissant, au plus une écriture par jour
  },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Authentik({
      issuer: authentikIssuer(),
      clientId: process.env.AUTH_AUTHENTIK_ID,
      clientSecret: process.env.AUTH_AUTHENTIK_SECRET,
      // offline_access : refresh token, utilisé par le worker pour revérifier les droits.
      authorization: { params: { scope: "openid profile email offline_access" } },
      profile(profile) {
        const claims = parseClaims(profile);
        if (!claims) throw new Error("Profil Authentik invalide");
        const f = profileFields(claims);
        // `claims` est transmis à createUser (adapter) ; non stocké tel quel.
        return { id: claims.sub, name: f.name, email: f.email, image: f.image, claims };
      },
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      const claims = parseClaims(profile);
      if (!hasAccess(claims)) {
        log.warn("connexion refusée : hors du groupe netflop", {
          username: claims?.preferred_username ?? null,
        });
        return false; // → /login?error=AccessDenied
      }
      return true;
    },
    session({ session, user }) {
      const u = user as AdapterUser & Partial<typeof users.$inferSelect>;
      session.user = {
        ...session.user,
        id: u.id,
        slug: u.slug ?? "",
        role: u.role ?? "user",
        displayName: u.displayName ?? u.name ?? "",
        image: u.avatarUrl ?? u.image ?? null,
        onboarded: Boolean(u.onboardedAt),
      };
      return session;
    },
  },
  events: {
    async signIn({ profile, account }) {
      const claims = parseClaims(profile);
      if (!claims) return;
      const db = getDb();
      // Mise à jour à chaque connexion : nom, e-mail, avatar, rôle (groupes).
      const [row] = await db
        .update(users)
        .set({ ...profileFields(claims), lastLoginAt: new Date() })
        .where(eq(users.authentikSub, claims.sub))
        .returning({ id: users.id, slug: users.slug });
      // Jetons frais (id_token pour la déconnexion Authentik).
      if (account && row) {
        await db
          .update(accounts)
          .set({
            id_token: account.id_token ?? null,
            access_token: account.access_token ?? null,
            refresh_token: account.refresh_token ?? null,
            expires_at: account.expires_at ?? null,
          })
          .where(
            and(
              eq(accounts.provider, account.provider),
              eq(accounts.providerAccountId, account.providerAccountId),
            ),
          );
      }
      log.info("connexion", { user: row?.slug ?? null });
    },
    async signOut(message) {
      if (!("session" in message) || !message.session) return;
      const { userId, sessionToken } = message.session as { userId: string; sessionToken: string };
      invalidateBrowserAuthCache(sessionToken);
      try {
        const { stopBrowserForUser } = await import("@/lib/browser-service");
        await stopBrowserForUser(userId, "déconnexion");
      } catch (err) {
        log.error("arrêt du navigateur à la déconnexion", { error: errorMessage(err) });
      }
    },
  },
}));
