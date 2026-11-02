import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const evidenceDir = process.env.CODEXHOST_SIDECHAT_NATIVE_FIXTURE;
const realFixture =
  evidenceDir && (await readFile(path.join(evidenceDir, "native-sidebar.html"), "utf8"));
const origin = "https://sidechat.test";
const sidebar = "[data-app-action-sidebar-scroll]";
const group = "[data-codexhost-sidechats]";
const row = "[data-codexhost-sidechat-row]";
const stableSaved = '[data-codexhost-sidechat-row="side-1"]';
const visibleRow = `${row}:visible`;
const oldMore = /本对话还有.*条侧边聊天/u;
const pinned =
  '[data-app-action-sidebar-section][data-app-action-sidebar-section-heading="Pinned"]';
const projects =
  '[data-app-action-sidebar-section][data-app-action-sidebar-section-heading="Projects"]';
const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root {color-scheme: light; --color-token-main-surface-primary:#fff; --color-token-main-surface-secondary:#f7f7f7; --color-token-main-surface-tertiary:#ececec; --color-token-text-primary:#202020; --color-token-text-secondary:#6a6a6a; --color-token-border-default:#dedede; --color-token-main-surface-hover:#ededed; --color-token-main-surface-selected:#e8e8e8; --color-border:var(--color-token-border-default); --color-text:var(--color-token-text-primary); --color-text-secondary:var(--color-token-text-secondary); --color-background-secondary:var(--color-token-main-surface-tertiary); --color-background-primary-ghost-hover:var(--color-token-main-surface-hover);}
:root[data-theme=dark] {color-scheme:dark; --color-token-main-surface-primary:#212121; --color-token-main-surface-secondary:#181818; --color-token-main-surface-tertiary:#323232; --color-token-text-primary:#ececec; --color-token-text-secondary:#a0a0a0; --color-token-border-default:#383838; --color-token-main-surface-hover:#292929; --color-token-main-surface-selected:#303030;}
* {box-sizing:border-box} body {margin:0;color:var(--color-token-text-primary);background:var(--color-token-main-surface-primary);font:14px system-ui,sans-serif} button {font:inherit;color:inherit;background:none;border:0;cursor:pointer} button:focus-visible {outline:2px solid #669dfa;outline-offset:1px}
#root {display:flex;min-height:100vh} .fixture-sidebar {width:320px;min-height:100vh;padding:16px 10px;background:var(--color-token-main-surface-secondary);border-right:1px solid var(--color-token-border-default)} .fixture-brand {padding:6px 10px 20px;font-size:15px;font-weight:650} main {padding:36px;color:var(--color-token-text-secondary)}
.fixture-section {margin-bottom:12px} .fixture-heading {display:flex;align-items:center;min-height:32px;padding:0 9px;color:var(--color-token-text-secondary);font-size:12px;font-weight:600} .fixture-toggle {display:flex;align-items:center;gap:5px;padding:0;font:inherit} .fixture-toggle svg {width:12px;height:12px}
.fixture-row {position:relative;display:flex;align-items:center;gap:8px;min-height:34px;width:100%;border-radius:7px;padding:0 9px;text-align:left} .fixture-row:hover {background:var(--color-token-main-surface-hover)} .fixture-active {background:var(--color-token-main-surface-selected)} .fixture-title {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .fixture-time {flex:none;font-size:11px;color:var(--color-token-text-secondary)} .fixture-more {display:flex;align-items:center;gap:4px;min-height:32px;padding:0 9px;color:var(--color-token-text-secondary);font-size:12px;text-align:left}
</style><link rel="modulepreload" href="/native-fixture.js"></head><body><div id="root"><aside class="fixture-sidebar" data-app-action-sidebar-scroll>
<div class="fixture-brand">Codex</div>
<section class="fixture-section" data-app-action-sidebar-section data-app-action-sidebar-section-heading="Pinned" data-app-action-sidebar-section-collapsed="false">
  <div class="fixture-heading group/nav-section-title"><div><div><button class="fixture-toggle" data-app-action-sidebar-section-toggle aria-expanded="true"><span>置顶</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div></div>
  <div class="fixture-row fixture-active" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="parent-1" data-app-action-sidebar-thread-title="中红外光谱分析" data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-pinned="true" data-app-action-sidebar-thread-active="true" aria-current="page"><div data-thread-title-trigger><a data-interactive-row-link href="/local/parent-1"><span class="fixture-title" data-thread-title>中红外光谱分析</span></a></div><div class="fixture-time text-codex-description tabular-nums" data-thread-timestamp>2 小时前</div></div>
</section>
<section class="fixture-section" data-app-action-sidebar-section data-app-action-sidebar-section-heading="Projects" data-app-action-sidebar-section-collapsed="false">
  <div class="fixture-heading group/nav-section-title"><div><div><button class="fixture-toggle" data-app-action-sidebar-section-toggle aria-expanded="true"><span>项目</span></button></div></div></div>
  <div class="fixture-row" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="parent-2" data-app-action-sidebar-thread-title="论文数据与图表" data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-pinned="false" data-app-action-sidebar-thread-active="false"><div data-thread-title-trigger><a data-interactive-row-link href="/local/parent-2"><span class="fixture-title" data-thread-title>论文数据与图表</span></a></div><div class="fixture-time text-codex-description tabular-nums" data-thread-timestamp>1 天前</div></div>
  <button class="fixture-more" data-app-action-sidebar-project-show-all-toggle>显示全部 <span aria-hidden="true">›</span></button>
</section></aside><main data-app-shell-active-page="true">中红外光谱分析</main></div></body></html>`;

const nativeModule = `
export const navigation = {
  handlers: new Map([["navigate-to-route", true]]),
  dispatchHostMessage(message) {
    window.nativeCalls.push({ action: "navigate", path: message.path });
    window.setContext(message.path.slice("/local/".length));
    if (window.waitForNavigation && !document.querySelector('link[href="/route-committed.js"]')) {
      const link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = "/route-committed.js";
      document.head.append(link);
    }
  },
};
export function SideChatTab() {
  return { lockedCollaborationMode: true, sideConversation: true, key: "side-chat:", preserveServerConfiguration: true };
}
export const registration = {
  kind: "local-side-chat", Component: SideChatTab,
  async open(scope, component, input) {
    window.nativeCalls.push({ action: "reopen", threadId: input.attachedConversationId, sourceThreadId: input.sourceConversationId, target: input.target });
    return input.attachedConversationId;
  },
};
export async function fork(scope, { sourceConversationId, sourceWorkspaceRoot }) {
  // These names identify the native fork contract without loading any actual Desktop modules.
  window.nativeCalls.push({ action: "promote", sourceConversationId, sourceWorkspaceRoot });
  void "getThreadExecutionState forkConversationIntoLocal threadHeader.forkThreadPending";
  return "promoted-1";
}
`;

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererSideChatFeatures } from './packages/renderer-extension/src/renderer-sidechat-features.ts';
      window.setup = ({ enabled = true, empty = false, orphan = false, conversationId = 'parent-1', failList = false, waitForNavigation = false, morePending = false } = {}) => {
        const now = Math.floor(Date.now() / 1000);
        const unsaved = { threadId:'side-3', sourceThreadId:'parent-1', projectId:'project-1', title:'Side chat', preview:'把这个实验条件单独记一下', updatedAt:now-300, collected:false };
        const items = empty ? [] : [
          { threadId:'side-2', sourceThreadId:'parent-2', projectId:'project-2', title:'Side chat', preview:'对比两种峰位拟合方法', updatedAt:now-3600, collected:true, ...(orphan ? {sourceAvailable:false} : {}) },
          { threadId:'side-1', sourceThreadId:'parent-1', projectId:'project-1', title:'整理实验记录', preview:'已有标题时不用这条预览', updatedAt:now-120, collected:true },
          unsaved,
        ];
        if (morePending) for (let index = 4; index <= 6; index++) {
          items.push({...unsaved, threadId:'side-'+index, preview:'待收纳 '+index, updatedAt:now-index*100});
        }
        window.calls = [];
        window.nativeCalls = [];
        window.waitForNavigation = waitForNavigation;
        const notify = (method) => window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'mcp-notification',hostId:'local',method}}));
        window.createSideChat = (entry = {}) => { items.push({...unsaved, ...entry}); notify('thread/started'); };
        const heldRequests = new Map();
        window.holdRequest = (key) => {
          let release;
          const ready = new Promise(resolve => { release = resolve; });
          heldRequests.set(key, { ready, release });
        };
        window.releaseRequest = (key) => {
          const held = heldRequests.get(key);
          heldRequests.delete(key);
          held?.release();
        };
        let failNextSavedList = false;
        window.failSavedListOnce = () => { failNextSavedList = true; notify('thread/started'); };
        window.showPanel = (id) => {
          document.querySelector('[data-test-right-pane]')?.remove();
          const right = document.createElement('div');
          right.dataset.testRightPane = '';
          const strip = document.createElement('div');
          strip.dataset.appShellTabStripController = 'right';
          const tab = document.createElement('div');
          tab.dataset.appShellTabController = 'right';
          tab.dataset.tabId = 'sidechat:' + id;
          tab.innerHTML = '<button role="tab" aria-selected="true">侧聊</button><button type="button" class="fixture-close" data-app-shell-tab-close-button aria-label="关闭侧聊"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8m0-8l-8 8" stroke="currentColor"/></svg></button>';
          strip.append(tab);
          const panel = document.createElement('div');
          panel.setAttribute('role', 'tabpanel');
          panel.dataset.appShellTabPanelController = 'right';
          panel.dataset.tabId = 'sidechat:' + id;
          panel.textContent = '打开的侧聊';
          right.append(strip, panel);
          document.querySelector('main').append(right);
        };
        const scope = (id) => ({ node:{}, chain:[], scope:{}, value:{routeKind:'local-thread', conversationId:id, hostId:'local'}, get(){},set(){},watch(){} });
        const fiber = (id) => ({ memoizedState:{ memoizedState:{ current:scope(id) }, next:null } });
        window.setContext = (id, secondScope) => {
          const previous = document.querySelector('main');
          const main = previous.cloneNode(true);
          previous.replaceWith(main);
          if (!id) { delete main.__reactFiber$test; history.replaceState(null, '', '/'); return; }
          main.__reactFiber$test = fiber(id);
          if (secondScope) main.__reactFiber$test.child = fiber(secondScope);
          main.__reactFiber$test.return = { memoizedProps:{ value:{ navigationType:'PUSH', location:{pathname:'/local/'+id,search:''} } } };
        };
        window.setContext(conversationId);
        window.switchRoute = (id) => {
          document.querySelector('main').__reactFiber$test.return.memoizedProps.value.location.pathname = '/local/' + id;
          window.dispatchEvent(new PopStateEvent('popstate'));
        };
        const features = () => ({ settings:{persistentSideChats:false,sideChatLibrary:enabled,claudeActiveSideChatFork:false}, capabilities:{persistentSideChats:true,sideChatLibrary:true,claudeActiveSideChatFork:true} });
        const route = { hostId:'local', manager:{ async sendRequest(method, params) {
          window.calls.push({method, params});
          const key = method === 'codexhost/sideChat/list' ? 'list:' + (params.sourceThreadId ?? 'saved')
            : method === 'thread/read' ? 'thread:' + params.threadId
            : method === 'project/read' ? 'project:' + params.projectId : null;
          const held = heldRequests.get(key);
          if (held) await held.ready;
          if (method === 'codexhost/sideChat/features/get') return features();
          if (method === 'codexhost/sideChat/list') {
            if (failList) throw new Error('fixture list failure');
            if (failNextSavedList && !params.sourceThreadId) {
              failNextSavedList = false;
              throw new Error('transient fixture list failure');
            }
            return {items:items.filter(item => !item.archived && (params.sourceThreadId ? item.sourceThreadId === params.sourceThreadId : item.collected))};
          }
          if (method === 'codexhost/sideChat/update') {
            const item = items.find(item => item.threadId === params.threadId);
            if (!item) throw new Error('Unknown child');
            item.collected = params.collected;
            if (params.archived !== undefined) item.archived = params.archived;
            return {item:{...item}};
          }
          if (method === 'codexhost/sideChat/uiDiagnostics') return {};
          if (method === 'thread/archive') {
            items.find(item => item.threadId === params.threadId).archived = true;
            return {};
          }
          if (method === 'thread/read') {
            const item = items.find(item => item.threadId === params.threadId);
            return { thread:{ id:params.threadId, name:params.threadId === 'parent-3' ? '第三个主对话' : params.threadId === 'parent-2' ? '论文数据与图表' : '中红外光谱分析', cwd:'/work/project', ...(item ? {forkedFromId:item.sourceThreadId} : {}) } };
          }
          if (method === 'project/read') return {project:{id:params.projectId,name:params.projectId === 'project-3' ? '第三个项目' : params.projectId === 'project-2' ? '论文撰写' : '光谱研究'}};
          if (method === 'codexhost/thread/ownership/list') return {threads:params.threadIds.map(threadId => ({threadId, owner:'external', harnessId:'claude-code'}))};
          throw new Error('Unexpected request: ' + method);
        } } };
        const routing = () => ({forHost:() => route});
        window.controls = installRendererSideChatFeatures(document, routing);
        window.changeFeatures = value => {
          enabled = value;
          window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'mcp-notification',hostId:'local',method:'codexhost/sideChat/features/changed',params:features()}}));
        };
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
});
const bundle = outputFiles[0]?.text ?? "";

interface FixtureOptions {
  enabled?: boolean;
  empty?: boolean;
  orphan?: boolean;
  conversationId?: string;
  failList?: boolean;
  waitForNavigation?: boolean;
  morePending?: boolean;
}
interface FixtureWindow {
  setup(options: FixtureOptions): void;
  changeFeatures(enabled: boolean): void;
  setContext(id?: string, secondScope?: string): void;
  createSideChat(entry?: Record<string, unknown>): void;
  holdRequest(key: string): void;
  releaseRequest(key: string): void;
  failSavedListOnce(): void;
  stopSidebarTrace(): { frames: number; hidden: number; replaced: number };
  showPanel(id: string): void;
  switchRoute(id: string): void;
  calls: { method: string; params: Record<string, unknown> }[];
  nativeCalls: Record<string, unknown>[];
}

const savedRow = (page: Page) => page.locator(row).filter({ hasText: "整理实验记录" });
const requests = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).calls);
const nativeCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as FixtureWindow).nativeCalls);
const openMenu = async (page: Page) => {
  await savedRow(page).hover();
  await savedRow(page).getByRole("button", { name: "侧边聊天操作" }).click();
  return page.getByRole("menu");
};
const setup = (page: Page, options: FixtureOptions = {}) =>
  page.evaluate((input) => (window as unknown as FixtureWindow).setup(input), options);
const waitFrames = (page: Page, count = 3) =>
  page.evaluate(
    (remaining) =>
      new Promise<void>((resolve) => {
        const next = () => (--remaining > 0 ? requestAnimationFrame(next) : resolve());
        requestAnimationFrame(next);
      }),
    count,
  );
const startSidebarTrace = (page: Page) =>
  page.evaluate(
    ({ group, saved }) => {
      const node = document.querySelector(saved);
      if (!node) throw new Error("saved row missing before trace");
      const result = { frames: 0, hidden: 0, replaced: 0 };
      let frame = 0;
      const sample = () => {
        result.frames++;
        if (
          !document.querySelector(group)?.getBoundingClientRect().height ||
          !node.getBoundingClientRect().height
        )
          result.hidden++;
        if (document.querySelector(saved) !== node) result.replaced++;
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      (window as unknown as FixtureWindow).stopSidebarTrace = () => {
        cancelAnimationFrame(frame);
        return result;
      };
    },
    { group, saved: stableSaved },
  );

test.beforeEach(async ({ page }) => {
  await page.route(`${origin}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: realFixture && test.info().title.startsWith("real CSS") ? realFixture : fixture,
    }),
  );
  await page.route(`${origin}/native-fixture.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: nativeModule }),
  );
  await page.route(`${origin}/route-committed.js`, async (route) => {
    await page.waitForFunction(() =>
      (window as unknown as FixtureWindow).calls.some(
        (call) =>
          call.method === "codexhost/sideChat/list" && call.params.sourceThreadId === "parent-1",
      ),
    );
    await route.fulfill({ contentType: "text/javascript", body: "export {};" });
  });
  if (evidenceDir)
    await page.route(/\/(desktop-assets|assets)\//u, async (route) => {
      const relative = new URL(route.request().url()).pathname.replace(
        /^\/(desktop-assets\/)?/u,
        "",
      );
      const file = path.join(evidenceDir, "desktop-assets", relative);
      if (path.relative(path.join(evidenceDir, "desktop-assets"), file).startsWith("..")) {
        await route.abort();
        return;
      }
      await route.fulfill({ path: file });
    });
  await page.goto(`${origin}/`);
  await page.addScriptTag({ content: bundle });
});

// Captured from the installed Desktop 26.1029.61003 sidebar on 2026-11-04: thread rows are
// clickable DIVs with no [data-interactive-row-link]; they carry a status indicator, hover
// actions and codexhost's agent icon. The previous template required the link and hid the group.
const desktop261029Rows = () => {
  for (const native of document.querySelectorAll("[data-app-action-sidebar-thread-row]")) {
    const link = native.querySelector("[data-interactive-row-link]");
    if (link) link.replaceWith(...link.childNodes);
    native.querySelector("[data-thread-timestamp]")?.remove();
    const trigger = native.querySelector("[data-thread-title-trigger]");
    const agent = document.createElement("span");
    agent.setAttribute("data-codexhost-sidebar-agent-icon", "claude-code");
    agent.dataset.presentation = '["claude-code","Claude Code"]';
    agent.setAttribute("role", "img");
    agent.setAttribute("aria-label", "Claude Code Agent");
    agent.innerHTML = '<svg class="test-claude-icon" width="14" height="14"></svg>';
    trigger?.prepend(agent);
    const unread = document.createElement("div");
    unread.className = "test-leading-slot";
    unread.innerHTML = '<div><span class="test-unread-dot"></span></div>';
    trigger?.before(unread);
    const status = document.createElement("div");
    status.setAttribute("data-hover-card-open-immediately", "");
    status.innerHTML =
      '<span><div role="img"><div data-loading-indicator><svg width="14" height="14"></svg></div></div></span>';
    const actions = document.createElement("div");
    actions.setAttribute("data-hover-card-open-immediately", "");
    actions.style.display = "contents";
    actions.innerHTML =
      '<div class="test-hover-rail"><button type="button" class="native-row-action" data-color="secondary" data-size="3xs" data-state="closed" aria-label="置顶聊天"><span class="test-button-inner"><svg class="test-native-icon" width="16" height="16" viewBox="0 0 16 16"></svg></span></button></div>';
    native.append(status, actions);
  }
};

test("mounts with Desktop 26.1029 rows that have no row link", async ({ page }) => {
  await page.evaluate(desktop261029Rows);
  await setup(page);
  await expect(page.locator(`${pinned} + ${group} + ${projects}`)).toHaveCount(1);
  await expect(savedRow(page)).toBeVisible();
  await expect(savedRow(page)).toHaveAttribute("title", /2\s*分钟前$/u);
  const leftovers = await page
    .locator(group)
    .evaluate(
      (node) =>
        node.querySelectorAll(
          "[data-loading-indicator],[data-codexhost-sidebar-agent-icon],[data-hover-card-open-immediately]",
        ).length,
    );
  expect(leftovers).toBe(0);
  // The sampled thread's unread mark stays native; the slot keeps its layout.
  await expect(savedRow(page).locator(".test-unread-dot")).toHaveCount(0);
  await expect(savedRow(page).locator(".test-leading-slot > div")).toHaveCount(1);
  await savedRow(page).hover();
  // Hover buttons sit in the reused native rail and keep Button-q1uiwE presentation.
  await expect(savedRow(page).locator(".test-hover-rail button")).toHaveCount(2);
  const menu = savedRow(page).getByRole("button", { name: "侧边聊天操作" });
  await expect(menu).toHaveClass(/native-row-action/);
  await expect(menu).toHaveAttribute("data-size", "3xs");
  await expect(menu).toHaveAttribute("data-color", "secondary");
  await expect(menu).not.toHaveAttribute("data-state", /.*/u);
  await expect(
    menu.locator('.test-button-inner > svg.test-native-icon[viewBox="0 0 16 16"]'),
  ).toHaveCount(1);
  await expect(menu.locator("svg path")).toHaveCount(3);
  const pin = savedRow(page).getByRole("button", { name: "取消收纳", exact: true });
  await expect(pin.locator("svg.test-native-icon path")).toHaveCount(2);
  // The agent icon is copied from a native row of the same agent and sits before the title.
  const agent = savedRow(page).locator('[data-codexhost-sidechat-agent="claude-code"]');
  await expect(agent).toHaveCount(1);
  await expect(agent.locator(".test-claude-icon")).toHaveCount(1);
  await expect(agent).toHaveAccessibleName("Claude Code Agent");
  expect(
    await agent.evaluate(
      (node) => !!node.nextElementSibling?.matches("[data-codexhost-sidechat-title]"),
    ),
  ).toBe(true);
});

test("turns the chevron with native classes: right when collapsed, down when expanded", async ({
  page,
}) => {
  await page.evaluate(() => {
    const [pinnedToggle, projectsToggle] = document.querySelectorAll(
      "[data-app-action-sidebar-section-toggle]",
    );
    pinnedToggle?.setAttribute("aria-expanded", "false");
    pinnedToggle
      ?.querySelector("svg")
      ?.setAttribute("class", "icon-disclosure opacity-100 -rotate-90");
    projectsToggle?.insertAdjacentHTML(
      "beforeend",
      '<svg class="icon-disclosure opacity-0 rotate-0" viewBox="0 0 16 16" aria-hidden="true"></svg>',
    );
  });
  await setup(page);
  const toggle = page.locator(group).getByRole("button", { name: "侧边聊天", exact: true });
  const chevron = toggle.locator("svg");
  const classes = () => chevron.evaluate((svg) => [...svg.classList].sort());
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await classes()).toEqual(["icon-disclosure", "opacity-0", "rotate-0"]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await classes()).toEqual(["-rotate-90", "icon-disclosure", "opacity-100"]);
  expect(await chevron.evaluate((svg) => svg.style.transform)).toBe("");
  await toggle.click();
  expect(await classes()).toEqual(["icon-disclosure", "opacity-0", "rotate-0"]);
  expect(await toggle.evaluate((button) => button.hasAttribute("aria-roledescription"))).toBe(
    false,
  );
});

test("opens Desktop's native menu for the ⋯ button, right click and the menu key", async ({
  page,
}) => {
  await page.evaluate(() => {
    const target = window as unknown as {
      menuCalls: unknown[];
      nextMenuId: string | null;
      electronBridge: unknown;
    };
    target.menuCalls = [];
    target.nextMenuId = null;
    target.electronBridge = {
      async showContextMenu(items: unknown, position: unknown) {
        target.menuCalls.push({ items, position });
        return { id: target.nextMenuId };
      },
    };
  });
  await setup(page, { conversationId: "parent-2" });
  const calls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            menuCalls: {
              items: {
                id: string;
                type?: string;
                label: string;
                icon?: string;
                enabled?: boolean;
              }[];
              position: { x: number; y: number };
            }[];
          }
        ).menuCalls,
    );
  await savedRow(page).hover();
  const trigger = savedRow(page).getByRole("button", { name: "侧边聊天操作" });
  await trigger.click();
  await expect.poll(async () => (await calls()).length).toBe(1);
  const [first] = await calls();
  expect(
    first?.items.map((item) => [item.type ?? item.id, item.label, item.enabled ?? true]),
  ).toEqual([
    ["uncollect", "取消收纳", true],
    ["separator", "", true],
    ["source", "打开原主对话", true],
    ["promote", "转为独立主对话", true],
    ["separator", "", true],
    ["archive", "归档", true],
  ]);
  for (const item of first?.items ?? [])
    if (item.type !== "separator") expect(item.icon).toMatch(/^data:image\/svg\+xml;utf8,/u);
  const box = await trigger.boundingBox();
  expect(first?.position.x).toBeCloseTo(box?.x ?? 0, 0);
  expect(first?.position.y).toBeCloseTo((box?.y ?? 0) + (box?.height ?? 0), 0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.evaluate(() => {
    (window as unknown as { nextMenuId: string }).nextMenuId = "archive";
  });
  const titleBox = await savedRow(page).getByText("整理实验记录").boundingBox();
  await savedRow(page).getByText("整理实验记录").click({ button: "right" });
  await expect.poll(async () => (await calls()).length).toBe(2);
  const second = (await calls())[1];
  const centre = (titleBox?.x ?? 0) + (titleBox?.width ?? 0) / 2;
  expect(Math.abs((second?.position.x ?? 0) - centre)).toBeLessThanOrEqual(1);
  await expect(savedRow(page)).toHaveCount(0);
  expect(await requests(page)).toContainEqual({
    method: "thread/archive",
    params: { threadId: "side-1" },
  });
  // Right click never reopened the row.
  expect((await nativeCalls(page)).filter((call) => call.action === "reopen")).toHaveLength(0);

  await page.evaluate(() => {
    (window as unknown as { nextMenuId: string }).nextMenuId = "uncollect";
  });
  const other = page.locator(row).filter({ hasText: "对比两种峰位拟合方法" });
  await other.locator("[data-codexhost-sidechat-open]").focus();
  await page.keyboard.press("Shift+F10");
  await expect.poll(async () => (await calls()).length).toBe(3);
  expect((await calls())[2]?.items[0]).toMatchObject({ id: "uncollect", label: "取消收纳" });
  await expect
    .poll(async () => await requests(page))
    .toContainEqual({
      method: "codexhost/sideChat/update",
      params: { threadId: "side-2", collected: false },
    });
});

test("names side chats without a prompt after their source and numbers look-alikes", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const f = window as unknown as FixtureWindow;
    for (const threadId of ["side-8", "side-7"])
      f.createSideChat({
        threadId,
        sourceThreadId: "parent-2",
        projectId: null,
        preview: "",
        collected: true,
      });
  });
  await expect(page.locator('[data-codexhost-sidechat-row="side-7"]')).toContainText(
    "侧边聊天 1 · 论文数据与图表",
  );
  await expect(page.locator('[data-codexhost-sidechat-row="side-8"]')).toContainText(
    "侧边聊天 2 · 论文数据与图表",
  );
  await expect(page.locator('[data-codexhost-sidechat-row="side-7"]')).toHaveAttribute(
    "title",
    /^原主对话：论文数据与图表 · /u,
  );
  await expect(page.locator('[data-codexhost-sidechat-row="side-7"]')).not.toHaveAttribute(
    "title",
    /项目/u,
  );
});

test("keeps the group when every native row is collapsed after the first paint", async ({
  page,
}) => {
  await page.evaluate(desktop261029Rows);
  await setup(page);
  await expect(savedRow(page)).toBeVisible();
  await page.evaluate(() => {
    for (const native of document.querySelectorAll("[data-app-action-sidebar-thread-row]"))
      native.remove();
  });
  await waitFrames(page, 6);
  await expect(page.locator(group)).toHaveCount(1);
  await expect(savedRow(page)).toBeVisible();
});

test("mounts a native-styled sibling between pinned and projects and sorts saved chats", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(`${pinned} + ${group} + ${projects}`)).toHaveCount(1);
  await expect(
    page.locator(group).getByRole("button", { name: "侧边聊天", exact: true }),
  ).toBeVisible();
  await expect(page.locator(visibleRow)).toHaveCount(3);
  await expect(page.locator(row).nth(0)).toContainText("整理实验记录");
  await expect(page.locator(row).nth(1)).toContainText("对比两种峰位拟合方法");
  await expect(savedRow(page)).toHaveClass(/fixture-row/);
  await expect(savedRow(page)).toHaveAttribute(
    "title",
    /^原主对话：中红外光谱分析 · 项目：光谱研究 · 2\s*分钟前$/u,
  );
  await expect(savedRow(page).locator(".fixture-time")).toContainText(/2\s*分钟前/u);
  const nativeTimeSize = await page
    .locator(`${projects} .fixture-time`)
    .evaluate((element) => getComputedStyle(element).fontSize);
  await expect(savedRow(page).locator(".fixture-time")).toHaveCSS("font-size", nativeTimeSize);
  await expect(page.getByRole("button", { name: oldMore })).toHaveCount(0);
  expect(
    await page
      .locator(group)
      .evaluate((node) =>
        [node, ...node.querySelectorAll("*")].some((item) =>
          item.getAttributeNames().some((name) => name.startsWith("data-app-action-")),
        ),
      ),
  ).toBe(false);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("mounts first without pinned and reinserts the same group in the native replacement turn", async ({
  page,
}) => {
  await page.locator(pinned).evaluate((node) => node.remove());
  await setup(page);
  await expect(page.locator(`${group} + ${projects}`)).toHaveCount(1);
  const restoredInTurn = await page.locator(sidebar).evaluate(async (native, selector) => {
    const existing = native.querySelector(selector);
    const replacement = native.cloneNode(true) as Element;
    replacement.querySelector(selector)?.remove();
    native.replaceWith(replacement);
    await Promise.resolve();
    return !!existing && replacement.querySelector(selector) === existing;
  }, group);
  expect(restoredInTurn).toBe(true);
  await expect(page.locator(`${group} + ${projects}`)).toHaveCount(1);
});

test("persists collapse across library disable and enable", async ({ page }) => {
  await setup(page);
  const toggle = page.locator(group).getByRole("button", { name: "侧边聊天", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(row).first()).not.toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).changeFeatures(false));
  await expect(page.locator(group)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).changeFeatures(true));
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.locator(row).first()).toBeVisible();
});

test("uses the active side-panel tab for native selection", async ({ page }) => {
  await page.evaluate(() => {
    for (const [id, hidden] of [
      ["side-1", false],
      ["side-2", true],
    ] as const) {
      const panel = document.createElement("div");
      panel.setAttribute("role", "tabpanel");
      panel.dataset.appShellTabPanelController = "right";
      panel.dataset.tabId = `sidechat:${id}`;
      panel.textContent = "侧聊";
      if (hidden) {
        panel.inert = true;
        panel.setAttribute("aria-hidden", "true");
      }
      document.querySelector("main")?.append(panel);
    }
  });
  await setup(page);
  await expect(savedRow(page)).toHaveClass(/fixture-active/);
  await expect(page.locator(row).filter({ hasText: "对比两种峰位拟合方法" })).not.toHaveClass(
    /fixture-active/,
  );
});

test("default-off adds nothing and hot enabling keeps the native sidebar", async ({ page }) => {
  await setup(page, { enabled: false });
  await expect
    .poll(async () => (await requests(page)).map((call) => call.method))
    .toEqual(["codexhost/sideChat/features/get"]);
  await expect(page.locator(group)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).changeFeatures(true));
  await expect(page.locator(group)).toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).changeFeatures(false));
  await expect(page.locator(group)).toHaveCount(0);
  await expect(page.locator(`${pinned} + ${projects}`)).toHaveCount(1);
});

for (const [name, options] of [
  ["empty", { empty: true }],
  ["failed list", { failList: true }],
] as const) {
  test(`leaves the native sidebar untouched with ${name}`, async ({ page }) => {
    await setup(page, options);
    await expect
      .poll(async () =>
        (await requests(page)).some((call) => call.method === "codexhost/sideChat/list"),
      )
      .toBe(true);
    await expect(page.locator(group)).toHaveCount(0);
    await expect(page.locator(`${pinned} + ${projects}`)).toHaveCount(1);
  });
}

test("shows a previously empty group after a child starts and refreshes on the committed route", async ({
  page,
}) => {
  await setup(page, { empty: true, conversationId: "parent-2" });
  await expect
    .poll(async () =>
      (await requests(page)).some((call) => call.method === "codexhost/sideChat/list"),
    )
    .toBe(true);
  await expect(page.locator(group)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).switchRoute("parent-1"));
  await expect
    .poll(async () =>
      (await requests(page)).some(
        (call) =>
          call.method === "codexhost/sideChat/list" && call.params.sourceThreadId === "parent-1",
      ),
    )
    .toBe(true);
  await expect(page.locator(group)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).createSideChat());
  await expect(
    page.locator(visibleRow).filter({ hasText: "把这个实验条件单独记一下" }),
  ).toBeVisible();
});

test("retains saved row identity and visibility through delayed, out-of-order project navigation", async ({
  page,
}) => {
  await setup(page);
  await expect(savedRow(page)).toHaveAttribute("title", /光谱研究/u);
  await startSidebarTrace(page);
  await page.evaluate(() => {
    const f = window as unknown as FixtureWindow;
    for (const key of ["list:saved", "list:parent-2", "list:parent-3"]) f.holdRequest(key);
    f.createSideChat({
      threadId: "side-4",
      sourceThreadId: "parent-3",
      projectId: "project-3",
      preview: "新项目的侧聊",
    });
    f.setContext();
    window.dispatchEvent(new Event("codexhost:draft-prewarm-policy-changed"));
  });
  await waitFrames(page);
  for (const parent of ["parent-2", "parent-3"]) {
    await page.evaluate((id) => {
      (window as unknown as FixtureWindow).setContext(id);
      window.dispatchEvent(new Event("codexhost:draft-prewarm-policy-changed"));
    }, parent);
    await expect
      .poll(async () =>
        (await requests(page)).some(
          (call) =>
            call.method === "codexhost/sideChat/list" && call.params.sourceThreadId === parent,
        ),
      )
      .toBe(true);
  }
  await waitFrames(page);
  await page.evaluate(() => {
    const f = window as unknown as FixtureWindow;
    for (const key of ["thread:parent-3", "project:project-3"]) f.holdRequest(key);
    for (const key of ["list:saved", "list:parent-3"]) f.releaseRequest(key);
  });
  const newPending = page.locator('[data-codexhost-sidechat-row="side-4"]');
  await expect(newPending).toBeVisible();
  await expect(newPending).toHaveAttribute("title", /parent-3.*project-3/u);
  await expect
    .poll(async () =>
      (await requests(page)).some(
        (call) => call.method === "project/read" && call.params.projectId === "project-3",
      ),
    )
    .toBe(true);
  await waitFrames(page);
  await page.evaluate(() => {
    const f = window as unknown as FixtureWindow;
    for (const key of ["thread:parent-3", "project:project-3"]) f.releaseRequest(key);
  });
  await expect(newPending).toHaveAttribute("title", /第三个主对话.*第三个项目/u);
  await page.evaluate(() => (window as unknown as FixtureWindow).releaseRequest("list:parent-2"));
  await waitFrames(page);
  await expect(newPending).toBeVisible();
  await expect(page.locator('[data-codexhost-sidechat-row="side-3"]')).toHaveCount(0);
  const trace = await page.evaluate(() => (window as unknown as FixtureWindow).stopSidebarTrace());
  expect(trace.frames).toBeGreaterThanOrEqual(12);
  expect(trace).toMatchObject({ hidden: 0, replaced: 0 });
});

test("retries one failed saved list refresh without hiding or replacing saved rows", async ({
  page,
}) => {
  await setup(page);
  await expect(savedRow(page)).toHaveAttribute("title", /光谱研究/u);
  await startSidebarTrace(page);
  const count = async () =>
    (await requests(page)).filter(
      (call) => call.method === "codexhost/sideChat/list" && !call.params.sourceThreadId,
    ).length;
  const before = await count();
  await page.evaluate(() => (window as unknown as FixtureWindow).failSavedListOnce());
  await expect.poll(count).toBe(before + 2);
  await waitFrames(page);
  const trace = await page.evaluate(() => (window as unknown as FixtureWindow).stopSidebarTrace());
  expect(trace.frames).toBeGreaterThan(1);
  expect(trace).toMatchObject({ hidden: 0, replaced: 0 });
});

test("pins an inline child without touching the parent conversation", async ({ page }) => {
  await setup(page, { conversationId: "side-1" });
  await expect(page.getByRole("button", { name: oldMore })).toHaveCount(0);
  const pending = page.locator(row).filter({ hasText: "把这个实验条件单独记一下" });
  await pending.hover();
  await pending.getByRole("button", { name: "收纳到侧栏", exact: true }).click();
  await expect(page.locator(row)).toHaveCount(3);
  await expect(page.getByRole("button", { name: oldMore })).toHaveCount(0);
  const calls = await requests(page);
  expect(calls).toContainEqual({
    method: "thread/read",
    params: { threadId: "side-1", includeTurns: false },
  });
  expect(calls.filter((call) => call.method === "codexhost/sideChat/update")).toEqual([
    { method: "codexhost/sideChat/update", params: { threadId: "side-3", collected: true } },
  ]);
  expect(
    calls.some((call) => /turn\/(start|steer)|inject_items|thread\/delete/.test(call.method)),
  ).toBe(false);
});

test("continues the original side chat using its native parent and reopens an orphan in the main view", async ({
  page,
}) => {
  await setup(page, { conversationId: "", orphan: true, waitForNavigation: true });
  await expect(page.getByRole("button", { name: oldMore })).toHaveCount(0);
  await savedRow(page).getByText("整理实验记录").click();
  await expect
    .poll(() => nativeCalls(page))
    .toContainEqual({ action: "navigate", path: "/local/parent-1" });
  await expect
    .poll(() => nativeCalls(page))
    .toContainEqual({
      action: "reopen",
      threadId: "side-1",
      sourceThreadId: "parent-1",
      target: "right",
    });
  await page
    .locator(row)
    .filter({ hasText: "对比两种峰位拟合方法" })
    .getByText("对比两种峰位拟合方法")
    .click();
  await expect
    .poll(() => nativeCalls(page))
    .toContainEqual({ action: "navigate", path: "/local/side-2" });
  expect((await nativeCalls(page)).filter((call) => call.action === "reopen")).toHaveLength(1);
});

for (const action of ["打开原主对话", "转为独立主对话", "归档"] as const) {
  test(`row menu runs ${action} on the correct conversation`, async ({ page }) => {
    await setup(page, { conversationId: "parent-2" });
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: action, exact: true }).click();
    if (action === "打开原主对话") {
      await expect
        .poll(() => nativeCalls(page))
        .toContainEqual({ action: "navigate", path: "/local/parent-1" });
    } else if (action === "转为独立主对话") {
      await expect
        .poll(() => nativeCalls(page))
        .toContainEqual({
          action: "promote",
          sourceConversationId: "side-1",
          sourceWorkspaceRoot: "/work/project",
        });
      await expect
        .poll(() => nativeCalls(page))
        .toContainEqual({ action: "navigate", path: "/local/promoted-1" });
    } else {
      await expect(savedRow(page)).toHaveCount(0);
      expect(await requests(page)).toContainEqual({
        method: "thread/archive",
        params: { threadId: "side-1" },
      });
    }
    await expect(menu).not.toBeVisible();
  });
}

test("pins the exact active side chat next to its native close button", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as unknown as FixtureWindow).showPanel("side-3"));
  const pin = page.locator("[data-codexhost-sidechat-panel-pin]");
  await expect(pin).toHaveAccessibleName("收纳到侧栏");
  await expect(
    page.locator("[data-codexhost-sidechat-panel-pin] + [data-app-shell-tab-close-button]"),
  ).toHaveCount(1);
  await expect(page.locator(visibleRow)).toHaveCount(2);
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveAccessibleName("取消收纳");
  await expect(page.locator(visibleRow)).toHaveCount(3);
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(visibleRow)).toHaveCount(2);
  expect(
    (await requests(page)).filter((call) => call.method === "codexhost/sideChat/update"),
  ).toEqual([
    { method: "codexhost/sideChat/update", params: { threadId: "side-3", collected: true } },
    { method: "codexhost/sideChat/update", params: { threadId: "side-3", collected: false } },
  ]);
});

test("unpins a saved row directly and keeps the fallback menu on its four actions", async ({
  page,
}) => {
  await setup(page, { conversationId: "parent-2" });
  const menu = await openMenu(page);
  await expect(menu.getByRole("menuitem")).toHaveCount(4);
  await expect(menu.getByRole("separator")).toHaveCount(2);
  await expect(menu.getByRole("menuitem").first()).toHaveAccessibleName("取消收纳");
  await expect(menu.locator("[role=menuitem] svg")).toHaveCount(4);
  // A pointer-opened menu focuses itself, so no item shows a focus ring.
  await expect(menu).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  const trigger = savedRow(page).getByRole("button", { name: "侧边聊天操作" });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  // Keyboard opening focuses the first item, like Desktop menus.
  await expect(page.getByRole("menu").getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await savedRow(page).hover();
  const pin = savedRow(page).getByRole("button", { name: "取消收纳" });
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await pin.click();
  await expect(savedRow(page)).toHaveCount(0);
  expect(await requests(page)).toContainEqual({
    method: "codexhost/sideChat/update",
    params: { threadId: "side-1", collected: false },
  });
});

test("limits inline fallback children and opens the native-style show-all control", async ({
  page,
}) => {
  await setup(page, { morePending: true });
  await expect(page.locator(visibleRow)).toHaveCount(5);
  const showAll = page.locator(group).getByRole("button", { name: "展开显示", exact: true });
  await expect(showAll).toBeVisible();
  await showAll.click();
  await expect(page.locator(visibleRow)).toHaveCount(6);
  await expect(
    page.locator(group).getByRole("button", { name: "收起", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: oldMore })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`real CSS ${theme} sidebar matches native computed styles`, async ({ page }) => {
    test.skip(
      !evidenceDir,
      "Set CODEXHOST_SIDECHAT_NATIVE_FIXTURE for installed-asset visual verification",
    );
    if (!evidenceDir) return;
    await page.setViewportSize({ width: 960, height: 590 });
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await setup(page);
    await expect(page.locator(`${pinned} + ${group} + ${projects}`)).toHaveCount(1);
    await expect(page.locator(visibleRow)).toHaveCount(3);
    await expect(page.locator(`${group} [id], ${group} [aria-controls]`)).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const diagnosticMethod = "codexhost/sideChat/uiDiagnostics";
    await expect
      .poll(async () => (await requests(page)).some((call) => call.method === diagnosticMethod))
      .toBe(true);
    const diagnostic = (await requests(page)).find(
      (call) => call.method === diagnosticMethod,
    )?.params;
    expect(diagnostic).toEqual({
      heading: { native: expect.any(Object), sidechat: expect.any(Object) },
      row: { native: expect.any(Object), sidechat: expect.any(Object) },
    });
    for (const part of Object.values(diagnostic ?? {}) as {
      native: Record<string, unknown>;
      sidechat: Record<string, unknown>;
    }[]) {
      expect(part.sidechat).toEqual(part.native);
      expect(part.native).toEqual({
        fontSize: expect.any(Number),
        fontWeight: expect.any(Number),
        color: [expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
        lineHeight: expect.any(Number),
        height: expect.any(Number),
        paddingLeft: expect.any(Number),
      });
    }
    const metrics = await page.evaluate(
      ({ group, pinned, projects, row }) => {
        const measure = (selector: string) => {
          const node = document.querySelector(selector);
          if (!node) throw new Error(`Missing comparison target ${selector}`);
          const style = getComputedStyle(node);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            color: style.color,
            lineHeight: style.lineHeight,
            height: node.getBoundingClientRect().height,
            paddingLeft: style.paddingLeft,
          };
        };
        const header = "[data-app-action-sidebar-section-toggle]";
        const thread = "[data-app-action-sidebar-thread-row]";
        const title = "[data-thread-title]";
        return {
          heading: {
            native: measure(`${pinned} ${header}`),
            sidechat: measure(`${group} [data-codexhost-sidechat-heading]`),
          },
          row: { native: measure(`${projects} ${thread}`), sidechat: measure(`${group} ${row}`) },
          title: {
            native: measure(`${projects} ${thread} ${title}`),
            sidechat: measure(`${group} ${row} [data-codexhost-sidechat-title]`),
          },
        };
      },
      { group, pinned, projects, row },
    );
    await writeFile(
      path.join(evidenceDir, `computed-${theme}.json`),
      JSON.stringify(metrics, null, 2) + "\n",
    );
    await writeFile(
      path.join(evidenceDir, `diagnostics-${theme}.json`),
      JSON.stringify(diagnostic, null, 2) + "\n",
    );
    const fontSession = await page.context().newCDPSession(page);
    try {
      await fontSession.send("DOM.enable");
      await fontSession.send("CSS.enable");
      const { root } = await fontSession.send("DOM.getDocument", { depth: 0 });
      const fonts = {};
      for (const [label, selector] of Object.entries({
        nativeHeading: `${pinned} [data-app-action-sidebar-section-toggle] span`,
        sidechatHeading: `${group} [data-codexhost-sidechat-heading] span`,
        nativeTitle: `${projects} [data-thread-title] span[dir=auto] > span`,
        sidechatTitle: `${group} ${row} [data-codexhost-sidechat-title] span[dir=auto] > span`,
      })) {
        const { nodeId } = await fontSession.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector,
        });
        Object.assign(fonts, {
          [label]: (await fontSession.send("CSS.getPlatformFontsForNode", { nodeId })).fonts,
        });
      }
      await writeFile(
        path.join(evidenceDir, `fonts-${theme}.json`),
        JSON.stringify(fonts, null, 2) + "\n",
      );
    } finally {
      await fontSession.detach();
    }
    await page.locator(sidebar).screenshot({
      path: path.join(evidenceDir, `sidebar-${theme}.png`),
      animations: "disabled",
    });
    for (const [part, pair] of Object.entries(metrics)) {
      expect(pair.sidechat, `${theme} ${part}`).toEqual(pair.native);
    }
    const toggle = page.locator(`${group} [data-codexhost-sidechat-heading]`);
    // Expanded: Desktop's chevron points down (rotate 0) and only shows on hover.
    await expect(toggle.locator("svg")).toHaveCSS("rotate", "0deg");
    await toggle.click();
    // Collapsed: the same native classes turn it to point right, with no inline transform.
    await expect(toggle.locator("svg")).toHaveCSS("rotate", "-90deg");
    await expect(toggle.locator("svg")).toHaveCSS("transform", "none");
    await expect(toggle.locator("svg")).toHaveCSS("opacity", "1");
    expect(await toggle.evaluate((button) => button.matches(":focus-visible"))).toBe(false);
    await expect(toggle).toHaveCSS("outline-style", "none");
    // A later key that does not navigate (such as a screenshot shortcut) keeps rings hidden.
    await page.keyboard.press("Shift");
    await expect(toggle).toHaveCSS("outline-style", "none");
    await page.keyboard.press("Tab");
    await toggle.focus();
    expect(await toggle.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
    await expect(toggle).toHaveCSS("outline-style", "solid");
  });
}
