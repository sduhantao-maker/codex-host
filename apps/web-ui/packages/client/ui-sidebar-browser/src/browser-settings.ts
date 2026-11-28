/** Sidebar Browser preferences stored in the Host user-settings document. */

import z from "@deepseek-ai/schemastery";

/** Settings namespace owned by the Sidebar Browser. */
export const BROWSER_SETTINGS_NAMESPACE = "ui-sidebar-browser";

/** Search pages for address-bar text that names no host; the query goes in `param`. */
export const BROWSER_SEARCH_ENGINES = {
  bing: { url: "https://www.bing.com/search", param: "q" },
  google: { url: "https://www.google.com/search", param: "q" },
  baidu: { url: "https://www.baidu.com/s", param: "wd" },
  duckduckgo: { url: "https://duckduckgo.com/", param: "q" },
} as const;

/** Search engine a user can choose. */
export type BrowserSearchEngine = keyof typeof BROWSER_SEARCH_ENGINES;

/** Bing answers without a proxy in more regions than the other engines. */
export const DEFAULT_BROWSER_SEARCH_ENGINE: BrowserSearchEngine = "bing";

/** Where an address-bar entry opens: this Sidebar tab, or the viewer's default browser. */
export type BrowserAddressOpening = "sidebar" | "new-tab";

/** Keep address-bar entries in the Sidebar for users without an explicit preference. */
export const DEFAULT_BROWSER_ADDRESS_OPENING: BrowserAddressOpening = "sidebar";

/** Durable Sidebar Browser section shared by the Host schema and the client. */
export interface BrowserSettings {
  /** Engine for address-bar text that names no host. */
  searchEngine: BrowserSearchEngine;
  /** Destination for address-bar entries. */
  addressOpening: BrowserAddressOpening;
}

/** Durable Sidebar Browser schema; the Web server fixture serializes the same fields. */
export const BrowserSettingsFields = {
  searchEngine: z
    .union(["bing", "google", "baidu", "duckduckgo"])
    .default(DEFAULT_BROWSER_SEARCH_ENGINE),
  addressOpening: z.union(["sidebar", "new-tab"]).default(DEFAULT_BROWSER_ADDRESS_OPENING),
};
