import { FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import type { JsonObject } from "@codexhost/protocol-core";
import { hostThreadIdSchema, hostTurnIdSchema } from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  closeFixture,
  completePiTurn,
  createFixture,
  JsonLineCollector,
  requestId,
  requiredMessageId,
  startExternalThread,
  startPiTurn,
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

function resultThread(response: JsonObject): JsonObject {
  expect(response.error).toBeUndefined();
  return (response.result as JsonObject).thread as JsonObject;
}

describe("persistent native side chat contract through Host", () => {
  it("marks durable side chats hidden in Desktop's live catalog without making them ephemeral", async () => {
    const fixture = createFixture({ sideChatFeatures: { persistentSideChats: true } });
    try {
      const parentId = await startExternalThread(fixture, "codexhost/pi-native");
      await completePiTurn(fixture, parentId, 2);
      const side = resultThread(
        await rpc(fixture, 3, "thread/fork", { threadId: parentId, attachToSource: true }),
      );
      const started = (threadId: string) =>
        fixture.collector.waitFor(
          (message) =>
            message.method === "thread/started" &&
            ((message.params as JsonObject).thread as JsonObject).id === threadId,
        );
      expect(await started(parentId)).toMatchObject({ params: { thread: { threadSource: null } } });
      expect(await started(String(side.id))).toMatchObject({
        params: { thread: { threadSource: "chatgpt_hidden", ephemeral: false } },
      });
      expect(
        resultThread(await rpc(fixture, 4, "thread/read", { threadId: String(side.id) })),
      ).toMatchObject({ threadSource: "chatgpt_hidden", ephemeral: false });
    } finally {
      await stopFixture(fixture);
    }
  });

  it("confirms the archived side through Desktop's preview query without replaying usage", async () => {
    const fixture = createFixture({
      sideChatFeatures: { persistentSideChats: true, sideChatLibrary: true },
    });
    try {
      const parentId = await startExternalThread(fixture, "codexhost/pi-native");
      await completePiTurn(fixture, parentId, 2);
      const side = resultThread(
        await rpc(fixture, 3, "thread/fork", { threadId: parentId, attachToSource: true }),
      );
      const sideId = hostThreadIdSchema.parse(side.id);
      const started = await rpc(fixture, 4, "turn/start", {
        threadId: sideId,
        input: [{ type: "text", text: "Child archive preview" }],
      });
      const turnId = hostTurnIdSchema.parse(((started.result as JsonObject).turn as JsonObject).id);
      const child = fixture.adapter.sessions[1];
      if (!child) throw new Error("Missing side Session");
      child.publishUsage(
        { totalTokens: 30, contextUsedTokens: 20, contextWindowTokens: 100 },
        turnId,
      );
      await fixture.collector.waitFor(
        (message) =>
          message.method === "thread/tokenUsage/updated" &&
          (message.params as JsonObject).threadId === sideId,
      );
      child.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(await rpc(fixture, 5, "thread/archive", { threadId: sideId })).toMatchObject({
        result: {},
      });
      // A retained Desktop history view can refresh the cached Thread after archiving.
      await rpc(fixture, 6, "thread/turns/list", { threadId: sideId, limit: 1 });
      const start = fixture.collector.messages.length;
      const thread = resultThread(
        await rpc(fixture, 7, "thread/read", { threadId: sideId, includeTurns: false }),
      );
      const searchTerm =
        typeof thread.preview === "string" ? thread.preview.trim().slice(0, 80) : "";
      const native = new JsonLineCollector(fixture.official.stdin);
      const listing = rpc(fixture, 8, "thread/list", {
        cwd: thread.cwd ?? null,
        ...(searchTerm ? { searchTerm } : {}),
        sourceKinds: [
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown",
        ],
        limit: 100,
        useStateDbOnly: true,
        archived: true,
      });
      const listRequest = await native.waitFor((message) => message.method === "thread/list");
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(listRequest),
        result: { data: [], nextCursor: null },
      });
      expect(await listing).toMatchObject({
        result: { data: [{ id: sideId, preview: "Child archive preview" }] },
      });
      expect(searchTerm).toBe("Child archive preview");
      expect(fixture.collector.messages.slice(start)).not.toContainEqual(
        expect.objectContaining({
          method: "thread/tokenUsage/updated",
          params: expect.objectContaining({ threadId: sideId }),
        }),
      );
    } finally {
      await stopFixture(fixture);
    }
  });

  it("reads the legacy side chat once after a cold open and reuses its projected preview", async () => {
    const sideChatFeatures = { persistentSideChats: true, sideChatLibrary: true };
    let fixture = createFixture({ sideChatFeatures });
    try {
      const parentId = await startExternalThread(fixture, "codexhost/pi-native");
      await completePiTurn(fixture, parentId, 2);
      const commitReady = fixture.mappingStore.commitReady.bind(fixture.mappingStore);
      vi.spyOn(fixture.mappingStore, "commitReady").mockImplementation((record) => {
        delete record.sideChatInheritedTurns;
        return commitReady(record);
      });
      const side = resultThread(
        await rpc(fixture, 3, "thread/fork", { threadId: parentId, attachToSource: true }),
      );
      const started = await rpc(fixture, 4, "turn/start", {
        threadId: hostThreadIdSchema.parse(side.id),
        input: [{ type: "text", text: "Own first message" }],
      });
      const turnId = ((started.result as JsonObject).turn as JsonObject).id;
      const child = fixture.adapter.sessions[1];
      if (!child) throw new Error("Missing side Session");
      child.succeedTurn();
      await fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", String(turnId)),
      );
      const nativeRef = child.initialState.nativeRef;
      if (!nativeRef) throw new Error("Missing side Session identity");
      const snapshot = child.persistedSnapshot();
      const mappingStoreDirectory = fixture.mappingStoreDirectory;
      await closeFixture(fixture);
      fixture = createFixture({ mappingStoreDirectory, sideChatFeatures });
      const resumed = new FakeHarnessSession(
        fixture.adapter.harnessId,
        fixture.adapter.catalog,
        undefined,
        nativeRef,
        snapshot,
      );
      const open = vi
        .spyOn(fixture.adapter, "open")
        .mockResolvedValue({ ok: true, value: resumed });
      const history = vi.spyOn(resumed, "readSnapshot");
      for (const id of [5, 6]) {
        expect(
          await rpc(fixture, id, "codexhost/sideChat/list", { sourceThreadId: parentId }),
        ).toMatchObject({
          result: { items: [{ threadId: side.id, preview: "Own first message" }] },
        });
      }
      expect(history).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "resume", nativeRef }),
      );
    } finally {
      await stopFixture(fixture);
    }
  });

  it("attaches a durable fork while its parent continues, without sending child input to the parent", async () => {
    const fixture = createFixture({
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    try {
      const parentId = await startExternalThread(fixture, "codexhost/pi-native", 1, {
        historyMode: "paginated",
      });
      await completePiTurn(fixture, parentId, 2);
      const nativeRequests = new JsonLineCollector(fixture.official.stdin);
      const assigning = rpc(fixture, 3, "thread/metadata/update", {
        threadId: parentId,
        projectId: "project-a",
      });
      const projectRead = await nativeRequests.waitFor(
        (message) => message.method === "project/read",
      );
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(projectRead),
        result: { project: { id: "project-a" } },
      });
      await assigning;
      const parentTurnId = await startPiTurn(fixture, parentId, 4);
      const parent = fixture.adapter.sessions[0];
      if (!parent) throw new Error("Missing parent Session");
      const beforeHistory = parent.persistedSnapshot();
      const beforeRecord = await fixture.mappingStore.getThread(hostThreadIdSchema.parse(parentId));
      const parentExecute = vi.spyOn(parent, "execute");
      const side = resultThread(
        await rpc(fixture, 5, "thread/fork", {
          threadId: parentId,
          attachToSource: true,
          ephemeral: false,
          excludeTurns: true,
        }),
      );
      expect(side).toMatchObject({
        ephemeral: false,
        forkedFromId: parentId,
        attachedToThreadId: parentId,
        projectId: "project-a",
        codexhostSideChatOrigin: { threadId: parentId, projectId: "project-a" },
      });
      const sideId = String(side.id);
      expect(sideId).not.toBe(parentId);
      await rpc(fixture, 6, "thread/inject_items", {
        threadId: sideId,
        items: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Parent history is reference only." }],
          },
        ],
      });
      const started = await rpc(fixture, 7, "turn/start", {
        threadId: sideId,
        input: [{ type: "text", text: "SIDE_ONLY_SENTINEL" }],
      });
      const turnId = ((started.result as JsonObject).turn as JsonObject).id;
      const child = fixture.adapter.sessions[1];
      if (!child) throw new Error("Missing side Session");
      child.succeedTurn();
      await fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", String(turnId)),
      );
      expect(child.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: "Parent history is reference only.\n\nSIDE_ONLY_SENTINEL" },
      ]);
      expect(
        await rpc(fixture, 8, "codexhost/sideChat/list", { sourceThreadId: parentId }),
      ).toMatchObject({
        result: {
          items: [
            { threadId: sideId, preview: "SIDE_ONLY_SENTINEL", updatedAt: expect.any(Number) },
          ],
        },
      });
      expect(parent.persistedSnapshot()).toEqual(beforeHistory);
      expect(parentExecute).not.toHaveBeenCalled();
      expect(await fixture.mappingStore.getThread(hostThreadIdSchema.parse(parentId))).toEqual(
        beforeRecord,
      );
      parent.succeedTurn();
      await fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", parentTurnId),
      );
    } finally {
      await stopFixture(fixture);
    }
  });

  it("recovers collected and uncollected side identities after restarting, and uncollect never deletes history", async () => {
    let fixture = createFixture({
      sideChatFeatures: {
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: true,
      },
    });
    try {
      const parentId = await startExternalThread(fixture, "codexhost/pi-native");
      await completePiTurn(fixture, parentId, 2);
      const first = resultThread(
        await rpc(fixture, 3, "thread/fork", { threadId: parentId, attachToSource: true }),
      );
      const second = resultThread(
        await rpc(fixture, 4, "thread/fork", { threadId: parentId, attachToSource: true }),
      );
      const firstTurn = await rpc(fixture, 12, "turn/start", {
        threadId: hostThreadIdSchema.parse(first.id),
        input: [{ type: "text", text: "Child-only\nfirst message" }],
      });
      const firstTurnId = ((firstTurn.result as JsonObject).turn as JsonObject).id;
      fixture.adapter.sessions[1]?.succeedTurn();
      await fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", String(firstTurnId)),
      );
      expect(
        await rpc(fixture, 5, "codexhost/sideChat/update", {
          threadId: hostThreadIdSchema.parse(first.id),
          collected: true,
        }),
      ).toMatchObject({ result: { item: { threadId: first.id, collected: true } } });
      expect(
        await rpc(fixture, 6, "codexhost/sideChat/update", { threadId: parentId, collected: true }),
      ).toHaveProperty("error");
      const directory = fixture.mappingStoreDirectory;
      await closeFixture(fixture);
      fixture = createFixture({
        mappingStoreDirectory: directory,
        sideChatFeatures: {
          persistentSideChats: true,
          sideChatLibrary: true,
          claudeActiveSideChatFork: true,
        },
      });
      await fixture.ready;
      const all = await rpc(fixture, 7, "codexhost/sideChat/list", { sourceThreadId: parentId });
      expect((all.result as JsonObject).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: first.id,
            sourceThreadId: parentId,
            collected: true,
            preview: "Child-only first message",
          }),
          expect.objectContaining({
            threadId: second.id,
            sourceThreadId: parentId,
            collected: false,
          }),
        ]),
      );
      const collected = await rpc(fixture, 8, "codexhost/sideChat/list", {});
      expect((collected.result as JsonObject).items).toHaveLength(1);
      await rpc(fixture, 9, "codexhost/sideChat/update", {
        threadId: hostThreadIdSchema.parse(first.id),
        collected: false,
      });
      expect(
        await fixture.mappingStore.getThread(hostThreadIdSchema.parse(first.id)),
      ).toMatchObject({ ephemeral: false, attachedToThreadId: parentId });
      expect((await rpc(fixture, 10, "codexhost/sideChat/list", {})).result).toEqual({ items: [] });
      expect(await rpc(fixture, 11, "thread/delete", { threadId: parentId })).toEqual({
        id: 11,
        result: {},
      });
      expect(await fixture.mappingStore.getThread(hostThreadIdSchema.parse(parentId))).toBeNull();
      for (const child of [first, second]) {
        expect(
          await fixture.mappingStore.getThread(hostThreadIdSchema.parse(child.id)),
        ).toMatchObject({ ephemeral: false, attachedToThreadId: parentId });
      }
      const orphaned = await rpc(fixture, 12, "codexhost/sideChat/list", {
        sourceThreadId: parentId,
      });
      expect((orphaned.result as JsonObject).items).toEqual(
        expect.arrayContaining(
          [first, second].map((child) =>
            expect.objectContaining({
              threadId: child.id,
              sourceThreadId: parentId,
              sourceAvailable: false,
            }),
          ),
        ),
      );
    } finally {
      await stopFixture(fixture);
    }
  });
});
