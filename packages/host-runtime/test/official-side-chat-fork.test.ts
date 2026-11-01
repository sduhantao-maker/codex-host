import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredSideChatCollectionEntry } from "@codexhost/mapping-store";
import type { JsonObject } from "@codexhost/protocol-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forkOfficialSideChat } from "../src/official-side-chat-fork.js";
import {
  createFixture,
  JsonLineCollector,
  requestId,
  stopFixture,
  writeRequest,
} from "./app-server-host-fixture.js";

afterEach(() => {
  vi.useRealTimers();
});

function fixture(historyMode?: string) {
  const entries: StoredSideChatCollectionEntry[] = [];
  const result: JsonObject = {
    thread: { id: "native-side", forkedFromId: "native-parent", ephemeral: false },
    model: "native-model",
    futureResultField: { preserved: true },
  };
  const response: JsonObject = { id: "internal-fork", result };
  const store = {
    listSideChatCollection: vi.fn(async () => entries),
    setSideChatCollected: vi.fn(async () => undefined),
    registerSideChatOrigin: vi.fn(async (entry: StoredSideChatCollectionEntry) => {
      entries.push(entry);
    }),
  };
  const requestOfficial = vi.fn(async (method: string, params: JsonObject): Promise<JsonObject> => {
    void params;
    return method === "thread/read"
      ? {
          result: {
            thread: {
              id: "native-parent",
              projectId: "native-project",
              ...(historyMode === undefined ? {} : { historyMode }),
            },
          },
        }
      : response;
  });
  return {
    store,
    entries,
    requestOfficial,
    response,
    result,
    assertScope: vi.fn(),
    diagnose: vi.fn(),
    now: () => new Date("2026-10-31T00:00:00Z"),
  };
}

async function enablePersistence(fixture: ReturnType<typeof createFixture>): Promise<void> {
  writeRequest(fixture.desktopInput, {
    id: 9,
    method: "codexhost/sideChat/features/set",
    params: { persistentSideChats: true },
  });
  const response = await fixture.collector.waitFor((message) => requestId(message, 9));
  expect(response).toMatchObject({ result: { settings: { persistentSideChats: true } } });
}

describe("official Side Chat native Fork", () => {
  it.each(["legacy", undefined, "paginated"])(
    "keeps %s source forks durable and returns the complete native response",
    async (mode) => {
      const f = fixture(mode);
      const params = {
        threadId: "native-parent",
        attachToSource: true,
        ephemeral: false,
        excludeTurns: true,
        path: null,
        config: { preserve: "native" },
      };
      const response = await forkOfficialSideChat(params, f);
      expect(response).toBe(f.response);
      expect(f.requestOfficial.mock.calls[0]).toEqual([
        "thread/read",
        { threadId: "native-parent", includeTurns: false },
      ]);
      expect(f.requestOfficial.mock.calls[1]).toEqual([
        "thread/fork",
        { ...params, attachToSource: mode === "paginated" },
      ]);
      expect(f.entries).toEqual([
        {
          threadId: "native-side",
          sourceThreadId: "native-parent",
          projectId: "native-project",
          registeredAt: "2026-10-31T00:00:00.000Z",
        },
      ]);
      expect(f.entries[0]?.collectedAt).toBeUndefined();
    },
  );

  it("preserves native source authorization errors and never attempts a Fork", async () => {
    const f = fixture();
    const denied = {
      error: { code: -32000, message: "not authorized", data: { nativeDetail: true } },
    };
    f.requestOfficial.mockResolvedValue(denied);
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      denied,
    );
    expect(f.requestOfficial).toHaveBeenCalledOnce();
    expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
  });

  it.each(["legacy", "paginated"])(
    "uses native fallback for a %s source when optional metadata is unreadable",
    async (mode) => {
      const f = fixture(mode);
      f.store.listSideChatCollection.mockRejectedValue(new Error("invalid index"));
      const params = { threadId: "native-parent", attachToSource: true, ephemeral: false };
      expect(await forkOfficialSideChat(params, f)).toBe(f.response);
      expect(f.requestOfficial.mock.calls).toEqual([
        ["thread/read", { threadId: "native-parent", includeTurns: false }],
        [
          "thread/fork",
          mode === "legacy" ? { ...params, attachToSource: false, ephemeral: true } : params,
        ],
      ]);
      expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
      expect(f.diagnose).toHaveBeenCalledOnce();
    },
  );

  it("acknowledges a native success before slow origin storage finishes", async () => {
    const f = fixture();
    const writing = Promise.withResolvers<undefined>();
    f.store.registerSideChatOrigin.mockReturnValue(writing.promise);
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    expect(f.store.registerSideChatOrigin).toHaveBeenCalledOnce();
    expect(f.entries).toEqual([]);
    writing.resolve(undefined);
  });

  it("returns native success and retries metadata without creating another Fork", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.store.registerSideChatOrigin.mockRejectedValueOnce(new Error("disk full"));
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    expect(f.store.registerSideChatOrigin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(f.store.registerSideChatOrigin).toHaveBeenCalledTimes(2);
    expect(f.entries).toHaveLength(1);
    expect(f.requestOfficial.mock.calls.map(([method]) => method)).toEqual([
      "thread/read",
      "thread/fork",
    ]);
    expect(f.diagnose).toHaveBeenCalledOnce();
  });

  it("bounds metadata retries and never lets diagnostics break the native result", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.store.registerSideChatOrigin.mockRejectedValue(new Error("disk full"));
    f.diagnose.mockImplementation(() => {
      throw new Error("diagnostics unavailable");
    });
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    await vi.runAllTimersAsync();
    expect(f.store.registerSideChatOrigin).toHaveBeenCalledTimes(3);
    expect(
      f.requestOfficial.mock.calls.filter(([method]) => method === "thread/fork"),
    ).toHaveLength(1);
  });

  it("stops background registration when the native scope changes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.store.registerSideChatOrigin.mockRejectedValue(new Error("disk full"));
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    f.assertScope.mockImplementation(() => {
      throw new Error("owner changed");
    });
    await vi.runAllTimersAsync();
    expect(f.store.registerSideChatOrigin).toHaveBeenCalledOnce();
    expect(f.entries).toEqual([]);
  });

  it("keeps native error replies intact without metadata retries", async () => {
    const f = fixture();
    const native = f.requestOfficial.getMockImplementation();
    if (!native) throw new Error("Missing native requester");
    const denied = { error: { code: -32000, message: "fork not authorized" } };
    f.requestOfficial.mockImplementation((method, params) =>
      method === "thread/fork" ? Promise.resolve(denied) : native(method, params),
    );
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      denied,
    );
    expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
  });

  it("does not register a native result after its owner scope changes during the Fork", async () => {
    const f = fixture();
    const native = f.requestOfficial.getMockImplementation();
    if (!native) throw new Error("Missing native requester");
    let changed = false;
    f.requestOfficial.mockImplementation(async (method, params) => {
      const response = await native(method, params);
      if (method === "thread/fork") changed = true;
      return response;
    });
    f.assertScope.mockImplementation(() => {
      if (changed) throw new Error("owner changed");
    });
    await expect(
      forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f),
    ).rejects.toThrow("owner changed");
    expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
  });

  it.each([
    { id: "native-parent", forkedFromId: "native-parent" },
    { id: "native-side", forkedFromId: "different-parent" },
    { forkedFromId: "native-parent" },
  ])("retains native success but skips unverified child metadata: %j", async (thread) => {
    const f = fixture();
    f.result.thread = thread;
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
    expect(f.diagnose).toHaveBeenCalledOnce();
  });

  it("returns a native temporary side chat instead of registering a false durable claim", async () => {
    const f = fixture();
    f.result.thread = { id: "native-side", forkedFromId: "native-parent", ephemeral: true };
    expect(await forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f)).toBe(
      f.response,
    );
    expect(f.store.registerSideChatOrigin).not.toHaveBeenCalled();
    expect(f.diagnose).toHaveBeenCalledOnce();
  });

  it("rejects mismatched source identities without a native mutation", async () => {
    const f = fixture();
    f.requestOfficial.mockResolvedValue({
      result: { thread: { id: "another-thread", historyMode: "legacy" } },
    });
    await expect(
      forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f),
    ).resolves.toMatchObject({ error: { code: -32080 } });
    expect(f.requestOfficial).toHaveBeenCalledOnce();
  });

  it("does not fork across a native owner generation change", async () => {
    const f = fixture();
    let changed = false;
    const read = f.requestOfficial.getMockImplementation();
    if (!read) throw new Error("Missing native reader");
    f.requestOfficial.mockImplementation(async (method, params) => {
      const response = await read(method, params);
      changed = true;
      return response;
    });
    f.assertScope.mockImplementation(() => {
      if (changed) throw new Error("Owner changed");
    });
    await expect(
      forkOfficialSideChat({ threadId: "native-parent", attachToSource: true }, f),
    ).rejects.toThrow("Owner changed");
    expect(f.requestOfficial).toHaveBeenCalledOnce();
  });

  it("rejects path overrides but leaves future source modes to native Fork validation", async () => {
    const pathOverride = fixture();
    await expect(
      forkOfficialSideChat(
        { threadId: "native-parent", attachToSource: true, path: "/different-thread.jsonl" },
        pathOverride,
      ),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    expect(pathOverride.requestOfficial).not.toHaveBeenCalled();
    const unknown = fixture("future-history");
    const params = { threadId: "native-parent", attachToSource: true };
    expect(await forkOfficialSideChat(params, unknown)).toBe(unknown.response);
    expect(unknown.requestOfficial.mock.calls[1]).toEqual(["thread/fork", params]);
    expect(unknown.store.registerSideChatOrigin).not.toHaveBeenCalled();
  });
});

describe("official Side Chat through Host RPC", () => {
  it.each(["legacy", "paginated"])(
    "uses the existing native owner for %s source metadata and creation",
    async (historyMode) => {
      const f = createFixture();
      const native = new JsonLineCollector(f.official.stdin);
      try {
        await f.ready;
        await enablePersistence(f);
        writeRequest(f.desktopInput, {
          id: 10,
          method: "thread/fork",
          params: {
            threadId: "native-parent",
            attachToSource: true,
            ephemeral: false,
            excludeTurns: true,
          },
        });
        const read = await native.waitFor((message) => message.method === "thread/read");
        writeRequest(f.official.stdout, {
          id: read.id ?? null,
          result: { thread: { id: "native-parent", historyMode, projectId: "native-project" } },
        });
        const fork = await native.waitFor((message) => message.method === "thread/fork");
        expect(fork.params).toMatchObject({
          threadId: "native-parent",
          attachToSource: historyMode === "paginated",
          ephemeral: false,
          excludeTurns: true,
        });
        const result = {
          thread: {
            id: "native-side",
            forkedFromId: "native-parent",
            ephemeral: false,
            historyMode,
          },
          futureNativeField: { preserved: true },
        };
        writeRequest(f.official.stdout, { id: fork.id ?? null, result });
        await expect(f.collector.waitFor((message) => requestId(message, 10))).resolves.toEqual({
          id: 10,
          result,
        });
        await vi.waitFor(async () =>
          expect(await f.mappingStore.listSideChatCollection()).toMatchObject([
            {
              threadId: "native-side",
              sourceThreadId: "native-parent",
              projectId: "native-project",
            },
          ]),
        );
        expect((await f.mappingStore.listSideChatCollection())[0]?.collectedAt).toBeUndefined();
        expect(await f.mappingStore.listThreads()).toEqual([]);
        expect(native.messages.map((message) => message.method)).toEqual([
          "thread/read",
          "thread/fork",
        ]);
      } finally {
        await stopFixture(f);
      }
    },
  );

  it("leaves ordinary native Forks unchanged and unregistered", async () => {
    const f = createFixture();
    const native = new JsonLineCollector(f.official.stdin);
    try {
      await f.ready;
      const params = { threadId: "native-parent", excludeTurns: true };
      writeRequest(f.desktopInput, { id: 11, method: "thread/fork", params });
      const fork = await native.waitFor((message) => message.method === "thread/fork");
      expect(fork.params).toEqual(params);
      writeRequest(f.official.stdout, {
        id: fork.id ?? null,
        result: { thread: { id: "ordinary-child" } },
      });
      await f.collector.waitFor((message) => requestId(message, 11));
      expect(native.messages).toHaveLength(1);
      expect(await f.mappingStore.listSideChatCollection()).toEqual([]);
    } finally {
      await stopFixture(f);
    }
  });

  it("keeps the normal native chat list usable when the side-chat index is damaged", async () => {
    const f = createFixture();
    const native = new JsonLineCollector(f.official.stdin);
    try {
      await f.ready;
      await enablePersistence(f);
      await writeFile(path.join(f.mappingStoreDirectory, "side-chat-collection.json"), "{broken");
      writeRequest(f.desktopInput, { id: 12, method: "thread/list", params: { limit: 10 } });
      const list = await native.waitFor((message) => message.method === "thread/list");
      writeRequest(f.official.stdout, {
        id: list.id ?? null,
        result: {
          data: [{ id: "native-main", createdAt: 1, updatedAt: 1 }],
          nextCursor: null,
          backwardsCursor: null,
        },
      });
      await expect(f.collector.waitFor((message) => requestId(message, 12))).resolves.toMatchObject(
        { result: { data: [{ id: "native-main" }] } },
      );
    } finally {
      await stopFixture(f);
    }
  });

  it("opens a legacy native side chat when Renderer persistence rewriting meets a damaged index", async () => {
    const f = createFixture();
    const native = new JsonLineCollector(f.official.stdin);
    try {
      await f.ready;
      await enablePersistence(f);
      await writeFile(path.join(f.mappingStoreDirectory, "side-chat-collection.json"), "{broken");
      writeRequest(f.desktopInput, {
        id: 20,
        method: "thread/fork",
        params: {
          threadId: "native-parent",
          attachToSource: true,
          ephemeral: false,
          excludeTurns: true,
        },
      });
      const read = await native.waitFor((message) => message.method === "thread/read");
      writeRequest(f.official.stdout, {
        id: read.id ?? null,
        result: {
          thread: { id: "native-parent", historyMode: "legacy" },
        },
      });
      const fork = await native.waitFor((message) => message.method === "thread/fork");
      expect(fork.params).toMatchObject({
        attachToSource: false,
        ephemeral: true,
        threadId: "native-parent",
      });
      const result = {
        thread: { id: "native-side", forkedFromId: "native-parent", ephemeral: true },
        nativeExtra: "preserved",
      };
      writeRequest(f.official.stdout, { id: fork.id ?? null, result });
      expect(await f.collector.waitFor((message) => requestId(message, 20))).toEqual({
        id: 20,
        result,
      });
      expect(native.messages.filter((message) => message.method === "thread/fork")).toHaveLength(1);
      await expect(f.mappingStore.listSideChatCollection()).rejects.toThrow();
    } finally {
      await stopFixture(f);
    }
  });
});
