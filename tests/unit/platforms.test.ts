import { describe, expect, it } from "vitest";
import {
  enabledPlatformIds,
  isPlaybackUrl,
  platformForProviderName,
  platformSearchUrl,
  validateNavigationUrl,
} from "@/lib/platforms";

describe("correspondance fournisseurs → plateformes", () => {
  it.each([
    ["Netflix", "netflix"],
    ["Netflix basic with Ads", "netflix"],
    ["Canal+", "canalplus"],
    ["Canal+ Séries", "canalplus"],
    ["CANAL+ Ciné Séries", "canalplus"],
    ["HBO Max", "canalplus"],
    ["Max", "canalplus"],
    ["Apple TV+", "canalplus"],
    ["Apple TV", "canalplus"],
    ["france.tv", "francetv"],
    ["France TV", "francetv"],
    ["Amazon Prime Video", "primevideo"],
    ["Amazon Prime Video with Ads", "primevideo"],
    ["Disney Plus", "disneyplus"],
    ["Arte", "arte"],
    ["TF1+", "tf1plus"],
    ["M6+", "m6plus"],
    ["6play", "m6plus"],
  ])("%s → %s", (name, id) => expect(platformForProviderName(name)).toBe(id));

  it.each([
    "Apple TV Store",
    "Amazon Video",
    "Disney Plus Amazon Channel",
    "HBO Max Amazon Channel",
    "Maxdome",
  ])("%s → null", (name) => expect(platformForProviderName(name)).toBeNull());
});

describe("validation des URL de navigation", () => {
  it.each([
    ["https://www.netflix.com/title/80057281", "netflix"],
    ["https://netflix.com/watch/1", "netflix"],
    ["https://www.canalplus.com/series/x/h/123", "canalplus"],
    ["https://www.france.tv/france-2/", "francetv"],
  ])("accepte %s", (url, platform) => {
    expect(validateNavigationUrl(url)?.platform).toBe(platform);
  });

  it.each([
    "http://www.netflix.com/",
    "https://netflix.com.evil.io/",
    "https://evilnetflix.com/",
    "https://user:pass@www.netflix.com/",
    "https://www.netflix.com:8443/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome://settings",
    "https://example.com/?u=https://www.netflix.com",
    "not a url",
  ])("refuse %s", (url) => expect(validateNavigationUrl(url)).toBeNull());
});

describe("pages de lecture", () => {
  it("Netflix", () => {
    expect(isPlaybackUrl("netflix", "https://www.netflix.com/watch/81234567?trackId=1")).toBe(true);
    expect(isPlaybackUrl("netflix", "https://www.netflix.com/browse")).toBe(false);
    expect(isPlaybackUrl("netflix", "https://www.netflix.com/title/80057281")).toBe(false);
  });
  it("france.tv", () => {
    expect(
      isPlaybackUrl(
        "francetv",
        "https://www.france.tv/france-2/un-si-grand-soleil/saison-5/6012345-episode-du-lundi.html",
      ),
    ).toBe(true);
    expect(isPlaybackUrl("francetv", "https://www.france.tv/series-et-fictions/")).toBe(false);
  });
});

describe("URL de recherche", () => {
  it("encode le titre", () => {
    expect(platformSearchUrl("netflix", "Lupin & co")).toBe(
      "https://www.netflix.com/search?q=Lupin%20%26%20co",
    );
  });
});

describe("plateformes activées (NETFLOP_PLATFORMS)", () => {
  it("vide ou invalide → toutes", () => {
    expect(enabledPlatformIds("")).toHaveLength(8);
    expect(enabledPlatformIds(undefined)).toHaveLength(8);
    expect(enabledPlatformIds("youtube, ,")).toHaveLength(8);
  });

  it("liste explicite, ordre canonique, sans doublon ni inconnu", () => {
    expect(enabledPlatformIds(" arte,Netflix,arte,youtube ")).toEqual(["netflix", "arte"]);
  });
});

describe("nouvelles plateformes : URL de lecture", () => {
  it.each([
    ["arte", "https://www.arte.tv/fr/videos/110342-001-A/une-serie/", true],
    ["arte", "https://www.arte.tv/fr/", false],
    ["disneyplus", "https://www.disneyplus.com/fr-fr/video/5f2a5c1e-1234", true],
    ["disneyplus", "https://www.disneyplus.com/fr-fr/home", false],
    ["tf1plus", "https://www.tf1.fr/tf1/une-serie/videos/episode-1-123.html", true],
    ["m6plus", "https://www.m6.fr/", false],
    ["m6plus", "https://www.m6.fr/une-serie-p_123/videos/episode-1", true],
  ] as const)("%s %s → %s", (id, url, expected) => {
    expect(isPlaybackUrl(id, url)).toBe(expected);
  });

  it("navigation vers les domaines des nouvelles plateformes", () => {
    expect(validateNavigationUrl("https://www.primevideo.com/detail/0ABC/")?.platform).toBe(
      "primevideo",
    );
    expect(validateNavigationUrl("https://www.arte.tv/fr/")?.platform).toBe("arte");
    expect(validateNavigationUrl("https://www.tf1.fr.evil.io/")).toBeNull();
  });
});
