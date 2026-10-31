import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });
const { outputFiles } = await build({
  stdin: {
    contents: `
      import { installRendererSideChatControls } from './packages/renderer-extension/src/renderer-sidechat-controls.ts';
      window.setup = () => {
        let collected = false;
        const calls = [];
        const scope = { node: {}, chain: [], scope: {}, value: { routeKind: 'local-thread', conversationId: 'parent-1', hostId: 'local' }, get() {}, set() {}, watch() {} };
        document.querySelector('main').__reactFiber$test = { memoizedState: { memoizedState: { current: scope }, next: null } };
        const row = () => ({ threadId: 'side-1', sourceThreadId: 'parent-1', projectId: window.orphan ? null : 'project-1', title: '<img src=x onerror=alert(1)>', collected, ...(window.orphan ? {sourceAvailable: false} : {}) });
        let release;
        const route = { hostId: 'local', manager: { async sendRequest(method, params) {
          calls.push({method, params});
          if (window.hold && method === 'codexhost/sideChat/list') await new Promise(r => release = r);
          if (method === 'codexhost/sideChat/list') return { items: params.sourceThreadId || collected ? [row()] : [] };
          if (method === 'codexhost/sideChat/update') { if (window.failUpdate) throw new Error('保存失败'); collected = params.collected; return { item: row() }; }
          if (method === 'thread/read') return { thread: { id: params.threadId, name: '原主对话', cwd: '/work/project' } };
          if (method === 'project/read') return { project: { id: 'project-1', name: '研究项目' } };
          throw new Error('Unexpected write: '+method);
        } } };
        let active = route;
        window.calls = calls;
        window.release = () => release?.();
        window.retire = () => active = null;
        window.markOrphan = () => { window.orphan = true; collected = true; };
        window.controls = installRendererSideChatControls(document, () => ({ forHost: () => active }));
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

test.beforeEach(async ({ page }) => {
  await page.setContent(
    '<aside data-app-action-sidebar-scroll></aside><main data-app-shell-active-page="true"></main>',
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => (window as unknown as { setup(): void }).setup());
});

test("manual collection survives closing the folder and never sends parent context", async ({
  page,
}) => {
  await page.getByRole("button", { name: "侧聊收纳", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "侧聊收纳" });
  await expect(dialog).toContainText("还没有收纳的侧聊");
  await dialog.getByRole("button", { name: "当前主对话的侧聊" }).click();
  await expect(dialog).toContainText("研究项目");
  await expect(dialog).toContainText("原主对话");
  await expect(dialog.locator("img")).toHaveCount(0);
  await dialog.getByRole("button", { name: "收纳", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "取消收纳" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "侧聊收纳", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "取消收纳" })).toBeVisible();
  const calls = await page.evaluate(
    () => (window as unknown as { calls: { method: string; params: unknown }[] }).calls,
  );
  expect(calls.filter((call) => call.method === "codexhost/sideChat/update")).toEqual([
    { method: "codexhost/sideChat/update", params: { threadId: "side-1", collected: true } },
  ]);
  expect(
    calls.some((call) => /turn\/(start|steer)|inject_items|thread\/delete/.test(call.method)),
  ).toBe(false);
});

test("a retired connection cannot populate the folder with its late response", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { hold: boolean }).hold = true;
  });
  await page.getByRole("button", { name: "侧聊收纳", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("正在读取侧聊");
  await page.evaluate(() => {
    const fixture = window as unknown as { retire(): void; release(): void };
    fixture.retire();
    fixture.release();
  });
  await expect(page.getByRole("status")).toContainText("聊天连接已改变");
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(0);
});

test("Escape closes the folder and disposal removes its controls", async ({ page }) => {
  await page.getByRole("button", { name: "侧聊收纳", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { controls: { dispose(): void } }).controls.dispose(),
  );
  await expect(page.locator("[data-codexhost-sidechats-trigger]")).toHaveCount(0);
  await expect(page.locator("[data-codexhost-sidechats]")).toHaveCount(0);
});

test("an orphan remains visible and removable while unavailable source actions stay disabled", async ({
  page,
}) => {
  await page.evaluate(() => (window as unknown as { markOrphan(): void }).markOrphan());
  await page.getByRole("button", { name: "侧聊收纳", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "侧聊收纳" });
  await expect(dialog).toContainText("来源不可用");
  await expect(dialog.getByRole("button", { name: "打开原侧聊", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "打开原主对话" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "转为独立主对话" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "定位项目" })).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { failUpdate: boolean }).failUpdate = true;
  });
  await dialog.getByRole("button", { name: "取消收纳" }).click();
  await expect(dialog.getByRole("status")).toContainText("保存失败");
  await expect(dialog.getByRole("button", { name: "打开原主对话" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "转为独立主对话" })).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { failUpdate: boolean }).failUpdate = false;
  });
  await dialog.getByRole("button", { name: "取消收纳" }).click();
  await expect(dialog).toContainText("还没有收纳的侧聊");
  const calls = await page.evaluate(
    () => (window as unknown as { calls: { method: string; params: unknown }[] }).calls,
  );
  expect(
    calls.some((call) => call.method === "thread/read" || call.method === "project/read"),
  ).toBe(false);
  expect(calls.filter((call) => call.method === "codexhost/sideChat/update")).toEqual([
    {
      method: "codexhost/sideChat/update",
      params: { threadId: "side-1", collected: false },
    },
    { method: "codexhost/sideChat/update", params: { threadId: "side-1", collected: false } },
  ]);
});
