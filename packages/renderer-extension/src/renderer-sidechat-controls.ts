import type {
  RendererHostRoute,
  RendererHostRouting,
} from "@codexhost/desktop-control/renderer-bindings";
import {
  SIDE_CHAT_UI_DIAGNOSTICS_METHOD,
  type SideChatUiDiagnostics,
} from "@codexhost/shared-contracts";
import {
  createSideChatLibrary,
  sideChatRows,
  type SideChatEntry,
} from "./renderer-sidechat-library.js";
import {
  createNativeSideChatActions,
  findSideChatConversationId,
} from "./renderer-sidechat-native.js";
import { sideChatIcon, sideChatMenuIcon, type SideChatIcon } from "./renderer-sidechat-icons.js";

import {
  AGENT_ICON,
  POINTER_STYLE,
  SCROLL,
  STYLE,
  sidebarTemplate,
  cloneIconButton,
  cloneSidebarHeading,
  cloneSidebarRow,
  disclosureStates,
  stripNativeBindings,
  sideChatTitles,
  sideChatRelativeTime,
  type Template,
} from "./renderer-sidechat-sidebar-style.js";

const SIDE_PANEL = '[role="tabpanel"][data-tab-id^="sidechat:"]';
const STRIP = '[data-app-shell-tab-strip-controller="right"]';
const TAB = '[data-app-shell-tab-controller="right"][data-tab-id]';
const CLOSE = "[data-app-shell-tab-close-button]";
const COLLAPSED_KEY = "codexhost:sidechats-collapsed";
// Keys that move focus; only they bring focus rings back after pointer input.
const NAVIGATION_KEY = /^(?:Tab|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/u;

type MenuId = "collect" | "uncollect" | "source" | "promote" | "archive";
interface MenuItem {
  id: MenuId;
  label: string;
  icon: SideChatIcon;
  enabled: boolean;
}
interface NativeMenuItem {
  id: string;
  type?: "separator";
  label: string;
  icon?: string;
  enabled?: boolean;
}
/** Desktop's preload bridge; it shows the same macOS menu as native thread rows. */
interface NativeMenuBridge {
  showContextMenu?(items: NativeMenuItem[], position?: { x: number; y: number }): Promise<unknown>;
}
interface Point {
  x: number;
  y: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The optional group only owns its inserted nodes and never edits a native row. */
export function installRendererSideChatControls(
  document: Document,
  routing: () => RendererHostRouting | undefined,
) {
  const view = document.defaultView;
  if (!view || !document.head || !document.body) return { dispose() {} };
  const owner = view;
  const hostId = "local";
  const native = createNativeSideChatActions(owner);
  const group = document.createElement("section");
  group.dataset.codexhostSidechats = "";
  group.setAttribute("aria-label", "侧边聊天");
  const style = document.createElement("style");
  style.textContent = STYLE;
  // Native rings come from :focus-visible, which a later key press (such as a screenshot
  // shortcut) can turn on after a click. Pointer input hides ours until keyboard navigation.
  const pointerStyle = document.createElement("style");
  pointerStyle.textContent = POINTER_STYLE;
  pointerStyle.media = "not all";
  document.head.append(style, pointerStyle);
  const locale = document.documentElement.lang || owner.navigator.language || "en";
  let collapsed = false;
  try {
    collapsed = owner.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    /* Optional storage. */
  }
  let expanded = false;
  let disposed = false;
  let generation = 0;
  let route: RendererHostRoute | null = null;
  let conversationId: string | undefined;
  let sidebar: HTMLElement | null = null;
  let sidebarOwner: Element | null = null;
  let bootstrapping = true;
  let page: Element | null = null;
  let strip: Element | null = null;
  let panelPin: { button: HTMLButtonElement; close: HTMLButtonElement; key: string } | null = null;
  let panelMode = false;
  let measured = false;
  let frame: number | null = null;
  let force = true;
  let failures = 0;
  let retry: number | null = null;
  let displayed = false;
  let entriesRoute: RendererHostRoute | null = null;
  const sourceTitles = new Map<string, string | null>();
  const projectNames = new Map<string, string | null>();
  // Agent per side chat, and detached copies of the agent icons codexhost draws on native rows.
  const agents = new Map<string, string>();
  const agentSamples = new Map<string, { presentation: string; node: HTMLElement }>();
  let operation: AbortController | null = null;
  let menu: { element: HTMLElement; trigger: HTMLButtonElement | null } | null = null;
  let nativeMenuOpen = false;
  let entries: {
    saved: SideChatEntry[];
    pending: SideChatEntry[];
    hints: Map<string, string>;
    titles: Map<string, string | null>;
  } | null = null;

  // Detached copies of the last live native rows. With Pinned, Recents and every project
  // collapsed there is no row to sample, and the group must not disappear because of that.
  let rowSample: { source: HTMLElement; row: HTMLElement; active?: HTMLElement } | undefined;
  // Chevron state classes, kept once both native states have been seen.
  let learnedDisclosure: ReturnType<typeof disclosureStates> = null;
  const templateOf = (root: HTMLElement) => {
    const template = sidebarTemplate(root, rowSample);
    if (template?.row.isConnected && rowSample?.source !== template.row) {
      rowSample = {
        source: template.row,
        row: template.row.cloneNode(true) as HTMLElement,
        ...(template.active?.isConnected
          ? { active: template.active.cloneNode(true) as HTMLElement }
          : rowSample?.active
            ? { active: rowSample.active }
            : {}),
      };
    }
    if (template?.disclosure.collapsed && template.disclosure.expanded)
      learnedDisclosure = disclosureStates(template.disclosure);
    return template;
  };
  const scanAgentSamples = (root: ParentNode | null) => {
    // One sample per agent per pass (the last in document order), so rows that briefly differ
    // while artwork loads cannot make consecutive passes alternate.
    const latest = new Map<string, HTMLElement>();
    for (const node of root?.querySelectorAll<HTMLElement>(`[${AGENT_ICON}]`) ?? []) {
      const agent = node.getAttribute(AGENT_ICON);
      if (agent && !group.contains(node)) latest.set(agent, node);
    }
    let changed = false;
    for (const [agent, node] of latest) {
      const presentation = node.dataset.presentation ?? "";
      if (agentSamples.get(agent)?.presentation === presentation) continue;
      agentSamples.set(agent, { presentation, node: node.cloneNode(true) as HTMLElement });
      changed = true;
    }
    return changed;
  };
  const agentMark = (agent: string | undefined) => {
    const sample = agent ? agentSamples.get(agent) : undefined;
    if (!agent || !sample) return null;
    const mark = sample.node.cloneNode(true) as HTMLElement;
    mark.removeAttribute(AGENT_ICON);
    delete mark.dataset.presentation;
    mark.dataset.codexhostSidechatAgent = agent;
    return mark;
  };
  const iconButton = (
    sample: HTMLButtonElement | null | undefined,
    name: SideChatIcon,
    label: string,
  ) => {
    const result = sample ? cloneIconButton(sample) : document.createElement("button");
    const old = result.querySelector("svg");
    const svg = sideChatIcon(document, name, old?.getAttribute("class") ?? "");
    if (old) old.replaceWith(svg);
    else result.replaceChildren(svg);
    result.type = "button";
    result.title = label;
    result.setAttribute("aria-label", label);
    return result;
  };
  const clientFor = (target: RendererHostRoute) =>
    createSideChatLibrary(async (method, params) => {
      const current = () => !disposed && routing()?.forHost(hostId) === target;
      if (!current()) throw new Error("聊天连接已改变");
      const response = await target.manager.sendRequest(method, params);
      if (!current()) throw new Error("聊天连接已改变");
      return response;
    });
  const closeMenu = (focus = false) => {
    const previous = menu;
    menu = null;
    previous?.element.remove();
    previous?.trigger?.setAttribute("aria-expanded", "false");
    if (focus) previous?.trigger?.focus();
  };
  const hide = () => {
    closeMenu();
    displayed = false;
    group.remove();
  };
  const removePanelPin = () => {
    panelPin?.button.remove();
    panelPin = null;
  };
  const fail = () => {
    entries = null;
    removePanelPin();
    hide();
  };
  const failedRefresh = () => {
    if (retry !== null) return;
    if (++failures >= 2) {
      fail();
      return;
    }
    retry = owner.setTimeout(() => {
      retry = null;
      schedule(true);
    }, 200);
  };
  const run = (
    action: (client: ReturnType<typeof clientFor>, signal: AbortSignal) => Promise<unknown>,
  ) => {
    if (disposed || operation || !route || entriesRoute !== route) return;
    const current = new AbortController();
    const client = clientFor(route);
    operation = current;
    closeMenu();
    void Promise.resolve()
      .then(() => {
        current.signal.throwIfAborted();
        return action(client, current.signal);
      })
      .then(
        () => {
          if (!current.signal.aborted) schedule(true);
        },
        () => {
          if (!disposed && !current.signal.aborted) schedule(true);
        },
      )
      .finally(() => {
        if (operation === current) operation = null;
      });
  };
  // Grouped like Desktop's thread menu: pinning first, navigation next, archive last.
  const menuItems = (entry: SideChatEntry): (MenuItem | null)[] => {
    const attached = entry.sourceAvailable !== false;
    return [
      entry.collected
        ? { id: "uncollect", label: "取消收纳", icon: "menuUnpin", enabled: true }
        : { id: "collect", label: "收纳到侧栏", icon: "menuPin", enabled: true },
      null,
      { id: "source", label: "打开原主对话", icon: "source", enabled: attached },
      { id: "promote", label: "转为独立主对话", icon: "menuFork", enabled: attached },
      null,
      { id: "archive", label: "归档", icon: "menuArchive", enabled: true },
    ];
  };
  const act = (entry: SideChatEntry, id: MenuId) => {
    if (id === "collect" || id === "uncollect")
      run((client) => client.collect(entry.threadId, id === "collect"));
    else if (id === "source")
      run((_client, signal) => native.navigate(entry.sourceThreadId, hostId, signal));
    else if (id === "promote")
      run(async (client, signal) => {
        const workspace = await client.workspaceRoot(entry.threadId);
        return native.promote(entry, hostId, signal, workspace);
      });
    else run((client) => client.setArchived(entry, true));
  };
  /** HTML fallback for windows without Desktop's native menu bridge. */
  const showMenu = (
    entry: SideChatEntry,
    at: Point,
    trigger: HTMLButtonElement | null,
    keyboard: boolean,
  ) => {
    if (trigger && menu?.trigger === trigger) {
      closeMenu(true);
      return;
    }
    closeMenu();
    const element = document.createElement("div");
    element.dataset.codexhostSidechatMenu = "";
    element.setAttribute("role", "menu");
    element.setAttribute("aria-label", "侧边聊天操作");
    element.tabIndex = -1;
    const items: HTMLButtonElement[] = [];
    for (const item of menuItems(entry)) {
      if (!item) {
        const separator = document.createElement("div");
        separator.setAttribute("role", "separator");
        element.append(separator);
        continue;
      }
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.tabIndex = -1;
      option.disabled = !item.enabled;
      const label = document.createElement("span");
      label.textContent = item.label;
      option.append(sideChatIcon(document, item.icon), label);
      option.addEventListener("click", () => act(entry, item.id));
      items.push(option);
      element.append(option);
    }
    const enabled = items.filter((item) => !item.disabled);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (event.key === "Tab") {
        closeMenu(true);
        return;
      }
      const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % enabled.length
          : event.key === "ArrowUp"
            ? (current + enabled.length - 1) % enabled.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? enabled.length - 1
                : -1;
      if (next >= 0) {
        event.preventDefault();
        event.stopPropagation();
        enabled[next]?.focus();
      }
    });
    menu = { element, trigger };
    trigger?.setAttribute("aria-expanded", "true");
    if (typeof element.showPopover === "function") element.setAttribute("popover", "manual");
    group.append(element);
    if (element.hasAttribute("popover")) element.showPopover();
    element.style.left = `${Math.max(8, Math.min(at.x, owner.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${at.y + element.offsetHeight + 8 <= owner.innerHeight ? at.y : Math.max(8, at.y - element.offsetHeight)}px`;
    // Like Desktop menus: keyboard opening focuses the first item, pointer opening the menu.
    if (keyboard) enabled[0]?.focus();
    else element.focus({ preventScroll: true });
  };
  const openMenu = (
    entry: SideChatEntry,
    at: Point,
    trigger: HTMLButtonElement | null,
    keyboard: boolean,
  ) => {
    const bridge = (owner as Window & { electronBridge?: NativeMenuBridge }).electronBridge;
    if (typeof bridge?.showContextMenu !== "function") {
      showMenu(entry, at, trigger, keyboard);
      return;
    }
    if (nativeMenuOpen) return;
    nativeMenuOpen = true;
    closeMenu();
    const items = menuItems(entry);
    const focused = document.activeElement;
    trigger?.setAttribute("aria-expanded", "true");
    try {
      // As Desktop does before its menu: the modal menu swallows the pointer release.
      document.dispatchEvent(new owner.PointerEvent("pointercancel"));
    } catch {
      /* Older engines have no PointerEvent constructor. */
    }
    void Promise.resolve()
      .then(() =>
        bridge.showContextMenu?.(
          items.map((item, index) =>
            item
              ? {
                  id: item.id,
                  label: item.label,
                  icon: sideChatMenuIcon(item.icon),
                  enabled: item.enabled,
                }
              : { id: `separator-${index}`, type: "separator" as const, label: "" },
          ),
          at,
        ),
      )
      .then((result) => {
        const id = record(result) && typeof result.id === "string" ? result.id : null;
        if (focused instanceof owner.HTMLElement && focused.isConnected) focused.focus();
        const item = items.find((candidate) => candidate?.id === id);
        if (item?.enabled && !disposed) act(entry, item.id);
      })
      .catch(() => undefined)
      .finally(() => {
        nativeMenuOpen = false;
        trigger?.setAttribute("aria-expanded", "false");
      });
  };
  const pinButton = (entry: SideChatEntry, sample?: HTMLButtonElement | null) => {
    const label = entry.collected ? "取消收纳" : "收纳到侧栏";
    const pin = iconButton(sample, entry.collected ? "pinSlash" : "pin", label);
    pin.disabled = false;
    pin.setAttribute("aria-pressed", String(entry.collected));
    pin.addEventListener("pointerdown", (event) => event.stopPropagation());
    pin.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      run((client) => client.collect(entry.threadId, !entry.collected));
    });
    return pin;
  };
  const visiblePanels = () => {
    const panels = [...document.querySelectorAll<HTMLElement>(SIDE_PANEL)].slice(0, 64);
    panelObserver.disconnect();
    for (const panel of panels)
      panelObserver.observe(panel, {
        attributes: true,
        attributeFilter: ["inert", "hidden", "aria-hidden"],
      });
    return panels.filter(
      (panel) =>
        panel.getClientRects().length && !panel.closest('[inert],[hidden],[aria-hidden="true"]'),
    );
  };
  const syncPanelPin = (panels: HTMLElement[]) => {
    if (entriesRoute !== route) {
      removePanelPin();
      return false;
    }
    const right = panels.filter(
      (panel) => panel.getAttribute("data-app-shell-tab-panel-controller") === "right",
    );
    const id = right.length === 1 ? right[0]?.getAttribute("data-tab-id") : undefined;
    const entry =
      id &&
      entries &&
      [...entries.saved, ...entries.pending].find((row) => `sidechat:${row.threadId}` === id);
    const tabs =
      id && strip
        ? [...strip.querySelectorAll(TAB)].filter((tab) => tab.getAttribute("data-tab-id") === id)
        : [];
    const close =
      tabs.length === 1 ? tabs[0]?.querySelector<HTMLButtonElement>(`button${CLOSE}`) : null;
    if (!entry || !close?.parentElement) {
      removePanelPin();
      return false;
    }
    const key = `${entry.threadId}:${entry.collected}:${close.className}`;
    if (panelPin?.key === key && panelPin.close === close && panelPin.button.nextSibling === close)
      return true;
    removePanelPin();
    const pin = pinButton(entry, close);
    pin.dataset.codexhostSidechatPanelPin = "";
    pin.style.position = "static";
    pin.style.transform = "none";
    pin.style.flex = "none";
    close.before(pin);
    panelPin = { button: pin, close, key };
    return true;
  };
  const renderRow = (entry: SideChatEntry, template: Template, active: boolean, name: string) => {
    const { row, open, title, titleText, time, more, rail, iconAnchor } = cloneSidebarRow(
      active && template.active ? template.active : template.row,
    );
    row.dataset.codexhostSidechatRow = entry.threadId;
    if (entry.sourceAvailable === false) row.dataset.codexhostSidechatOrphan = "";
    // Native 26.1029 rows show no time column, so the time goes into the hover hint.
    const when = sideChatRelativeTime(entry.updatedAt, locale);
    row.title = [entries?.hints.get(entry.threadId) ?? "", when].filter(Boolean).join(" · ");
    if (titleText) titleText.nodeValue = name;
    else title.textContent = name;
    if (time) time.textContent = when;
    const mark = agentMark(agents.get(entry.threadId));
    if (mark && iconAnchor) iconAnchor.before(mark);
    if (active) open.setAttribute("aria-current", "page");
    const reopen = () => run((_client, signal) => native.reopen(entry, hostId, signal));
    row.addEventListener("click", reopen);
    // Native rows open their thread menu on right click and with the menu keys.
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        openMenu(entry, { x: event.clientX, y: event.clientY }, null, false);
      } catch {
        fail();
      }
    });
    open.addEventListener("keydown", (event) => {
      if (event.target !== open) return;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        const box = open.getBoundingClientRect();
        openMenu(entry, { x: box.left, y: box.bottom }, null, true);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      reopen();
    });
    const actions = rail ?? document.createElement("div");
    if (!rail) {
      actions.dataset.codexhostSidechatActions = "";
      row.append(actions);
    }
    const pin = pinButton(entry, more);
    pin.dataset.codexhostSidechatAction = "";
    const trigger = iconButton(more, "more", "侧边聊天操作");
    trigger.dataset.codexhostSidechatAction = "";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("pointerdown", (event) => event.stopPropagation());
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const box = trigger.getBoundingClientRect();
      try {
        // A click from Enter or Space has no pointer detail.
        openMenu(entry, { x: box.left, y: box.bottom }, trigger, event.detail === 0);
      } catch {
        fail();
      }
    });
    actions.replaceChildren(pin, trigger);
    return row;
  };
  const place = (template: Template) => {
    if (
      template.before !== group &&
      (group.parentNode !== template.container || group.nextSibling !== template.before)
    )
      template.container.insertBefore(group, template.before);
  };
  const reportStyle = (template: Template, toggle: HTMLButtonElement, row: HTMLElement) => {
    if (measured || !route) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      const metrics = (box: Element, label: Element) => {
        const text = owner.getComputedStyle(label);
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = text.color;
        context.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
        return {
          fontSize: Number.parseFloat(text.fontSize),
          fontWeight: Number.parseFloat(text.fontWeight),
          color: [r, g, b, a] as [number, number, number, number],
          lineHeight: Number.parseFloat(text.lineHeight) || 0,
          height: box.getBoundingClientRect().height,
          paddingLeft: Number.parseFloat(owner.getComputedStyle(box).paddingLeft),
        };
      };
      const sample =
        row.getAttribute("data-codexhost-sidechat-active") === "true"
          ? (template.active ?? template.row)
          : template.row;
      const value: SideChatUiDiagnostics = {
        heading: {
          native: metrics(
            template.heading,
            template.toggle.querySelector("span") ?? template.toggle,
          ),
          sidechat: metrics(
            toggle.parentElement?.parentElement?.parentElement ?? toggle,
            toggle.querySelector("span") ?? toggle,
          ),
        },
        row: {
          native: metrics(sample, sample.querySelector("[data-thread-title]") ?? sample),
          sidechat: metrics(row, row.querySelector("[data-codexhost-sidechat-title]") ?? row),
        },
      };
      measured = true;
      void Promise.resolve(route.manager.sendRequest(SIDE_CHAT_UI_DIAGNOSTICS_METHOD, value)).catch(
        () => undefined,
      );
    } catch {
      /* Numeric diagnostics cannot affect the sidebar. */
    }
  };
  let renderedSelection = "";
  let renderedKey = "";
  let layout:
    | {
        headingKey: string;
        body: HTMLDivElement;
        toggle: HTMLButtonElement;
        syncCollapse: () => void;
      }
    | undefined;
  const cachedRows = new Map<string, { key: string; element: HTMLElement }>();
  const paint = (template: Template, panels = visiblePanels()) => {
    panelMode = syncPanelPin(panels);
    const snapshot = entries;
    const pending = panelMode ? [] : (snapshot?.pending ?? []);
    if (!snapshot || (!snapshot.saved.length && !pending.length)) {
      hide();
      cachedRows.clear();
      return;
    }
    const activeIds = new Set([
      conversationId,
      ...panels.map((panel) => panel.getAttribute("data-tab-id")?.slice("sidechat:".length)),
    ]);
    renderedSelection = [...activeIds].join("\u0000");
    const headingKey = JSON.stringify([
      template.section,
      template.heading.className,
      template.toggle.className,
    ]);
    const shown = [...snapshot.saved, ...pending];
    const names = sideChatTitles(shown, snapshot.titles);
    const rowSpecs = shown.map((entry) => {
      const active = activeIds.has(entry.threadId);
      const name = names.get(entry.threadId) ?? "侧边聊天";
      const agent = agents.get(entry.threadId);
      const key = JSON.stringify([
        entry,
        active,
        name,
        agent,
        agent && agentSamples.get(agent)?.presentation,
        template.row.className,
        template.active?.className,
        snapshot.hints.get(entry.threadId),
      ]);
      return { entry, active, name, key };
    });
    const key = JSON.stringify([
      headingKey,
      snapshot.saved.length,
      expanded,
      rowSpecs.map((row) => row.key),
    ]);
    if (displayed && key === renderedKey) {
      place(template);
      return;
    }
    closeMenu();
    if (!layout || layout.headingKey !== headingKey) {
      group.className = template.section;
      const body = document.createElement("div");
      const { heading, toggle, chevron } = cloneSidebarHeading(template);
      const firstStates = disclosureStates(template.disclosure);
      // Native chevrons turn by class: right while collapsed, down (on hover) while expanded.
      const syncCollapse = () => {
        toggle.setAttribute("aria-expanded", String(!collapsed));
        body.hidden = collapsed;
        const states = learnedDisclosure ?? firstStates;
        if (!chevron || !states) return;
        chevron.classList.remove(...states.collapsed, ...states.expanded);
        chevron.classList.add(...(collapsed ? states.collapsed : states.expanded));
      };
      toggle.addEventListener("click", () => {
        closeMenu();
        collapsed = !collapsed;
        try {
          owner.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
        } catch {
          /* Optional storage. */
        }
        syncCollapse();
      });
      group.replaceChildren(heading, body);
      layout = { headingKey, body, toggle, syncCollapse };
    }
    layout.syncCollapse();
    const retained = new Set<string>();
    const rows = rowSpecs.map(({ entry, active, name, key }) => {
      retained.add(entry.threadId);
      const cached = cachedRows.get(entry.threadId);
      if (cached?.key === key) return cached.element;
      const element = renderRow(entry, template, active, name);
      element.dataset.codexhostSidechatActive = String(active);
      cachedRows.set(entry.threadId, { key, element });
      return element;
    });
    for (const id of cachedRows.keys()) if (!retained.has(id)) cachedRows.delete(id);
    const nodes = rows.slice(0, snapshot.saved.length + 3);
    if (pending.length > 3) {
      const rest = document.createElement("div");
      rest.hidden = !expanded;
      rest.append(...rows.slice(snapshot.saved.length + 3));
      const more = (template.showAll ?? template.toggle).cloneNode(true) as HTMLButtonElement;
      stripNativeBindings(more);
      // Desktop's own labels for a long sidebar list.
      const syncMore = () => {
        rest.hidden = !expanded;
        more.textContent = expanded ? "收起" : "展开显示";
        more.setAttribute("aria-expanded", String(expanded));
      };
      more.addEventListener("click", () => {
        expanded = !expanded;
        syncMore();
      });
      syncMore();
      nodes.push(rest, more);
    }
    let next = layout.body.firstChild;
    for (const node of nodes) {
      if (node === next) next = next.nextSibling;
      else layout.body.insertBefore(node, next);
    }
    while (next) {
      const node = next;
      next = node.nextSibling;
      layout.body.removeChild(node);
    }
    renderedKey = key;
    displayed = true;
    place(template);
    const row = rows[0];
    if (row && !collapsed) reportStyle(template, layout.toggle, row);
  };
  const refresh = async (target: RendererHostRoute, id: string | undefined, current: number) => {
    const client = clientFor(target);
    const [collected, currentItems] = await Promise.all([
      client.list(),
      id
        ? client
            .sourceThreadId(id)
            .catch(() => undefined)
            .then((sourceId) => (sourceId ? client.list(sourceId) : []))
        : [],
    ]);
    const isCurrent = () =>
      !disposed && current === generation && routing()?.forHost(hostId) === target;
    if (!isCurrent()) return;
    if (entriesRoute !== target) {
      sourceTitles.clear();
      projectNames.clear();
      agents.clear();
    }
    failures = 0;
    if (retry !== null) owner.clearTimeout(retry);
    retry = null;
    const { saved, pending } = sideChatRows(collected, currentItems);
    const all = [...saved, ...pending];
    const show = () => {
      const hints = new Map(
        all.map((entry) => [
          entry.threadId,
          entry.sourceAvailable === false
            ? "原主对话不可用"
            : [
                `原主对话：${sourceTitles.get(entry.sourceThreadId) ?? entry.sourceThreadId}`,
                entry.projectId
                  ? `项目：${projectNames.get(entry.projectId) ?? entry.projectId}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · "),
        ]),
      );
      entries = { saved, pending, hints, titles: new Map(sourceTitles) };
      entriesRoute = target;
      const template = sidebar && templateOf(sidebar);
      if (template) {
        scanAgentSamples(sidebar);
        paint(template);
      }
    };
    show();
    const sources = [
      ...new Set(
        all.filter((entry) => entry.sourceAvailable !== false).map((entry) => entry.sourceThreadId),
      ),
    ].filter((id) => !sourceTitles.has(id));
    const projects = [
      ...new Set(
        all.flatMap((entry) =>
          entry.sourceAvailable !== false && entry.projectId ? [entry.projectId] : [],
        ),
      ),
    ].filter((id) => !projectNames.has(id));
    const unknownAgents = all.map((entry) => entry.threadId).filter((id) => !agents.has(id));
    if (!sources.length && !projects.length && !unknownAgents.length) return;
    const [titles, names, owners] = await Promise.all([
      Promise.all(
        sources.map(
          async (id) => [id, await client.sourceTitle(id).catch(() => undefined)] as const,
        ),
      ),
      Promise.all(
        projects.map(
          async (id) => [id, await client.projectName(id).catch(() => undefined)] as const,
        ),
      ),
      // Ownership is optional decoration; rows keep working without the agent icon.
      unknownAgents.length
        ? client.agents(unknownAgents).catch(() => new Map<string, string>())
        : new Map<string, string>(),
    ]);
    if (!isCurrent()) return;
    for (const [id, title] of titles) if (title !== undefined) sourceTitles.set(id, title);
    for (const [id, name] of names) if (name !== undefined) projectNames.set(id, name);
    // An empty agent means "no icon" and is not asked again on this connection.
    for (const id of unknownAgents) agents.set(id, owners.get(id) ?? "");
    while (sourceTitles.size > 256) sourceTitles.delete(sourceTitles.keys().next().value ?? "");
    while (projectNames.size > 256) projectNames.delete(projectNames.keys().next().value ?? "");
    while (agents.size > 512) agents.delete(agents.keys().next().value ?? "");
    show();
  };

  // Observe the sidebar and shallow owner paths after the bounded bootstrap scan.
  const observer = new owner.MutationObserver((records) => {
    if (displayed && !group.isConnected) {
      try {
        const current = sidebar?.isConnected
          ? sidebar
          : document.querySelector<HTMLElement>(SCROLL);
        const template = current && templateOf(current);
        if (template) place(template);
      } catch {
        /* A partially mounted native sidebar will be checked on the next frame. */
      }
    }
    if (
      records.some(
        (record) =>
          !group.contains(record.target) &&
          record.target !== panelPin?.button &&
          (record.type === "attributes" ||
            [...record.removedNodes, ...record.addedNodes].some(
              (node) => node !== group && node !== panelPin?.button,
            ) ||
            !group.isConnected),
      )
    )
      schedule();
  });
  const panelObserver = new owner.MutationObserver(() => schedule());
  const observe = () => {
    observer.disconnect();
    if (!sidebar && bootstrapping) {
      observer.observe(document.getElementById("root") ?? document.body, {
        subtree: true,
        childList: true,
      });
      return;
    }
    if (sidebar)
      observer.observe(sidebar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "data-app-action-sidebar-thread-active",
          "data-app-action-sidebar-section-collapsed",
        ],
      });
    if (strip)
      observer.observe(strip, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-tab-id", "aria-selected"],
      });
    for (const start of [
      sidebarOwner?.isConnected ? sidebarOwner : (document.getElementById("root") ?? document.body),
      page,
    ]) {
      let node = start;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement)
        if (node !== sidebar)
          observer.observe(node, {
            childList: true,
            attributes: true,
            attributeFilter: ["data-app-shell-active-page"],
          });
    }
  };
  const startup = owner.setTimeout(() => {
    bootstrapping = false;
    observe();
  }, 10_000);
  function sync() {
    const nextSidebar = sidebar?.isConnected
      ? sidebar
      : document.querySelector<HTMLElement>(SCROLL);
    const nextPage = document.querySelector('[data-app-shell-active-page="true"]');
    const strips = [...document.querySelectorAll(STRIP)].filter(
      (item) =>
        item.getClientRects().length && !item.closest('[inert],[hidden],[aria-hidden="true"]'),
    );
    const nextStrip = strips.length === 1 ? (strips[0] ?? null) : null;
    if (nextSidebar !== sidebar || nextPage !== page || nextStrip !== strip) {
      strip = nextStrip;
      sidebar = nextSidebar;
      if (sidebar) {
        sidebarOwner = sidebar.parentElement;
        bootstrapping = false;
        owner.clearTimeout(startup);
      }
      page = nextPage;
      observe();
    }
    if (!sidebar) return;
    const template = templateOf(sidebar);
    const nextRoute = routing()?.forHost(hostId) ?? null;
    if (!nextRoute) {
      if (route) {
        route = null;
        generation += 1;
        operation?.abort();
        operation = null;
        removePanelPin();
      }
      force = true;
      failedRefresh();
      return;
    }
    if (!template) return;
    const detectedId = findSideChatConversationId(owner);
    const nextId = detectedId ?? conversationId;
    const routeChanged = nextRoute !== route;
    if (routeChanged || nextId !== conversationId) {
      if (routeChanged) {
        operation?.abort();
        operation = null;
        removePanelPin();
      }
      route = nextRoute;
      conversationId = nextId;
      expanded = false;
      force = true;
    }
    if (force && (routeChanged || detectedId !== undefined || conversationId === undefined)) {
      force = false;
      const current = ++generation;
      void refresh(nextRoute, nextId, current).catch(() => {
        if (!disposed && current === generation) failedRefresh();
      });
    }
    const panels = visiblePanels();
    const mode = syncPanelPin(panels);
    // Native rows gain their agent icons after mount; repaint once a new icon is available.
    const newIcons = scanAgentSamples(sidebar);
    const selection = [
      ...new Set([
        conversationId,
        ...panels.map((panel) => panel.getAttribute("data-tab-id")?.slice("sidechat:".length)),
      ]),
    ].join("\u0000");
    if (
      entries &&
      (!group.isConnected || mode !== panelMode || selection !== renderedSelection || newIcons)
    )
      paint(template, panels);
    else if (group.isConnected) place(template);
  }
  function schedule(reload = false) {
    if (disposed) return;
    force ||= reload;
    if (frame !== null) return;
    frame = owner.requestAnimationFrame(() => {
      frame = null;
      try {
        sync();
      } catch {
        fail();
      }
    });
  }
  const navigation = (event: Event) => {
    const target = event.target;
    if (target instanceof owner.Node && group.contains(target)) return;
    // Native tab and sidebar clicks can change the in-memory route before window.location.
    schedule(
      event.type === "click" &&
        target instanceof owner.Element &&
        !!target.closest('[role="tab"], [data-app-action-sidebar-thread-row]'),
    );
  };
  const outside = (event: Event) => {
    if (pointerStyle.media !== "all") pointerStyle.media = "all";
    if (
      menu &&
      event.target instanceof owner.Node &&
      !menu.element.contains(event.target) &&
      !menu.trigger?.contains(event.target)
    )
      closeMenu();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (NAVIGATION_KEY.test(event.key) && pointerStyle.media !== "not all")
      pointerStyle.media = "not all";
  };
  const notification = (event: MessageEvent) => {
    if (event.source != null && event.source !== owner) return;
    const data = event.data as { type?: string; hostId?: string; method?: string } | null;
    if (
      data?.type === "mcp-notification" &&
      data.hostId === hostId &&
      data.method &&
      [
        "thread/started",
        "thread/name/updated",
        "thread/archived",
        "thread/unarchived",
        "turn/completed",
      ].includes(data.method)
    ) {
      if (data.method === "thread/name/updated") sourceTitles.clear();
      schedule(true);
    }
  };
  const routeChanged = () => schedule();
  const scroll = () => closeMenu();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("click", navigation, true);
  document.addEventListener("scroll", scroll, true);
  owner.addEventListener("popstate", navigation);
  owner.addEventListener("message", notification);
  owner.addEventListener("codexhost:draft-prewarm-policy-changed", routeChanged);
  observe();
  schedule();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      operation?.abort();
      observer.disconnect();
      panelObserver.disconnect();
      owner.clearTimeout(startup);
      if (retry !== null) owner.clearTimeout(retry);
      if (frame !== null) owner.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("click", navigation, true);
      document.removeEventListener("scroll", scroll, true);
      owner.removeEventListener("popstate", navigation);
      owner.removeEventListener("message", notification);
      owner.removeEventListener("codexhost:draft-prewarm-policy-changed", routeChanged);
      removePanelPin();
      hide();
      style.remove();
      pointerStyle.remove();
    },
  };
}
