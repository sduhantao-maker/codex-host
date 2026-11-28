/** Register the HTTP(S) Browser tab type in the right Sidebar. */
import type { ShortcutCommandId } from "@deepseek-ai/dsh-client-shortcuts/client";
import type { Context } from "@deepseek-ai/cordis";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-api-workspace-controller/client";
import {
  BROWSER_SETTINGS_NAMESPACE,
  DEFAULT_BROWSER_ADDRESS_OPENING,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  type BrowserAddressOpening,
  type BrowserSearchEngine,
  type BrowserSettings,
} from "../browser-settings.ts";
import { BrowserBody, type BrowserBodyProps } from "./view/BrowserBody.tsx";
import { BrowserTitle } from "./view/BrowserTitle.tsx";
import { createBrowserControllers } from "./browser/BrowserController.ts";
import type { BrowserInjected, BrowserPreferences } from "./browser/BrowserController.ts";
import { BrowserChoiceRow, type BrowserChoiceRowInjected } from "./settings/BrowserChoiceRow.tsx";
import { DirectSession } from "./remote/DirectSession.ts";
import { createRemotePage } from "./remote/pages.ts";
import { createElectronPage } from "./electron/pages.ts";
import type { DesktopBrowserBridge } from "../types.ts";
import { browserWorkspace } from "./electron/workspace.ts";
import type { BrowserPageFactory } from "./browser/BrowserPage.ts";
import { BROWSER_ID, browserDefinition } from "./definition.tsx";
import { en, zh } from "./locales.ts";
import { createBrowserStore } from "./browser/store.ts";

export type { BrowserBodyProps } from "./view/BrowserBody.tsx";
export type {
  BrowserControllerState,
  BrowserInjected,
  BrowserMountRequest,
} from "./browser/BrowserController.ts";
export type {
  BrowserFrame,
  BrowserFrameState,
  BrowserLoadError,
  BrowserSandboxControl,
} from "./browser/BrowserFrame.ts";
export type { BrowserPage, BrowserPageFactory, BrowserPageOptions } from "./browser/BrowserPage.ts";
export type { BrowserPresentation } from "./view/BrowserPresentation.ts";
export type {
  BrowserFailure,
  BrowserHistoryEntry,
  BrowserNavigationStatus,
  BrowserTabState,
} from "./browser/BrowserPersistence.ts";
export type { SidebarBrowserKey } from "./locales.ts";
export type { BrowserState } from "./browser/store.ts";
export type { BrowserAddressFailure, BrowserAddressResult, BrowserTarget } from "./browser/url.ts";

declare module "@deepseek-ai/dsh-client-ui-sidebar-right/client" {
  interface SidebarRightTabParamsMap {
    /** Optional initial Browser URL. */
    browser: { readonly url?: string };
  }
}

/** Required Browser services. */
export const inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs", "configForms"];

/** Register the Browser type, localized guide entry, body, and title. */
export function apply(ctx: Context): void {
  const namespace = "sidebarBrowser";
  const t = ctx.locale.bind(namespace);
  ctx.inject(["shortcuts"], (ctx) => {
    ctx.effect(
      () =>
        ctx.shortcuts.register({
          id: "browser.new" as ShortcutCommandId,
          label: () => t("guide.title"),
          aliases: ["browser", "new browser tab"],
          defaults: {
            "desktop:macos": { code: "KeyT", modifiers: ["primary"] },
            "desktop:windows": { code: "KeyT", modifiers: ["primary"] },
            "desktop:linux": { code: "KeyT", modifiers: ["primary"] },
            "web:macos": { code: "KeyT", modifiers: ["primary", "alt"] },
            "web:windows": { code: "KeyT", modifiers: ["primary", "alt"] },
          },
          // Each tab plugin owns its command's availability, localized refusal, and tab kind.
          /* jscpd:ignore-start */
          regions: ["page", "editable", "terminal"],
          modals: [],
          resolve: ({ target: element }) => {
            const target = ctx.sidebarRight.commandTarget(element);
            if (target === undefined) return { status: "blocked", reason: t("shortcut.noSession") };
            return {
              status: "handled",
              run: () => {
                ctx.sidebarRight.openTabFromTarget("browser", target);
              },
            };
          },
          /* jscpd:ignore-end */
        }),
      "ui-sidebar-browser: shortcut",
    );
  });
  const store = createBrowserStore();
  const openTabs = ctx.sidebarRight.openTabs;
  const settings = ctx.configForms.get<BrowserSettings>(BROWSER_SETTINGS_NAMESPACE);
  const searchEngine = createSnapshotStore<BrowserSearchEngine>(
    settings.getSnapshot().value?.searchEngine ?? DEFAULT_BROWSER_SEARCH_ENGINE,
  );
  const addressOpening = createSnapshotStore<BrowserAddressOpening>(
    settings.getSnapshot().value?.addressOpening ?? DEFAULT_BROWSER_ADDRESS_OPENING,
  );
  ctx.effect(
    () =>
      settings.subscribe(() => {
        const accepted = settings.getSnapshot().value;
        if (accepted?.searchEngine !== undefined) searchEngine.set(accepted.searchEngine);
        if (accepted?.addressOpening !== undefined) addressOpening.set(accepted.addressOpening);
      }),
    "ui-sidebar-browser.settings",
  );
  const preferences: BrowserPreferences = {
    searchEngine: () => searchEngine.getSnapshot(),
    addressOpening: () => addressOpening.getSnapshot(),
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
  const preferenceRow = (
    id: string,
    order: number,
    injected: () => BrowserChoiceRowInjected,
  ): void => {
    ctx.effect(
      () =>
        ctx.slots.inject("settings.general.item", () =>
          ctx.slots.register(
            { name: "settings.general.item", id, order, locale: namespace, inject: injected },
            BrowserChoiceRow,
          ),
        ),
      `ui-sidebar-browser.${id}`,
    );
  };
  // Directly below the Chat link destination row (order 17).
  preferenceRow("browser-search-engine", 17.25, () => ({
    hooks: { choice: searchEngine },
    title: "settings.searchEngine.title",
    description: "settings.searchEngine.description",
    choices: [
      { id: "bing", label: "settings.searchEngine.bing" },
      { id: "google", label: "settings.searchEngine.google" },
      { id: "baidu", label: "settings.searchEngine.baidu" },
      { id: "duckduckgo", label: "settings.searchEngine.duckduckgo" },
    ],
    choose: (id) => {
      searchEngine.set(id as BrowserSearchEngine);
      void settings.set("searchEngine", id as BrowserSearchEngine).catch(() => {
        // The local choice remains usable when persistence is unavailable.
      });
    },
  }));
  preferenceRow("browser-address-opening", 17.5, () => ({
    hooks: { choice: addressOpening },
    title: "settings.addressOpening.title",
    description: "settings.addressOpening.description",
    choices: [
      { id: "sidebar", label: "settings.addressOpening.sidebar" },
      { id: "new-tab", label: "settings.addressOpening.newTab" },
    ],
    choose: (id) => {
      addressOpening.set(id as BrowserAddressOpening);
      void settings.set("addressOpening", id as BrowserAddressOpening).catch(() => {
        // The local choice remains usable when persistence is unavailable.
      });
    },
  }));
  const carrier = (
    globalThis as typeof globalThis & {
      dshDesktop?: { readonly protocolVersion: number; readonly browser?: DesktopBrowserBridge };
    }
  ).dshDesktop;
  const desktop = carrier?.protocolVersion === 1 ? carrier.browser : undefined;
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), "ui-sidebar-browser.copy");
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        ...browserDefinition(t),
        keepMounted: desktop !== undefined,
      }),
    "ui-sidebar-browser.type",
  );
  const installFrames = (
    scope: Context,
    factory: (sessionId: BrowserBodyProps["sessionId"]) => BrowserPageFactory,
  ): void => {
    const controllers = new Map<BrowserBodyProps["sessionId"], BrowserInjected>();
    scope.effect(
      () => async () => {
        const pending = [...controllers.values()].map((controller) => controller.dispose());
        controllers.clear();
        await Promise.all(pending);
      },
      "ui-sidebar-browser.frames",
    );
    scope.effect(
      () =>
        scope.slots.inject("sidebar.right.pane.tab", () =>
          scope.slots.register(
            {
              name: "sidebar.right.pane.tab",
              key: BROWSER_ID,
              locale: namespace,
              store,
              inject: (sessionId, actions) => {
                const existing = controllers.get(sessionId);
                if (existing !== undefined) {
                  existing.rebind(actions);
                  return existing;
                }
                const controller = createBrowserControllers(
                  actions,
                  factory(sessionId),
                  (tabId) =>
                    openTabs
                      .getSnapshot()
                      .some((tab) => tab.sessionId === sessionId && tab.tabId === tabId),
                  preferences,
                );
                controllers.set(sessionId, controller);
                return controller;
              },
            },
            BrowserBody,
          ),
        ),
      "ui-sidebar-browser.body",
    );
  };
  if (desktop === undefined) {
    const direct = new DirectSession();
    ctx.effect(() => () => direct.dispose(), "ui-sidebar-browser.direct");
    installFrames(
      ctx,
      (sessionId) => (options) =>
        createRemotePage(
          options,
          `${String(sessionId)}:${options.tabId}`,
          t("remote.input"),
          direct,
        ),
    );
  } else
    ctx.inject(["workspaces"], (scope) => {
      installFrames(
        scope,
        (sessionId) => (options) =>
          createElectronPage(options, desktop, (signal) =>
            browserWorkspace(scope.workspaces.list, sessionId, signal),
          ),
      );
    });
  ctx.effect(
    () =>
      ctx.slots.inject("sidebar.right.pane.tab.title", () =>
        ctx.slots.register(
          {
            name: "sidebar.right.pane.tab.title",
            key: BROWSER_ID,
            store,
          },
          BrowserTitle,
        ),
      ),
    "ui-sidebar-browser.title",
  );
}
