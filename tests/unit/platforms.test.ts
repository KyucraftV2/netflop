import { describe, expect, it } from "vitest";
import {
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
  ])("%s → %s", (name, id) => expect(platformForProviderName(name)).toBe(id));

  it.each([
    "Amazon Prime Video",
    "Disney Plus",
    "Apple TV Store",
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
