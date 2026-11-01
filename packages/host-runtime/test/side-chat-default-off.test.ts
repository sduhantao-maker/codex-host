import { describe, expect, it, vi } from "vitest";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  createFixture,
  startPiThread,
  completePiTurn,
  writeRequest,
  requestId,
  stopFixture,
  JsonLineCollector,
} from "./app-server-host-fixture.js";

describe("sidechat disabled matches stable v2", () => {
  it("does not read the side index, does not intercept native forks and keeps stable memory-only injection", async () => {
    const fixture = createFixture();
    const index = vi
      .spyOn(fixture.mappingStore, "listSideChatCollection")
      .mockRejectedValue(new Error("must not read disabled index"));
    const writes = vi.spyOn(fixture.mappingStore, "setPendingInjectedText");
    const native = new JsonLineCollector(fixture.official.stdin);
    try {
      const threadId = await startPiThread(fixture);
      await completePiTurn(fixture, threadId, 2);
      writeRequest(fixture.desktopInput, {
        id: 3,
        method: "thread/fork",
        params: { threadId: "native-parent", attachToSource: true },
      });
      const fork = await native.waitFor((message) => message.method === "thread/fork");
      expect(fork.params).toEqual({ threadId: "native-parent", attachToSource: true });
      writeRequest(fixture.official.stdout, {
        id: fork.id as string,
        result: { thread: { id: "native-child" } },
      });
      await fixture.collector.waitFor((message) => requestId(message, 3));
      writeRequest(fixture.desktopInput, { id: 4, method: "thread/list", params: {} });
      const list = await native.waitFor((message) => message.method === "thread/list");
      writeRequest(fixture.official.stdout, {
        id: list.id as string,
        result: { data: [], nextCursor: null, backwardsCursor: null },
      });
      await fixture.collector.waitFor((message) => requestId(message, 4));
      expect(index).not.toHaveBeenCalled();
      writeRequest(fixture.desktopInput, {
        id: 5,
        method: "thread/inject_items",
        params: {
          threadId,
          items: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "reference" }] },
          ],
        },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 5))).toMatchObject({
        result: {},
      });
      expect(writes).not.toHaveBeenCalled();
      expect(
        await fixture.mappingStore.getThread(hostThreadIdSchema.parse(threadId)),
      ).not.toHaveProperty("pendingInjectedText");
    } finally {
      await stopFixture(fixture);
    }
  });

  it("leaves old durable metadata untouched when the process starts disabled", async () => {
    const fixture = createFixture();
    try {
      const threadId = await startPiThread(fixture);
      await fixture.mappingStore.setPendingInjectedText(hostThreadIdSchema.parse(threadId), ["old retained context"]);
      const writes = vi.spyOn(fixture.mappingStore, "setPendingInjectedText");
      await completePiTurn(fixture, threadId, 2);
      expect(fixture.adapter.sessions[0]?.persistedSnapshot().turns[0]?.input).toEqual([{ type: "text", text: "synthetic" }]);
      expect(writes).not.toHaveBeenCalled();
      expect((await fixture.mappingStore.getThread(hostThreadIdSchema.parse(threadId)))?.pendingInjectedText).toEqual(["old retained context"]);
    } finally { await stopFixture(fixture); }
  });

  it("advertises independent off switches and never grants remote or shared-service fork rewriting", async () => {
    const fixture = createFixture({ environment: { CODEXHOST_REMOTE_SSH_MANAGED: "1" } });
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: "codexhost/sideChat/features/get",
        params: { probeId: "probe" },
      });
      const response = await fixture.collector.waitFor((message) => requestId(message, 1));
      const result = response.result as JsonObject;
      expect(result.settings).toEqual({
        persistentSideChats: false,
        sideChatLibrary: false,
        claudeActiveSideChatFork: false,
      });
      expect(result.capabilities).toEqual(result.settings);
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "codexhost/sideChat/features/set",
        params: { sideChatLibrary: true },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 2))).toMatchObject({
        result: {
          settings: {
            persistentSideChats: false,
            sideChatLibrary: true,
            claudeActiveSideChatFork: false,
          },
        },
      });
    } finally {
      await stopFixture(fixture);
    }
  });
});
