/** Address parsing for the Sidebar browser's HTTP(S) allowlist. */

import {
  BROWSER_SEARCH_ENGINES,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  type BrowserSearchEngine,
} from "../../browser-settings.ts";

/** Maximum accepted address length; this bounds persisted navigation state. */
export const MAX_BROWSER_URL_LENGTH = 16 * 1024;

/** Loopback, mDNS and IP-literal hosts, which Chrome does not upgrade to HTTPS. */
const PLAIN_HTTP_HOST = /^(?:localhost|.+\.localhost|.+\.local|\d+\.\d+\.\d+\.\d+|\[.+\])$/u;

/** A normalized Browser navigation target. */
export type BrowserTarget =
  | { readonly kind: "https"; readonly url: string; readonly title: string }
  | { readonly kind: "http"; readonly url: string; readonly title: string };

/** Why an address was refused before navigation. */
export type BrowserAddressFailure =
  "empty" | "invalid" | "protocol" | "credentials" | "application-origin";

/** Result of parsing an address-bar value. */
export type BrowserAddressResult =
  | { readonly ok: true; readonly target: BrowserTarget }
  | { readonly ok: false; readonly reason: BrowserAddressFailure };

/**
 * Parse one address-bar value into the fixed protocol allowlist; scheme-less text that names no
 * host becomes a search.
 * @param input - user or typed-open input.
 * @param applicationOrigin - current DSH document origin, blocked for HTTPS.
 * @param searchEngine - engine for text that names no host.
 * @returns a canonical target or the refusal reason.
 */
export function parseBrowserAddress(
  input: string,
  applicationOrigin?: string,
  searchEngine: BrowserSearchEngine = DEFAULT_BROWSER_SEARCH_ENGINE,
): BrowserAddressResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_BROWSER_URL_LENGTH) return { ok: false, reason: "invalid" };
  const explicitScheme = /^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u.test(trimmed);
  const candidate = explicitScheme ? trimmed : typedAddress(trimmed, searchEngine);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.href.length > MAX_BROWSER_URL_LENGTH) return { ok: false, reason: "invalid" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  if (url.protocol === "https:" || url.protocol === "http:") {
    if (applicationOrigin !== undefined && applicationOrigin !== "null") {
      try {
        if (url.origin === new URL(applicationOrigin).origin)
          return { ok: false, reason: "application-origin" };
      } catch {
        // An unavailable application origin cannot grant access to a target.
      }
    }
    return {
      ok: true,
      target: {
        kind: url.protocol === "https:" ? "https" : "http",
        url: url.href,
        title: url.hostname,
      },
    };
  }
  return { ok: false, reason: "protocol" };
}

/**
 * Resolve scheme-less input as Chrome's address bar does: text that names no host is searched,
 * local and single-label hosts with a port use HTTP, and other hosts keep the HTTPS default.
 */
function typedAddress(text: string, searchEngine: BrowserSearchEngine): string {
  let url: URL;
  try {
    url = new URL(`http://${text}`);
  } catch {
    return searchAddress(text, searchEngine);
  }
  const singleLabel = !url.hostname.includes(".");
  const port = /:\d+$/u.test(text.split(/[/?#]/u, 1)[0] ?? "");
  if (PLAIN_HTTP_HOST.test(url.hostname) || (singleLabel && port)) return url.href;
  // Credentials stay in the address so they are refused instead of being sent to the search.
  if (singleLabel && url.username === "" && url.password === "")
    return searchAddress(text, searchEngine);
  return `https://${text}`;
}

function searchAddress(text: string, searchEngine: BrowserSearchEngine): string {
  const engine = BROWSER_SEARCH_ENGINES[searchEngine];
  const url = new URL(engine.url);
  url.searchParams.set(engine.param, text);
  return url.href;
}
