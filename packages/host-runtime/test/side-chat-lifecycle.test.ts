import type { JsonObject } from "@codexhost/protocol-core";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
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
