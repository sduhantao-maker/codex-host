import type { HostThreadSnapshot, OpenSessionInput } from "@codexhost/harness-adapter";
import { FakeHarnessAdapter, FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import { CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID, type JsonObject } from "@codexhost/protocol-core";
import {
  harnessIdSchema,
  hostThreadIdSchema,
  hostTurnIdSchema,
  nativeCheckpointRefSchema,
  nativeSessionRefSchema,
  nativeTurnRefSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  requestId,
  startExternalThread,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

function rpc(
  fixture: ReturnType<typeof createFixture>,
  id: number,
  method: string,
  params: JsonObject,
) {
  writeRequest(fixture.desktopInput, { id, method, params });
  return fixture.collector.waitFor((message) => requestId(message, id));
}

async function startTurn(
  fixture: ReturnType<typeof createFixture>,
  threadId: string,
  id: number,
  text = "synthetic",
) {
  const response = await rpc(fixture, id, "turn/start", {
    threadId,
    input: [{ type: "text", text }],
  });
  expect(response.error).toBeUndefined();
  const turn = (response.result as JsonObject).turn as JsonObject;
  if (typeof turn.id !== "string") throw new Error("Missing started Turn identity");
  await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", String(turn.id)));
  return turn.id;
}

async function fixture() {
  const adapter = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  const host = createFixture({ externalAdapters: new Map([["claude-code", adapter]]) });
  const sourceId = await startExternalThread(host, CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID);
  const source = adapter.sessions[0];
  const sourceRef = source?.initialState.nativeRef;
  if (!source || !sourceRef) throw new Error("Missing source native Session");
  return { host, adapter, sourceId, source, sourceRef };
}

describe("active side-chat Fork routing", () => {
  it("forks the first active native user boundary into a durable child without completing its parent", async () => {
    const f = await fixture();
    try {
      const activeTurnId = await startTurn(f.host, f.sourceId, 2);
      const before = await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId));
      expect(before?.turnMappings).toEqual([]);
      expect(f.source.persistedSnapshot().turns).toEqual([]);
      const checkpoint = nativeCheckpointRefSchema.parse({
        harnessId: "claude-code",
        nativeSessionId: f.sourceRef.nativeSessionId,
        checkpointId: "persisted-active-user",
        formatVersion: 1,
      });
      const capture = vi.fn(async () => ({
        ok: true as const,
        value: { turnId: hostTurnIdSchema.parse(activeTurnId), checkpoint },
      }));
      Object.assign(f.source, { captureActiveForkBoundary: capture });
      const childRef = nativeSessionRefSchema.parse({
        harnessId: "claude-code",
        nativeSessionId: "native-active-sidechat",
        formatVersion: 1,
      });
      // This models the SDK's persisted user-only prefix; it adds no completed source Turn.
      const prefix: HostThreadSnapshot = {
        turns: [
          {
            nativeTurnRef: nativeTurnRefSchema.parse({
              harnessId: "claude-code",
              nativeSessionId: childRef.nativeSessionId,
              nativeTurnKey: "child-user-copy",
              formatVersion: 1,
            }),
            input: [{ type: "text", text: "synthetic" }],
            items: [],
            outcome: { status: "unknown", reason: "User entry only; parent Turn is still running" },
          },
        ],
      };
      const child = new FakeHarnessSession(
        f.adapter.harnessId,
        f.adapter.catalog,
        undefined,
        childRef,
        prefix,
      );
      const nativeOpen = f.adapter.open.bind(f.adapter);
      const open = vi
        .spyOn(f.adapter, "open")
        .mockImplementation(async (input: OpenSessionInput) => {
          if (input.kind !== "fork") return nativeOpen(input);
          expect(input.sourceRef).toEqual(f.sourceRef);
          expect(input.checkpoint).toEqual(checkpoint);
          f.adapter.sessions.push(child);
          return { ok: true, value: child };
        });
      const sourceExecute = vi.spyOn(f.source, "execute");
      const sourceClose = vi.spyOn(f.source, "close");
      const response = await rpc(f.host, 3, "thread/fork", {
        threadId: f.sourceId,
        attachToSource: true,
        ephemeral: false,
      });
      expect(response.error).toBeUndefined();
      const side = (response.result as JsonObject).thread as JsonObject;
      if (typeof side.id !== "string") throw new Error("Missing derived Thread identity");
      expect(side.id).not.toBe(f.sourceId);
      expect(side).toMatchObject({
        ephemeral: false,
        attachedToThreadId: f.sourceId,
        forkedFromId: f.sourceId,
      });
      expect(capture).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledOnce();
      expect(await f.host.mappingStore.getThread(hostThreadIdSchema.parse(side.id))).toMatchObject({
        state: "ready",
        ephemeral: false,
        nativeSessionRef: childRef,
        attachedToThreadId: f.sourceId,
        forkSource: { hostThreadId: f.sourceId, hostTurnId: activeTurnId },
      });
      const childTurn = await startTurn(f.host, side.id, 4, "SIDE_ONLY_SENTINEL");
      child.succeedTurn();
      await f.host.collector.waitFor((message) => turnEvent(message, "turn/completed", childTurn));
      expect(f.source.persistedSnapshot().turns).toEqual([]);
      expect(await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId))).toEqual(
        before,
      );
      expect(sourceExecute).not.toHaveBeenCalled();
      expect(sourceClose).not.toHaveBeenCalled();
      expect(f.source.steers).toEqual([]);
      expect(() => f.source.appendText("The parent continues independently.")).not.toThrow();
      f.source.succeedTurn();
      await f.host.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", activeTurnId),
      );
      expect(f.source.persistedSnapshot().turns[0]?.input).toEqual([
        { type: "text", text: "synthetic" },
      ]);
      expect(child.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: "SIDE_ONLY_SENTINEL" },
      ]);
    } finally {
      await stopFixture(f.host);
    }
  });

  it.each(["turn", "session", "harness"])(
    "rejects an active boundary with another %s before creating any child",
    async (invalid) => {
      const f = await fixture();
      try {
        const activeTurnId = await startTurn(f.host, f.sourceId, 2);
        const before = await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId));
        const checkpoint = nativeCheckpointRefSchema.parse({
          harnessId: invalid === "harness" ? "pi" : "claude-code",
          nativeSessionId:
            invalid === "session" ? "unrelated-native-session" : f.sourceRef.nativeSessionId,
          checkpointId: "persisted-active-user",
          formatVersion: 1,
        });
        const capture = vi.fn(async () => ({
          ok: true as const,
          value: {
            turnId: hostTurnIdSchema.parse(invalid === "turn" ? "another-turn" : activeTurnId),
            checkpoint,
          },
        }));
        Object.assign(f.source, { captureActiveForkBoundary: capture });
        const open = vi.spyOn(f.adapter, "open");
        const sourceExecute = vi.spyOn(f.source, "execute");
        const sourceClose = vi.spyOn(f.source, "close");
        await expect(
          rpc(f.host, 3, "thread/fork", { threadId: f.sourceId, attachToSource: true }),
        ).resolves.toMatchObject({ error: { code: -32080 } });
        expect(capture).toHaveBeenCalledOnce();
        expect(open).not.toHaveBeenCalled();
        expect(await f.host.mappingStore.listThreads()).toHaveLength(1);
        expect(await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId))).toEqual(
          before,
        );
        expect(sourceExecute).not.toHaveBeenCalled();
        expect(sourceClose).not.toHaveBeenCalled();
        expect(() => f.source.appendText("The parent is still active.")).not.toThrow();
        f.source.succeedTurn();
        await f.host.collector.waitFor((message) =>
          turnEvent(message, "turn/completed", activeTurnId),
        );
      } finally {
        await stopFixture(f.host);
      }
    },
  );

  it("keeps ordinary Forks on the completed checkpoint even when active capture is available", async () => {
    const f = await fixture();
    try {
      const completedTurn = await startTurn(f.host, f.sourceId, 2);
      f.source.succeedTurn();
      await f.host.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", completedTurn),
      );
      const before = await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId));
      const completedCheckpoint = before?.turnMappings[0]?.nativeCheckpointRef;
      if (!completedCheckpoint) throw new Error("Missing actual completed checkpoint");
      const activeTurnId = await startTurn(f.host, f.sourceId, 3, "still running");
      const capture = vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "sessionBusy" as const,
          message: "This capture must not be used",
          retryable: true,
        },
      }));
      Object.assign(f.source, { captureActiveForkBoundary: capture });
      const open = vi.spyOn(f.adapter, "open");
      const sourceExecute = vi.spyOn(f.source, "execute");
      const response = await rpc(f.host, 4, "thread/fork", { threadId: f.sourceId });
      expect(response.error).toBeUndefined();
      expect(capture).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "fork", checkpoint: completedCheckpoint }),
      );
      const derivedId = ((response.result as JsonObject).thread as JsonObject).id;
      if (typeof derivedId !== "string") throw new Error("Missing derived Thread identity");
      const derivedRecord = await f.host.mappingStore.getThread(
        hostThreadIdSchema.parse(derivedId),
      );
      expect(derivedRecord?.attachedToThreadId).toBeUndefined();
      expect(derivedRecord?.forkSource).toEqual({
        hostThreadId: f.sourceId,
        hostTurnId: completedTurn,
      });
      expect(await f.host.mappingStore.getThread(hostThreadIdSchema.parse(f.sourceId))).toEqual(
        before,
      );
      expect(sourceExecute).not.toHaveBeenCalled();
      expect(() =>
        f.source.appendText("The parent continues after an ordinary Fork."),
      ).not.toThrow();
      f.source.succeedTurn();
      await f.host.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", activeTurnId),
      );
    } finally {
      await stopFixture(f.host);
    }
  });
});
