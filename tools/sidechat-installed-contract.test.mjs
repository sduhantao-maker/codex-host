import { closeSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  isNativeSideChatFork,
  isNativeSideChatTab,
} from "../packages/renderer-extension/src/renderer-sidechat-native.js";
const artifact = process.env.CODEXHOST_SIDECHAT_ASAR;
/** Opt-in contract audit: parse installed bytes without importing or running Desktop code. */
function sources() {
  if (!artifact)
    throw new Error("CODEXHOST_SIDECHAT_ASAR is required for the installed contract audit");
  const fd = openSync(artifact, "r");
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, prefix.length, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(fd, header, 0, header.length, 16);
    const inventory = JSON.parse(header.toString("utf8"));
    return Object.entries(inventory.files.webview.files.assets.files)
      .filter(
        ([name]) =>
          /^(app-initial-|local-conversation-thread-|local-conversation-side-chat-)/.test(name) &&
          name.endsWith(".js"),
      )
      .map(([name, entry]) => {
        const bytes = Buffer.alloc(entry.size);
        readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
        expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(entry.integrity.hash);
        return { name, text: bytes.toString("utf8") };
      });
  } finally {
    closeSync(fd);
  }
}
describe.skipIf(!artifact)("installed Desktop side chat contract", () => {
  it("finds one exported tab and one exported fork in real, integrity-checked bundled sources", () => {
    const original = Function.prototype.toString;
    const target = function candidate() {};
    let candidate = "";
    const spy = vi.spyOn(Function.prototype, "toString").mockImplementation(function () {
      return this === target ? candidate : original.call(this);
    });
    const tabs = [],
      forks = [];
    try {
      for (const file of sources()) {
        const ast = ts.createSourceFile(
          file.name,
          file.text,
          ts.ScriptTarget.Latest,
          false,
          ts.ScriptKind.JS,
        );
        const exported = new Set();
        for (const statement of ast.statements) {
          if (
            !ts.isExportDeclaration(statement) ||
            !statement.exportClause ||
            !ts.isNamedExports(statement.exportClause)
          )
            continue;
          for (const member of statement.exportClause.elements)
            exported.add((member.propertyName ?? member.name).text);
        }
        for (const statement of ast.statements) {
          if (
            !ts.isFunctionDeclaration(statement) ||
            !statement.name ||
            !exported.has(statement.name.text)
          )
            continue;
          candidate = statement.getText(ast);
          if (isNativeSideChatTab(target)) tabs.push(`${file.name}:${statement.name.text}`);
          if (isNativeSideChatFork(target)) forks.push(`${file.name}:${statement.name.text}`);
        }
      }
    } finally {
      spy.mockRestore();
    }
    expect(tabs).toHaveLength(1);
    expect(forks).toHaveLength(1);
  }, 20_000);
  it("confirms same-ID attached restore and persistent close are still native branches", () => {
    const side = sources().filter(
      (file) =>
        file.name.startsWith("local-conversation-side-chat-") &&
        file.text.includes("attachedConversationId"),
    );
    expect(side).toHaveLength(1);
    expect(side[0]?.text).toMatch(/attachedConversationId:\w+/);
    expect(side[0]?.text).toMatch(/conversationId:\w+,hostId:\w+,persistent:!0/);
    expect(side[0]?.text).toContain("listAttachedThreads");
    expect(side[0]?.text).toContain("persistent===!0");
    expect(side[0]?.text).toMatch(/\.then\(\(\)=>\w+\?!0:/);
  });
});
