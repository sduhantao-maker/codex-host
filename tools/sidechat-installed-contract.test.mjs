import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  isNativeSideChatFork,
  isNativeSideChatTab,
} from "../packages/renderer-extension/src/renderer-sidechat-native.js";
const artifact = process.env.CODEXHOST_SIDECHAT_ASAR;
const tabAnchors = [
  "lockedCollaborationMode",
  "sideConversation",
  "side-chat:",
  "preserveServerConfiguration",
];
const forkAnchors = [
  "sourceWorkspaceRoot",
  "getThreadExecutionState",
  "forkConversationIntoLocal",
  "threadHeader.forkThreadPending",
];
const sidebarAnchors = [
  "scroll",
  "section",
  "section-heading",
  "section-toggle",
  "section-collapsed",
  "thread-row",
  "thread-title",
  "thread-active",
  "project-show-all-toggle",
].map((suffix) => `"data-app-action-sidebar-${suffix}"`);
const tabPanelAnchors = [
  'role:"tabpanel"',
  '"data-app-shell-tab-panel-controller":',
  '"data-tab-id":',
  '"aria-hidden":',
];
const tabPinAnchors = [
  '"data-app-shell-tab-strip-controller":',
  '"data-app-shell-tab-controller":',
  '"data-app-shell-tab-close-button":!0',
  'id:"codex.tabs.closeNamed"',
  'color:"ghost",size:"iconMd"',
];
const rightPanelUses = [
  '[data-app-shell-tab-strip-controller="right"]',
  '[role="tabpanel"][data-app-shell-tab-panel-controller="right"]',
];
const headingCloneAnchors = ["sidebarSectionToggle,", "children:[n,l]", '"min-w-0 truncate"'];
const rowCloneAnchors = [
  '"data-thread-title-trigger":!0',
  '"data-interactive-row-link":!0',
  '"data-thread-title":!0',
  "text-codex-description text-sm leading-4 empty:hidden tabular-nums",
];
// Side chat rows turn their chevron with these classes, reuse the 52px hover rail and open the
// same native menu as thread rows (SVG data URL icons through electronBridge.showContextMenu).
const disclosureAnchors = [
  "icon-disclosure shrink-0 transition-transform",
  '"-rotate-90":"rotate-0"',
];
const hoverRailAnchors = [
  '"data-hover-card-open-immediately":!0',
  "w-[52px]",
  '"data-thread-title-trigger":!0',
];
const nativeMenuAnchors = [
  "electronBridge?.showContextMenu?.(",
  "nativeLabel",
  "data:image/svg+xml;utf8,",
];
const preloadMenuAnchors = ["showContextMenu:", '"codex_desktop:show-context-menu"'];
const has = (text, terms) => terms.every((term) => text.includes(term));
/** Opt-in contract audit: parse installed bytes without importing or running Desktop code. */
function readSources() {
  if (!artifact)
    throw new Error("CODEXHOST_SIDECHAT_ASAR is required for the installed contract audit");
  const fd = openSync(artifact, "r");
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, prefix.length, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(fd, header, 0, header.length, 16);
    const inventory = JSON.parse(header.toString("utf8"));
    const assets = inventory.files.webview.files.assets.files;
    const bundled = !!assets.async?.files;
    const files = Object.entries(bundled ? assets.async.files : assets)
      .filter(
        ([name]) =>
          name.endsWith(".js") &&
          (bundled ||
            /^(app-initial-|local-conversation-thread-|local-conversation-side-chat-|restore-)/.test(
              name,
            )),
      )
      .flatMap(([name, entry]) => {
        const bytes = Buffer.alloc(entry.size);
        readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
        if (
          bundled &&
          !has(bytes, tabAnchors) &&
          !has(bytes, forkAnchors) &&
          !has(bytes, sidebarAnchors) &&
          !has(bytes, tabPanelAnchors) &&
          !has(bytes, tabPinAnchors) &&
          !has(bytes, rightPanelUses) &&
          !has(bytes, headingCloneAnchors) &&
          !has(bytes, rowCloneAnchors) &&
          !has(bytes, disclosureAnchors) &&
          !has(bytes, hoverRailAnchors) &&
          !has(bytes, nativeMenuAnchors) &&
          !has(bytes, ["openLocalConversationSideChat:", "attachedConversationId"]) &&
          !has(bytes, ["restoreDurableSideChat", "attachedConversationId:"]) &&
          !has(bytes, ['this.send(["push",', '"pipeline"', ".postMessage("])
        )
          return [];
        expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(entry.integrity.hash);
        return [{ name, text: bytes.toString("utf8") }];
      });
    return { files, bundled };
  } finally {
    closeSync(fd);
  }
}
let sourceInventory;
const sources = () => (sourceInventory ??= readSources());

/** The preload script that exposes Desktop's native menu bridge to the page. */
function readPreload() {
  const fd = openSync(artifact, "r");
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, prefix.length, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(fd, header, 0, header.length, 16);
    const entry = JSON.parse(header.toString("utf8")).files[".vite"]?.files?.build?.files?.[
      "preload.js"
    ];
    if (!entry) return "";
    const bytes = Buffer.alloc(entry.size);
    readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    expect(createHash("sha256").update(bytes).digest("hex"), "preload.js").toBe(
      entry.integrity.hash,
    );
    return bytes.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function exportedFunctions(file, bundled) {
  const ast = ts.createSourceFile(
    file.name,
    file.text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const bodies = bundled ? [] : [ast];
  if (bundled) {
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const table = statement.declarationList.declarations.find(
        ({ name }) => ts.isIdentifier(name) && name.text === "__webpack_modules__",
      )?.initializer;
      if (!table || !ts.isObjectLiteralExpression(table)) continue;
      for (const factory of table.properties) {
        if (ts.isMethodDeclaration(factory) && factory.body) bodies.push(factory.body);
      }
    }
  }
  return bodies.flatMap(({ statements }) => {
    const exported = new Set();
    const findCompiledBindings = (node) => {
      if (ts.isFunctionLike(node)) return;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "d" &&
        node.arguments[1] &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        for (const getter of node.arguments[1].properties) {
          if (
            ts.isPropertyAssignment(getter) &&
            ts.isArrowFunction(getter.initializer) &&
            ts.isIdentifier(getter.initializer.body)
          )
            exported.add(getter.initializer.body.text);
        }
      }
      ts.forEachChild(node, findCompiledBindings);
    };
    for (const statement of statements) {
      if (bundled) findCompiledBindings(statement);
      else if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      )
        for (const member of statement.exportClause.elements)
          exported.add((member.propertyName ?? member.name).text);
    }
    return statements.flatMap((statement) => {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !exported.has(statement.name.text)
      )
        return [];
      const text = statement.getText(ast);
      return has(text, tabAnchors) || has(text, forkAnchors)
        ? [{ name: `${file.name}:${statement.name.text}`, text }]
        : [];
    });
  });
}

describe.skipIf(!artifact)("installed Desktop side chat contract", () => {
  it("publishes the sidebar section, thread and side chat panel anchors", () => {
    const { files } = sources();
    const sidebar = files.find(({ text }) => has(text, sidebarAnchors));
    expect(sidebar?.text).toContain("sidebarSection:({");
    expect(sidebar?.text).toContain("sidebarThreadRow:({");
    expect(files.some(({ text }) => has(text, tabPanelAnchors))).toBe(true);
    expect(files.some(({ text }) => has(text, ['"local-side-chat"', '"sidechat:"']))).toBe(true);
  });

  it("retains the native clone slots and the right-panel side chat pin anchor", () => {
    const { files, bundled } = sources();
    if (!bundled) return;
    expect(files.some(({ text }) => has(text, headingCloneAnchors))).toBe(true);
    expect(files.some(({ text }) => has(text, rowCloneAnchors))).toBe(true);
    const rightPanel = files.find(({ text }) => has(text, tabPinAnchors));
    expect(rightPanel?.text).toMatch(/"data-app-shell-tab-controller":[\w$]+,"data-tab-id":[\w$]+/);
    expect(rightPanel?.text).toMatch(/"data-app-shell-tab-strip-controller":[\w$]+/);
    expect(files.some(({ text }) => has(text, rightPanelUses))).toBe(true);
    expect(rightPanel?.text).toMatch(
      /role:"tabpanel".*?"data-app-shell-tab-panel-controller":[\w$]+,"data-tab-id":[\w$]+/s,
    );
    expect(files.some(({ text }) => has(text, ['"local-side-chat"', '"sidechat:"']))).toBe(true);
  });

  it("keeps the disclosure classes, hover rail and native menu that side chat rows reuse", () => {
    const { files, bundled } = sources();
    if (!bundled) return;
    expect(files.some(({ text }) => has(text, disclosureAnchors))).toBe(true);
    expect(files.some(({ text }) => has(text, hoverRailAnchors))).toBe(true);
    expect(files.some(({ text }) => has(text, nativeMenuAnchors))).toBe(true);
    expect(has(readPreload(), preloadMenuAnchors)).toBe(true);
  });

  it("finds one exported tab and one exported fork in real, integrity-checked bundled sources", () => {
    const { files, bundled } = sources();
    const candidates = files
      .filter(({ text }) => has(text, tabAnchors) || has(text, forkAnchors))
      .flatMap((file) => exportedFunctions(file, bundled));
    const original = Function.prototype.toString;
    const target = function candidate() {};
    let candidate = "";
    const spy = vi.spyOn(Function.prototype, "toString").mockImplementation(function () {
      return this === target ? candidate : original.call(this);
    });
    const tabs = [],
      forks = [];
    try {
      for (const entry of candidates) {
        candidate = entry.text;
        if (isNativeSideChatTab(target)) tabs.push(entry.name);
        if (isNativeSideChatFork(target)) forks.push(entry.name);
      }
    } finally {
      spy.mockRestore();
    }
    expect(tabs).toHaveLength(1);
    expect(forks).toHaveLength(1);
  }, 20_000);
  it("confirms same-ID attached restore and persistent close are still native branches", () => {
    const { files, bundled } = sources();
    if (bundled) {
      const side = files.filter(({ text }) =>
        has(text, ["openLocalConversationSideChat:", "attachedConversationId"]),
      );
      const restore = files.filter(({ text }) => text.includes("restoreDurableSideChat:()=>"));
      expect(side.length).toBeGreaterThan(0);
      expect(restore).toHaveLength(1);
      const chunk = restore[0]?.text.match(/__rspack_esm_id=(\d+);/)?.[1];
      expect(chunk).toBeTruthy();
      expect(restore[0]?.text).toMatch(
        /attachedConversationId:([\w$]+)\.conversationId,sourceConversationId:\1\.sourceConversationId,hostId:\1\.hostId,collaborationMode:null\}\)===\1\.conversationId/,
      );
      for (const { name, text } of side) {
        expect(text, name).toContain(`.e(${chunk}).then`);
        expect(text, name).toMatch(/conversationId:[\w$]+,hostId:[\w$]+,persistent:!0/);
        const retained = text.match(
          /([\w$]+)=null!=[\w$]+\.durable\|\|!0===[\w$]+\.persistent/,
        )?.[1];
        expect(retained, name).toBeTruthy();
        expect(text, name).toContain(`.then(()=>!!${retained}||`);
        expect(text, name).toContain("sideConversation:!0,sideConversationParentNavigationPath:");
        expect(text, name).toContain('sendRequest("thread/inject_items"');
      }
      const manager = files.find(({ text }) => has(text, forkAnchors));
      expect(manager?.text).toContain("async listAttachedThreads(");
      expect(manager?.text).toContain("attachedToThreadId");
      expect(manager?.text).toMatch(
        /\.forkConversationFromTurn\([^)]*\):await [\w$]+\.forkConversationFromLatest\(/,
      );
      expect(
        files.some(({ text }) =>
          has(text, ['this.send(["push",', '=["pipeline",', ".postMessage("]),
        ),
      ).toBe(true);
      return;
    }
    const side = files.filter(
      (file) =>
        file.name.startsWith("local-conversation-side-chat-") &&
        file.text.includes("attachedConversationId"),
    );
    expect(side).toHaveLength(1);
    expect(side[0]?.text).toMatch(/attachedConversationId:\w+/);
    expect(side[0]?.text).toMatch(/conversationId:\w+,hostId:\w+,persistent:!0/);
    const restore = files.filter(
      (file) => file.name.startsWith("restore-") && file.text.includes("restoreDurableSideChat"),
    );
    expect(restore).toHaveLength(1);
    expect(side[0]?.text).toContain(`./${restore[0]?.name}`);
    expect(restore[0]?.text).toMatch(
      /attachedConversationId:(\w+)\.conversationId,sourceConversationId:\1\.sourceConversationId,hostId:\1\.hostId,collaborationMode:null\}\)===\1\.conversationId/,
    );
    const manager = files.find((file) => file.name.startsWith("app-initial-"));
    expect(manager?.text).toContain("async listAttachedThreads(");
    expect(manager?.text).toContain("attachedToThreadId");
    expect(side[0]?.text).toContain("persistent===!0");
    expect(side[0]?.text).toMatch(/\.then\(\(\)=>\w+\?!0:/);
  });
});
