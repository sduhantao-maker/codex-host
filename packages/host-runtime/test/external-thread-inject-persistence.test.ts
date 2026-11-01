import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeHarnessAdapter, FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import { MappingStore } from "@codexhost/mapping-store";
import type { JsonObject } from "@codexhost/protocol-core";
import { harnessIdSchema, hostThreadIdSchema } from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  closeFixture,
  completePiTurn,
  createFixture,
  requestId,
  startPiThread,
  startPiTurn,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

function inject(
  fixture: ReturnType<typeof createFixture>,
  threadId: string,
  id: number,
  text: string,
) {
  writeRequest(fixture.desktopInput, {
    id,
    method: "thread/inject_items",
    params: {
      threadId,
      items: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
    },
  });
  return fixture.collector.waitFor((message) => requestId(message, id));
}

describe("External Side Chat context persistence", () => {
  it("restores persisted context after a Host restart without changing its parent", async () => {
    const first = createFixture({
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    let active = first;
    try {
      const parentId = await startPiThread(first);
      await completePiTurn(first, parentId, 2);
      const parentBefore = await first.mappingStore.getThread(hostThreadIdSchema.parse(parentId));
      const parent = first.adapter.sessions[0];
      if (!parent) throw new Error("Missing parent Session");
      const parentHistory = parent.persistedSnapshot();
      writeRequest(first.desktopInput, {
        id: 3,
        method: "thread/fork",
        params: { threadId: parentId },
      });
      const forked = await first.collector.waitFor((message) => requestId(message, 3));
      const sideId = ((forked.result as JsonObject).thread as JsonObject).id;
      if (typeof sideId !== "string") throw new Error("Missing Side Chat identity");
      await expect(
        inject(first, sideId, 4, "Parent history is reference only."),
      ).resolves.toMatchObject({ result: {} });
      await vi.waitFor(async () => {
        await expect(
          first.mappingStore.getThread(hostThreadIdSchema.parse(sideId)),
        ).resolves.toMatchObject({
          pendingInjectedText: ["Parent history is reference only."],
        });
      });
      await expect(
        first.mappingStore.getThread(hostThreadIdSchema.parse(parentId)),
      ).resolves.toEqual(parentBefore);
      const previous = first.adapter.sessions[1];
      if (!previous?.initialState.nativeRef) throw new Error("Missing native Side Chat");
      const snapshot = previous.persistedSnapshot();
      const nativeRef = previous.initialState.nativeRef;
      const directory = first.mappingStoreDirectory;
      await closeFixture(first);

      const adapter = new FakeHarnessAdapter(harnessIdSchema.parse("pi"));
      const resumed = new FakeHarnessSession(
        adapter.harnessId,
        adapter.catalog,
        undefined,
        nativeRef,
        snapshot,
      );
      vi.spyOn(adapter, "open").mockImplementation(async (input) => {
        expect(input.kind).toBe("resume");
        if (input.kind === "resume") expect(input.nativeRef).toEqual(nativeRef);
        return { ok: true, value: resumed };
      });
      const restarted = createFixture({
        sideChatFeatures: {
          persistentSideChats: true,
          sideChatLibrary: true,
          claudeActiveSideChatFork: true,
        },
        externalAdapters: new Map([["pi", adapter]]),
        mappingStoreDirectory: directory,
      });
      active = restarted;
      const turnId = await startPiTurn(restarted, sideId, 5);
      resumed.succeedTurn();
      await restarted.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(resumed.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: "Parent history is reference only.\n\nsynthetic" },
      ]);
      await expect(
        restarted.mappingStore.getThread(hostThreadIdSchema.parse(sideId)),
      ).resolves.toMatchObject({ pendingInjectedText: [] });
      await expect(
        restarted.mappingStore.getThread(hostThreadIdSchema.parse(parentId)),
      ).resolves.toEqual(parentBefore);
      const nextTurnId = await startPiTurn(restarted, sideId, 6);
      resumed.succeedTurn();
      await restarted.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", nextTurnId),
      );
      expect(resumed.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: "synthetic" },
      ]);
      expect(parent.persistedSnapshot()).toEqual(parentHistory);
    } finally {
      await stopFixture(active);
    }
  });

  it("acknowledges in-memory injections and orders durable context before the same-thread Turn", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-inject-order-"));
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const store = new MappingStore({
      directory,
      beforeReplace: async (record) => {
        if (Array.isArray(record.pendingInjectedText) && record.pendingInjectedText.length === 1) {
          entered.resolve(undefined);
          await release.promise;
        }
      },
    });
    const fixture = createFixture({
      mappingStore: store,
      mappingStoreDirectory: directory,
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    try {
      const threadId = await startPiThread(fixture);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing native Session");
      const execute = vi.spyOn(session, "execute");
      const first = inject(fixture, threadId, 2, "First context.");
      const second = inject(fixture, threadId, 3, "Second context.");
      const starting = startPiTurn(fixture, threadId, 4);
      await entered.promise;
      expect(execute).not.toHaveBeenCalled();
      await expect(first).resolves.toMatchObject({ result: {} });
      await expect(second).resolves.toMatchObject({ result: {} });
      release.resolve(undefined);
      const turnId = await starting;
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(session.persistedSnapshot().turns[0]?.input).toEqual([
        { type: "text", text: "First context.\n\nSecond context.\n\nsynthetic" },
      ]);
    } finally {
      release.resolve(undefined);
      await stopFixture(fixture);
    }
  });

  it("keeps native in-memory injection usable and diagnoses a failed durable write", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-inject-failure-"));
    const store = new MappingStore({
      directory,
      beforeReplace(record) {
        if (Array.isArray(record.pendingInjectedText) && record.pendingInjectedText.length > 0)
          throw new Error("synthetic context write failure");
      },
    });
    const fixture = createFixture({
      mappingStore: store,
      mappingStoreDirectory: directory,
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    let diagnostics = "";
    fixture.diagnosticOutput.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    try {
      const threadId = await startPiThread(fixture);
      await expect(
        inject(fixture, threadId, 2, "Keep this native context."),
      ).resolves.toMatchObject({ result: {} });
      expect(
        (await store.getThread(hostThreadIdSchema.parse(threadId)))?.pendingInjectedText,
      ).toBeUndefined();
      await vi.waitFor(() =>
        expect(diagnostics).toContain("Mapping Store atomic replacement failed"),
      );
      await completePiTurn(fixture, threadId, 3);
      expect(fixture.adapter.sessions[0]?.persistedSnapshot().turns[0]?.input).toEqual([
        { type: "text", text: "Keep this native context.\n\nsynthetic" },
      ]);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("keeps an accepted native Turn running when clearing context fails, then retries at completion", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codexhost-inject-clear-failure-"));
    let rejectClear = false;
    let clearFailures = 0;
    const store = new MappingStore({
      directory,
      beforeReplace(record) {
        if (
          rejectClear &&
          Array.isArray(record.pendingInjectedText) &&
          record.pendingInjectedText.length === 0
        ) {
          rejectClear = false;
          clearFailures += 1;
          throw new Error("synthetic clear failure");
        }
      },
    });
    const fixture = createFixture({
      mappingStore: store,
      mappingStoreDirectory: directory,
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    try {
      const threadId = await startPiThread(fixture);
      await inject(fixture, threadId, 2, "Side context.");
      rejectClear = true;
      const turnId = await startPiTurn(fixture, threadId, 3);
      expect(clearFailures).toBe(1);
      writeRequest(fixture.desktopInput, {
        id: 4,
        method: "turn/start",
        params: { threadId, input: [{ type: "text", text: "Must remain busy." }] },
      });
      await expect(
        fixture.collector.waitFor((message) => requestId(message, 4)),
      ).resolves.toMatchObject({ error: { code: -32072 } });
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing native Session");
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      await expect(store.getThread(hostThreadIdSchema.parse(threadId))).resolves.toMatchObject({
        pendingInjectedText: [],
      });
      await completePiTurn(fixture, threadId, 5);
      expect(
        fixture.adapter.sessions[0]?.persistedSnapshot().turns.map((turn) => turn.input),
      ).toEqual([
        [{ type: "text", text: "Side context.\n\nsynthetic" }],
        [{ type: "text", text: "synthetic" }],
      ]);
    } finally {
      await stopFixture(fixture);
    }
  });
});
