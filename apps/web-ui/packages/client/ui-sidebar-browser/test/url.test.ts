import { describe, expect, it } from "vitest";
import { parseBrowserAddress } from "../src/client/browser/url.ts";

describe("parseBrowserAddress", () => {
  it.each([
    ["百度", "https://www.bing.com/search?q=%E7%99%BE%E5%BA%A6"],
    ["how to use colab", "https://www.bing.com/search?q=how+to+use+colab"],
    ["baidu.com", "https://baidu.com/"],
    ["localhost:3000/app", "http://localhost:3000/app"],
    ["192.168.1.8:8080", "http://192.168.1.8:8080/"],
    ["nas:5000", "http://nas:5000/"],
    ["http://example.com", "http://example.com/"],
  ])("opens %s as %s", (input, url) => {
    expect(parseBrowserAddress(input)).toMatchObject({ ok: true, target: { url } });
  });

  it.each([
    ["google", "https://www.google.com/search?q=colab"],
    ["baidu", "https://www.baidu.com/s?wd=colab"],
    ["duckduckgo", "https://duckduckgo.com/?q=colab"],
  ] as const)("searches with %s", (engine, url) => {
    expect(parseBrowserAddress("colab", undefined, engine)).toMatchObject({
      ok: true,
      target: { url },
    });
  });

  it.each([
    { input: "user@intranet", reason: "credentials" },
    { input: "搜".repeat(2_000), reason: "invalid" },
  ])("refuses $reason input instead of searching it", ({ input, reason }) => {
    expect(parseBrowserAddress(input)).toEqual({ ok: false, reason });
  });
});
