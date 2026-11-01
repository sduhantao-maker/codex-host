import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { MappingStore } from "@codexhost/mapping-store";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  createFixture,
  JsonLineCollector,
  requestId,
  requiredMessageId,
  startPiThread,
  startPiTurn,
  stopFixture,
  writeRequest,
  turnEvent,
} from "./app-server-host-fixture.js";

describe("sidechat request admission isolation", () => {
  it("forwards main stop and approval while side-context fsync is stalled, but orders its own next Turn", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "sidechat-admission-"));
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const store = new MappingStore({
      directory,
      beforeReplace: async (record) => {
        if (Array.isArray(record.pendingInjectedText) && record.pendingInjectedText.length) {
          entered.resolve(undefined);
          await release.promise;
        }
      },
    });
    const fixture = createFixture({
      mappingStore: store,
      mappingStoreDirectory: directory,
      sideChatFeatures: { persistentSideChats: true },
    });
    const native = new JsonLineCollector(fixture.official.stdin);
    try {
      const sideId = await startPiThread(fixture);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing side session");
      const execute = vi.spyOn(session, "execute");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "thread/inject_items",
        params: {
          threadId: sideId,
          items: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "reference" }] },
          ],
        },
      });
      await entered.promise;
      const starting = startPiTurn(fixture, sideId, 3);
      writeRequest(fixture.desktopInput, {
        id: 4,
        method: "turn/interrupt",
        params: { threadId: "native-main", turnId: "native-turn" },
      });
      const stop = await native.waitFor((message) => message.method === "turn/interrupt");
      writeRequest(fixture.official.stdout, { id: requiredMessageId(stop), result: {} });
      expect(await fixture.collector.waitFor((message) => requestId(message, 4))).toMatchObject({
        result: {},
      });
      writeRequest(fixture.official.stdout, {
        id: 700,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "native-main",
          turnId: "native-turn",
          itemId: "command",
          command: "echo check",
          cwd: "/synthetic",
        },
      });
      const approval = await fixture.collector.waitFor(
        (message) => message.method === "item/commandExecution/requestApproval",
      );
      writeRequest(fixture.desktopInput, {
        id: requiredMessageId(approval),
        result: { decision: "accept" },
      });
      await native.waitFor((message) => message.id === 700 && !!message.result);
      expect(execute).not.toHaveBeenCalled();
      release.resolve(undefined);
      const turnId = await starting;
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(session.persistedSnapshot().turns[0]?.input).toEqual([
        { type: "text", text: "reference\n\nsynthetic" },
      ]);
    } finally {
      release.resolve(undefined);
      await stopFixture(fixture);
    }
  });

  it("hot-disable releases a stalled side Turn and late persistence cannot replay consumed context", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "sidechat-disable-"));
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const store = new MappingStore({
      directory,
      beforeReplace: async (record) => {
        if (Array.isArray(record.pendingInjectedText) && record.pendingInjectedText.length) {
          entered.resolve(undefined);
          await release.promise;
        }
      },
    });
    const fixture = createFixture({
      mappingStore: store,
      mappingStoreDirectory: directory,
      sideChatFeatures: { persistentSideChats: true },
    });
    try {
      const sideId = await startPiThread(fixture);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing side session");
      const execute = vi.spyOn(session, "execute");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "thread/inject_items",
        params: {
          threadId: sideId,
          items: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "reference" }] },
          ],
        },
      });
      await entered.promise;
      expect(await fixture.collector.waitFor((message) => requestId(message, 2))).toMatchObject({
        result: {},
      });
      const starting = startPiTurn(fixture, sideId, 3);
      writeRequest(fixture.desktopInput, {
        id: 4,
        method: "codexhost/sideChat/features/set",
        params: { persistentSideChats: false },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 4))).toMatchObject({
        result: { settings: { persistentSideChats: false } },
      });
      const turnId = await starting;
      expect(execute).toHaveBeenCalledTimes(1);
      release.resolve(undefined);
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(session.persistedSnapshot().turns[0]?.input).toEqual([
        { type: "text", text: "reference\n\nsynthetic" },
      ]);
      await vi.waitFor(async () =>
        expect(
          (await store.getThread(hostThreadIdSchema.parse(sideId)))?.pendingInjectedText,
        ).toEqual([]),
      );
    } finally {
      release.resolve(undefined);
      await stopFixture(fixture);
    }
  });

  it("clears previously durable context consumed while disabled before persistence can be re-enabled", async () => {
    const fixture = createFixture({ sideChatFeatures: { persistentSideChats: true } });
    try {
      const sideId = await startPiThread(fixture);
      const session = fixture.adapter.sessions[0];
      if (!session) throw new Error("Missing side session");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "thread/inject_items",
        params: {
          threadId: sideId,
          items: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "once" }] },
          ],
        },
      });
      await fixture.collector.waitFor((message) => requestId(message, 2));
      await vi.waitFor(async () =>
        expect(
          (await fixture.mappingStore.getThread(hostThreadIdSchema.parse(sideId)))
            ?.pendingInjectedText,
        ).toEqual(["once"]),
      );
      writeRequest(fixture.desktopInput, {
        id: 3,
        method: "codexhost/sideChat/features/set",
        params: { persistentSideChats: false },
      });
      await fixture.collector.waitFor((message) => requestId(message, 3));
      const turnId = await startPiTurn(fixture, sideId, 4);
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      await vi.waitFor(async () =>
        expect(
          (await fixture.mappingStore.getThread(hostThreadIdSchema.parse(sideId)))
            ?.pendingInjectedText,
        ).toEqual([]),
      );
      writeRequest(fixture.desktopInput, {
        id: 5,
        method: "codexhost/sideChat/features/set",
        params: { persistentSideChats: true },
      });
      await fixture.collector.waitFor((message) => requestId(message, 5));
      const next = await startPiTurn(fixture, sideId, 6);
      session.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", next));
      expect(session.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: "synthetic" },
      ]);
    } finally {
      await stopFixture(fixture);
    }
  });

  it("does not queue main stop behind official side-chat source lookup", async () => {
    const fixture = createFixture({ sideChatFeatures: { persistentSideChats: true } });
    const native = new JsonLineCollector(fixture.official.stdin);
    try {
      await fixture.ready;
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: "thread/fork",
        params: { threadId: "native-parent", attachToSource: true, ephemeral: false },
      });
      const read = await native.waitFor((message) => message.method === "thread/read");
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: "turn/interrupt",
        params: { threadId: "native-main", turnId: "main-turn" },
      });
      const stop = await native.waitFor((message) => message.method === "turn/interrupt");
      writeRequest(fixture.official.stdout, { id: requiredMessageId(stop), result: {} });
      expect(await fixture.collector.waitFor((message) => requestId(message, 2))).toMatchObject({
        result: {},
      });
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(read),
        result: { thread: { id: "native-parent", historyMode: "paginated", projectId: null } },
      });
      const fork = await native.waitFor((message) => message.method === "thread/fork");
      writeRequest(fixture.official.stdout, {
        id: requiredMessageId(fork),
        result: { thread: { id: "native-side", forkedFromId: "native-parent", ephemeral: false } },
      });
      const response = await fixture.collector.waitFor((message) => requestId(message, 1));
      expect(((response.result as JsonObject).thread as JsonObject).id).toBe("native-side");
    } finally {
      await stopFixture(fixture);
    }
  });
});
