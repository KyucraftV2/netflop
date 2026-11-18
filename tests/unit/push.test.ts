import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, pushConfig, subscriptionSchema } from "@/lib/push";
import { airedWithin } from "@/lib/tmdb";

describe("endpoints de push autorisés (pas de requête serveur vers un hôte arbitraire)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepte %s", (url) => expect(isAllowedPushEndpoint(url)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.io/x",
    "https://evil.io/fcm.googleapis.com",
    "https://docker-proxy:2375/containers/json",
    "https://127.0.0.1/",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "pas une url",
  ])("refuse %s", (url) => expect(isAllowedPushEndpoint(url)).toBe(false));

  it("schéma d'abonnement", () => {
    const ok = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };
    expect(subscriptionSchema.safeParse(ok).success).toBe(true);
    expect(
      subscriptionSchema.safeParse({ ...ok, keys: { ...ok.keys, auth: "<script>" } }).success,
    ).toBe(false);
  });
});

describe("configuration VAPID", () => {
  it("désactivée sans clés, sujet par défaut = domaine du hub", () => {
    expect(pushConfig({})).toBeNull();
    expect(pushConfig({ VAPID_PUBLIC_KEY: "<x>", VAPID_PRIVATE_KEY: "y" })).toBeNull();
    expect(
      pushConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        HUB_DOMAIN: "n.example.com",
      }),
    ).toEqual({ publicKey: "pub", privateKey: "priv", subject: "https://n.example.com" });
    expect(
      pushConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "ftp://x" }),
    ).toBeNull();
  });
});

describe("airedWithin", () => {
  const now = Date.parse("2026-11-17T10:00:00Z");
  it.each([
    ["2026-11-17", true],
    ["2026-11-11", true],
    ["2026-11-09", false],
    ["2026-11-20", false], // pas encore diffusé
    [null, false],
  ])("%s → %s", (d, expected) => expect(airedWithin(d, 7, now)).toBe(expected));
});
