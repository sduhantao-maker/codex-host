import type { SideChatEntry } from "./renderer-sidechat-library.js";

export const SCROLL = "[data-app-action-sidebar-scroll]";
const SECTION = "[data-app-action-sidebar-section][data-app-action-sidebar-section-heading]";
const TOGGLE = "[data-app-action-sidebar-section-toggle]";
const ROW = "[data-app-action-sidebar-thread-row]";
const ACTIVE = '[data-app-action-sidebar-thread-active="true"]';
const TITLE = "[data-thread-title]";
const TRIGGER = "[data-thread-title-trigger]";
const OPEN = "[data-interactive-row-link]";
const MORE = '[aria-haspopup="menu"]';
// 26.1029 hover cards hold either the thread status or the row's hover buttons.
const HOVER = "[data-hover-card-open-immediately]";
// Status, unread marks and codexhost's agent icon describe the sampled thread, so clones drop them.
const ROW_STATE = "[data-loading-indicator],[data-codexhost-sidebar-agent-icon]";
export const AGENT_ICON = "data-codexhost-sidebar-agent-icon";
// Button-q1uiwE takes its size, color and shape from these attributes.
const BUTTON_PRESENTATION = new Set([
  "data-color",
  "data-variant",
  "data-size",
  "data-squircle",
  "data-uniform",
]);
// 26.1029 disclosure state: collapsed sections point right; expanded ones point down and show
// on hover. Classes learned from live sections replace these once both states are visible.
const DISCLOSURE = {
  collapsed: ["opacity-100", "-rotate-90"],
  expanded: ["opacity-0", "rotate-0"],
};
export const STYLE = `
[data-codexhost-sidechats] [hidden]{display:none!important}
[data-codexhost-sidechat-row]{position:relative}
[data-codexhost-sidechat-orphan]{opacity:.65}
[data-codexhost-sidechat-open]{cursor:pointer;pointer-events:auto}
[data-codexhost-sidechat-actions]{display:none;position:absolute;inset-inline-end:4px;top:50%;transform:translateY(-50%);align-items:center;gap:4px;pointer-events:auto}
[data-codexhost-sidechat-row]:hover [data-codexhost-sidechat-actions],[data-codexhost-sidechat-row]:focus-within [data-codexhost-sidechat-actions],[data-codexhost-sidechat-row]:has([aria-expanded=true]) [data-codexhost-sidechat-actions]{display:flex}
[data-codexhost-sidechat-row]:has([aria-expanded=true]) [data-codexhost-sidechat-rail]{opacity:1}
[data-codexhost-sidechat-row]:hover [data-codexhost-sidechat-time],[data-codexhost-sidechat-row]:focus-within [data-codexhost-sidechat-time],[data-codexhost-sidechat-row]:has([aria-expanded=true]) [data-codexhost-sidechat-time]{visibility:hidden}
[data-codexhost-sidechats] :focus:not(:focus-visible),[data-codexhost-sidechat-panel-pin]:focus:not(:focus-visible){outline:none;box-shadow:none}
[data-codexhost-sidechat-menu]{position:fixed;inset:auto;z-index:10000;min-width:180px;max-width:calc(100vw - 16px);margin:0;pointer-events:auto}
[data-codexhost-sidechat-menu]:focus{outline:none}
:where([data-codexhost-sidechat-menu]){padding:5px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-token-main-surface-primary);color:var(--color-text);box-shadow:0 8px 24px #0002;font-size:13px}
:where([data-codexhost-sidechat-menu] [role=menuitem]){display:flex;align-items:center;gap:8px;width:100%;font:inherit;color:inherit;border:0;background:none;border-radius:6px;padding:4px 8px;text-align:start;white-space:nowrap}
:where([data-codexhost-sidechat-menu] [role=separator]){height:1px;margin:4px 8px;background:var(--color-border)}
[data-codexhost-sidechat-menu] [role=menuitem] svg{width:16px;height:16px;flex:none}
[data-codexhost-sidechat-menu] [role=menuitem]:focus-visible,[data-codexhost-sidechat-menu] [role=menuitem]:hover{background:var(--color-background-primary-ghost-hover,var(--color-background-secondary));outline:none}
[data-codexhost-sidechat-menu] [role=menuitem]:disabled{opacity:.45}
`;
/** Enabled after pointer input; keyboard navigation turns it off so focus rings return. */
export const POINTER_STYLE =
  "[data-codexhost-sidechats] :focus-visible,[data-codexhost-sidechat-panel-pin]:focus-visible,[data-codexhost-sidechat-menu] :focus-visible{outline:none!important;box-shadow:none!important}";

function timestamp(row: Element): HTMLElement | undefined {
  return (
    row.querySelector<HTMLElement>("time, [data-thread-timestamp]") ??
    [...row.querySelectorAll<HTMLElement>("div,span")].find(
      (node) =>
        !node.children.length &&
        !node.closest(TITLE) &&
        /^(?:just now|刚刚|\d+(?:[mhdwy]|mo|\s+(?:分钟|小时|天|周|个月|年)前))$/u.test(
          node.textContent?.trim() ?? "",
        ),
    )
  );
}

export interface DisclosureClasses {
  collapsed?: readonly string[];
  expanded?: readonly string[];
}

/** Class tokens that differ between a collapsed and an expanded native section chevron. */
export function disclosureStates(
  classes: DisclosureClasses,
): { collapsed: readonly string[]; expanded: readonly string[] } | null {
  const { collapsed, expanded } = classes;
  if (collapsed && expanded)
    return {
      collapsed: collapsed.filter((token) => !expanded.includes(token)),
      expanded: expanded.filter((token) => !collapsed.includes(token)),
    };
  // With one visible state, trust the 26.1029 tokens only if that state really uses them.
  const seen = collapsed ?? expanded;
  const expected = collapsed ? DISCLOSURE.collapsed : DISCLOSURE.expanded;
  return seen && expected.every((token) => seen.includes(token)) ? DISCLOSURE : null;
}

export function sidebarTemplate(
  sidebar: HTMLElement,
  fallback?: { row: HTMLElement; active?: HTMLElement },
) {
  const sections = [...sidebar.querySelectorAll<HTMLElement>(SECTION)];
  const pinned = sections.find(
    (item) => item.getAttribute("data-app-action-sidebar-section-heading") === "Pinned",
  );
  const first = sections[0];
  const container = (pinned ?? first)?.parentElement;
  const sample = sections.find(
    (section) => section.parentElement === container && section.querySelector(TOGGLE),
  );
  const toggle = sample?.querySelector<HTMLButtonElement>(TOGGLE);
  const heading = toggle?.parentElement?.parentElement?.parentElement;
  // Only the title is required: 26.1029 rows have no OPEN link, and older builds do.
  const rows = [...sidebar.querySelectorAll<HTMLElement>(ROW)].filter((row) =>
    row.querySelector(TITLE),
  );
  const inactive = rows.filter((row) => !row.matches(ACTIVE));
  // Collapsed Pinned/Recents and a collapsed Projects list leave no row to sample.
  const row = inactive.find(timestamp) ?? inactive[0] ?? rows[0] ?? fallback?.row;
  if (
    !first ||
    !sample ||
    !container ||
    !toggle ||
    !heading ||
    heading === sample ||
    !sample.contains(heading) ||
    !row
  )
    return null;
  const disclosure: { collapsed?: string[]; expanded?: string[] } = {};
  for (const section of sections) {
    const button = section.querySelector(TOGGLE);
    const chevron = button?.querySelector("svg");
    const state = button?.getAttribute("aria-expanded");
    if (chevron && (state === "true" || state === "false"))
      disclosure[state === "true" ? "expanded" : "collapsed"] ??= [...chevron.classList];
  }
  return {
    container,
    before: pinned ? pinned.nextSibling : first,
    section: sample.className,
    heading,
    toggle,
    disclosure,
    row,
    active: rows.find((candidate) => candidate.matches(ACTIVE)) ?? fallback?.active,
    showAll: sidebar.querySelector<HTMLButtonElement>(
      "[data-app-action-sidebar-project-show-all-toggle]",
    ),
  };
}

export type Template = NonNullable<ReturnType<typeof sidebarTemplate>>;

export function stripNativeBindings(root: Element, keep?: ReadonlySet<string>): void {
  for (const node of [root, ...root.querySelectorAll("*")]) {
    for (const { name } of [...node.attributes]) {
      if (node === root && keep?.has(name)) continue;
      if (
        /^(?:data-|on|id$|href$|target$|tabindex$|title$|aria-(?:controls|label(?:ledby)?|describedby|owns|activedescendant|current|selected)$)/u.test(
          name,
        )
      )
        node.removeAttribute(name);
    }
  }
}

/** A native icon button without its bindings, keeping Button-q1uiwE presentation. */
export function cloneIconButton(sample: HTMLButtonElement): HTMLButtonElement {
  const button = sample.cloneNode(true) as HTMLButtonElement;
  stripNativeBindings(button, BUTTON_PRESENTATION);
  for (const name of ["aria-haspopup", "aria-expanded", "aria-pressed", "disabled"])
    button.removeAttribute(name);
  return button;
}

export function cloneSidebarHeading(template: Template) {
  const heading = template.heading.cloneNode(true) as HTMLElement;
  const toggle = heading.querySelector<HTMLButtonElement>(TOGGLE);
  const label = toggle?.querySelector("span");
  if (!toggle || !label) throw new Error("Native sidebar heading unavailable");
  for (const button of heading.querySelectorAll("button")) if (button !== toggle) button.remove();
  stripNativeBindings(heading);
  // The native toggle is also a sortable handle; this one only collapses the group.
  toggle.removeAttribute("aria-roledescription");
  toggle.removeAttribute("aria-disabled");
  label.textContent = "侧边聊天";
  toggle.dataset.codexhostSidechatHeading = "";
  return { heading, toggle, chevron: toggle.querySelector("svg") };
}

export function cloneSidebarRow(sample: HTMLElement) {
  const row = sample.cloneNode(true) as HTMLElement;
  const title = row.querySelector<HTMLElement>(TITLE);
  if (!title) throw new Error("Native sidebar row unavailable");
  const trigger = row.querySelector<HTMLElement>(TRIGGER);
  const open = row.querySelector<HTMLElement>(OPEN) ?? row;
  const time = timestamp(row);
  // A native hover action keeps the icon-button styling for the pin and menu trigger.
  const action = row.querySelector<HTMLButtonElement>(`${HOVER} button`);
  const more = row.querySelector<HTMLButtonElement>(`button${MORE}`) ?? action;
  const sampleButton = more ? cloneIconButton(more) : undefined;
  // 26.1029 shows hover buttons in a positioned rail revealed on row hover; reuse it.
  const rail = action?.parentElement && action.parentElement !== row ? action.parentElement : null;
  for (const node of row.querySelectorAll(HOVER)) if (!rail || !node.contains(rail)) node.remove();
  for (const node of row.querySelectorAll(ROW_STATE)) node.remove();
  // The slot before the title holds the sampled thread's unread or pinned mark.
  const slot = trigger?.previousElementSibling;
  if (slot && !slot.querySelector(TITLE))
    for (const child of slot.children) child.replaceChildren();
  rail?.replaceChildren();
  for (const duplicate of title.querySelectorAll("[data-marquee-copy]")) duplicate.remove();
  const titleWalker = row.ownerDocument.createTreeWalker(title, 4);
  let titleText = titleWalker.nextNode();
  while (titleText && !titleText.nodeValue?.trim()) titleText = titleWalker.nextNode();
  const walker = row.ownerDocument.createTreeWalker(row, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = "";
  for (const node of row.querySelectorAll("button,img,input")) if (node !== open) node.remove();
  // The agent icon goes before the title's outermost wrapper inside the title trigger.
  let iconAnchor = title;
  while (
    trigger &&
    iconAnchor.parentElement &&
    iconAnchor.parentElement !== trigger &&
    trigger.contains(iconAnchor.parentElement)
  )
    iconAnchor = iconAnchor.parentElement;
  stripNativeBindings(row);
  open.setAttribute("role", "button");
  open.tabIndex = 0;
  open.dataset.codexhostSidechatOpen = "";
  title.dataset.codexhostSidechatTitle = "";
  if (rail) rail.dataset.codexhostSidechatRail = "";
  // A detached time node (removed with the row state) must not be filled.
  const shownTime = time && row.contains(time) ? time : undefined;
  if (shownTime) shownTime.dataset.codexhostSidechatTime = "";
  return {
    row,
    title,
    titleText,
    open,
    time: shownTime,
    more: sampleButton,
    rail,
    iconAnchor: trigger?.contains(iconAnchor) ? iconAnchor : null,
  };
}

const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim();
const FALLBACK = "侧边聊天";

/** The name or the side chat's first prompt; null when only a fallback can describe it. */
function ownTitle(entry: SideChatEntry): string | null {
  const title = oneLine(entry.title);
  if (title && title.toLowerCase() !== "side chat") return title;
  return oneLine(entry.preview ?? "") || null;
}

export function sideChatTitle(entry: SideChatEntry, sourceTitle?: string | null): string {
  const source = oneLine(sourceTitle ?? "");
  return ownTitle(entry) ?? (source ? `${FALLBACK} · ${source}` : FALLBACK);
}

/**
 * Row titles. Without a name or prompt a row shows its source, numbered like Desktop's
 * "侧边聊天 {index}" only when such rows would otherwise read the same.
 */
export function sideChatTitles(
  entries: readonly SideChatEntry[],
  sourceTitles: ReadonlyMap<string, string | null | undefined>,
): Map<string, string> {
  const titles = new Map<string, string>();
  const fallbacks = new Map<string, string[]>();
  for (const entry of entries) {
    const own = ownTitle(entry);
    if (own) {
      titles.set(entry.threadId, own);
      continue;
    }
    const source = oneLine(sourceTitles.get(entry.sourceThreadId) ?? "");
    const ids = fallbacks.get(source) ?? [];
    ids.push(entry.threadId);
    fallbacks.set(source, ids);
  }
  for (const [source, ids] of fallbacks) {
    // Thread ids keep the numbering stable while rows move with activity.
    const ordered = ids.length > 1 ? [...ids].sort() : ids;
    ordered.forEach((id, index) => {
      const label = ids.length > 1 ? `${FALLBACK} ${index + 1}` : FALLBACK;
      titles.set(id, source ? `${label} · ${source}` : label);
    });
  }
  return titles;
}

export function sideChatRelativeTime(
  updatedAt: number | undefined,
  locale: string,
  now = Date.now(),
): string {
  if (!updatedAt) return "";
  const seconds = Math.max(0, Math.floor(now / 1000 - updatedAt));
  const zh = locale.toLowerCase().startsWith("zh");
  if (seconds < 60) return zh ? "刚刚" : "just now";
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor((day(new Date(now)) - day(new Date(updatedAt * 1000))) / 86_400_000);
  const [value, en, cn] =
    seconds < 3_600
      ? [Math.floor(seconds / 60), "m", "分钟"]
      : seconds < 86_400
        ? [Math.floor(seconds / 3_600), "h", "小时"]
        : days < 7
          ? [days, "d", "天"]
          : days < 30
            ? [Math.floor(days / 7), "w", "周"]
            : days < 365
              ? [Math.floor(days / 30), "mo", "个月"]
              : [Math.floor(days / 365), "y", "年"];
  return zh ? `${value} ${cn}前` : `${value}${en}`;
}
