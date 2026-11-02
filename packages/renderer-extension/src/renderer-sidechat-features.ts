import type {
  RendererHostRoute,
  RendererHostRouting,
} from "@codexhost/desktop-control/renderer-bindings";
import {
  SIDE_CHAT_FEATURES_CHANGED_METHOD,
  SIDE_CHAT_FEATURES_GET_METHOD,
  sideChatFeaturesResultSchema,
} from "@codexhost/shared-contracts";
import { installRendererSideChatControls } from "./renderer-sidechat-controls.js";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Optional controls follow one acknowledged local connection, independently of the original UI. */
export function installRendererSideChatFeatures(
  document: Document,
  routing: () => RendererHostRouting | undefined,
) {
  const owner = document.defaultView;
  if (!owner) return { dispose() {} };
  let disposed = false;
  let generation = 0;
  let route: RendererHostRoute | null = null;
  let controls: ReturnType<typeof installRendererSideChatControls> | null = null;
  const localRoute = () => {
    try {
      return routing()?.forHost("local") ?? null;
    } catch {
      return null;
    }
  };
  const disable = () => {
    const previous = controls;
    controls = null;
    try {
      previous?.dispose();
    } catch {
      /* Optional cleanup cannot retire the original binding. */
    }
  };
  const apply = (value: unknown) => {
    const raw = record(value) && record(value.result) ? value.result : value;
    const result = sideChatFeaturesResultSchema.safeParse(raw);
    if (
      !result.success ||
      !result.data.settings.sideChatLibrary ||
      !result.data.capabilities.sideChatLibrary ||
      localRoute() !== route
    ) {
      disable();
      return;
    }
    if (!controls && document.head && document.body) {
      try {
        controls = installRendererSideChatControls(document, routing);
      } catch (error) {
        disable();
        console.error(
          "codexhost optional side chat controls unavailable",
          error instanceof Error ? error.name : "UnknownError",
        );
      }
    }
  };
  const refresh = () => {
    if (disposed) return;
    const current = ++generation;
    route = localRoute();
    const target = route;
    if (!target) return;
    void Promise.resolve()
      .then(() => target.manager.sendRequest(SIDE_CHAT_FEATURES_GET_METHOD, {}))
      .then((value) => {
        if (!disposed && current === generation && localRoute() === target) apply(value);
      })
      .catch(() => {
        /* Mounted controls handle transient Host failures. */
      });
  };
  const changed = (event: MessageEvent) => {
    if (disposed || (event.source != null && event.source !== owner)) return;
    const data: unknown = event.data;
    if (
      !record(data) ||
      data.type !== "mcp-notification" ||
      data.hostId !== "local" ||
      data.method !== SIDE_CHAT_FEATURES_CHANGED_METHOD
    )
      return;
    if (localRoute() !== route) {
      refresh();
      return;
    }
    generation += 1;
    try {
      apply(data.params);
    } catch {
      disable();
    }
  };
  owner.addEventListener("message", changed);
  owner.addEventListener("codexhost:draft-prewarm-policy-changed", refresh);
  document.addEventListener("DOMContentLoaded", refresh, { once: true });
  refresh();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      disable();
      owner.removeEventListener("message", changed);
      owner.removeEventListener("codexhost:draft-prewarm-policy-changed", refresh);
      document.removeEventListener("DOMContentLoaded", refresh);
    },
  };
}
