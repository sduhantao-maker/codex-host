import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MappingStore } from "@codexhost/mapping-store";
import type { JsonObject } from "@codexhost/protocol-core";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SideChatLibrary } from "../src/side-chat-library.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codexhost-sidechat-library-"));
  const store = new MappingStore({ directory });
  await store.initialize();
  cleanup.push(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const rows = new Map<string, JsonObject>([
    ["parent", { id: "parent", projectId: "project-a", name: "Parent" }],
    ["native", { id: "native", forkedFromId: "parent", name: "Native side" }],
    [
      "external",
      {
        id: "external",
        modelProvider: "codexhost",
        forkedFromId: "parent",
        name: "Claude side",
        codexhostSideChatOrigin: { threadId: "parent", projectId: "project-a" },
      },
    ],
    ["ordinary-fork", { id: "ordinary-fork", forkedFromId: "parent", name: "Not a side chat" }],
  ]);
  const attached = new Map<string, string[]>([["parent", ["native", "external"]]]);
  const readThread = vi.fn(async (threadId: string) => rows.get(threadId) ?? null);
  const listAttached = vi.fn(async (threadId: string) =>
    (attached.get(threadId) ?? []).map((id) => ({ id })),
  );
  const library = new SideChatLibrary({
    store,
    readThread,
    listAttached,
    now: () => new Date("2026-10-31T01:00:00Z"),
  });
  return { directory, store, rows, attached, readThread, listAttached, library };
}
const id = (value: string) => hostThreadIdSchema.parse(value);

describe("side chat library", () => {
  it("rejects a mixed-account read before returning titles or changing collection state", async () => {
    const { library, store, rows, readThread } = await fixture();
    await library.update({ threadId: id("native"), collected: true });
    const before = await store.listSideChatCollection();
    let changed = false;
    const assertScope = () => {
      if (changed) throw new Error("account changed");
    };
    readThread.mockImplementation(async (threadId) => {
      if (threadId === "native") changed = true;
      return rows.get(threadId) ?? null;
    });
    await expect(library.list({}, assertScope)).rejects.toThrow("account changed");
    changed = false;
    await expect(
      library.update({ threadId: id("native"), collected: false }, assertScope),
    ).rejects.toThrow("account changed");
    expect(await store.listSideChatCollection()).toEqual(before);
  });

  it("lists attached sides and manually collects only metadata, never chat content", async () => {
    const { library, store, directory, listAttached, rows } = await fixture();
    expect(
      (await library.list({ sourceThreadId: id("parent") })).items.map((item) => item.threadId),
    ).toEqual(["native", "external"]);
    expect(listAttached).toHaveBeenCalledTimes(1);
    expect(await library.list()).toEqual({ items: [] });
    const before = JSON.stringify([...rows]);
    await library.update({ threadId: id("native"), collected: true });
    await library.update({ threadId: id("external"), collected: true });
    expect((await library.list()).items.map((item) => item.title)).toEqual([
      "Native side",
      "Claude side",
    ]);
    const index = await readFile(path.join(directory, "side-chat-collection.json"), "utf8");
    expect(index).not.toContain("Native side");
    expect(index).not.toContain("Claude side");
    await library.update({ threadId: id("native"), collected: false });
    expect(
      (await library.list({ sourceThreadId: id("parent"), collected: false })).items.map(
        (item) => item.threadId,
      ),
    ).toEqual(["native"]);
    expect(JSON.stringify([...rows])).toBe(before);
    expect(await store.listThreads()).toEqual([]);
  });

  it("rejects ordinary forks and spoofed source or thread identities", async () => {
    const { library, rows, attached, store } = await fixture();
    await expect(
      library.update({ threadId: id("ordinary-fork"), collected: true }),
    ).rejects.toThrow("unavailable");
    rows.set("native", { id: "another-id", forkedFromId: "parent", name: "secret" });
    await expect(library.update({ threadId: id("native"), collected: true })).rejects.toThrow(
      "unavailable",
    );
    rows.set("native", { id: "native", forkedFromId: "other-parent", name: "secret" });
    attached.set("parent", ["native"]);
    expect(await library.list({ sourceThreadId: id("parent") })).toEqual({ items: [] });
    rows.set("external", {
      id: "external",
      forkedFromId: "other-parent",
      codexhostSideChatOrigin: { threadId: "parent" },
    });
    await expect(library.update({ threadId: id("external"), collected: true })).rejects.toThrow(
      "unavailable",
    );
    expect(await store.listSideChatCollection()).toEqual([]);
  });

  it("uses current source project and title while retaining stable links", async () => {
    const { library, rows, store } = await fixture();
    await library.update({ threadId: id("external"), collected: true });
    rows.set("parent", { id: "parent", projectId: "project-moved", name: "Renamed parent" });
    rows.set("external", { ...rows.get("external"), id: "external", name: "Renamed side" });
    expect(await library.list()).toEqual({
      items: [
        {
          threadId: "external",
          sourceThreadId: "parent",
          projectId: "project-moved",
          title: "Renamed side",
          collected: true,
        },
      ],
    });
    const before = await store.listSideChatCollection();
    rows.delete("parent");
    expect(await library.list()).toMatchObject({
      items: [
        { threadId: "external", title: "Renamed side", sourceAvailable: false, projectId: null },
      ],
    });
    expect(await store.listSideChatCollection()).toEqual(before);
    await expect(
      library.update({ threadId: id("external"), collected: false }),
    ).resolves.toMatchObject({ item: { sourceAvailable: false, collected: false } });
    expect(await store.listSideChatCollection()).toMatchObject([
      { threadId: "external", sourceThreadId: "parent", registeredAt: "2026-10-31T01:00:00.000Z" },
    ]);
    expect((await store.listSideChatCollection())[0]?.collectedAt).toBeUndefined();
  });

  it("keeps external side-chat provenance when its fork checkpoint changes", async () => {
    const { library, rows } = await fixture();
    rows.set("external", {
      ...rows.get("external"),
      id: "external",
      forkedFromId: "replacement-source",
    });
    const { item } = await library.update({ threadId: id("external"), collected: true });
    expect(item).toMatchObject({
      threadId: "external",
      sourceThreadId: "parent",
      projectId: "project-a",
    });
    expect((await library.list()).items).toEqual([item]);
  });

  it.each(["native", "external"])(
    "retains %s side-chat origin through archive, restart, and restore",
    async (threadId) => {
      const { library, rows, attached, store, directory, readThread, listAttached } =
        await fixture();
      await library.update({ threadId: id(threadId), collected: true });
      const [original] = await store.listSideChatCollection();
      attached.set(
        "parent",
        ["native", "external"].filter((value) => value !== threadId),
      );
      if (threadId === "external")
        rows.set(threadId, { ...rows.get(threadId), id: threadId, codexhostArchived: true });
      const nativeState = JSON.stringify([...rows]);
      expect(
        await library.update({ threadId: id(threadId), collected: false, archived: true }),
      ).toMatchObject({
        item: { threadId, sourceThreadId: "parent", projectId: "project-a", archived: true },
      });
      expect(await library.list()).toEqual({ items: [] });
      const [saved] = await store.listSideChatCollection();
      expect(saved).toEqual({
        threadId,
        sourceThreadId: "parent",
        projectId: "project-a",
        registeredAt: original?.registeredAt,
        archived: true,
      });
      expect(JSON.stringify([...rows])).toBe(nativeState);

      await store.close();
      const restarted = new MappingStore({ directory });
      await restarted.initialize();
      cleanup.push(() => restarted.close());
      const restored = new SideChatLibrary({ store: restarted, readThread, listAttached });
      expect((await restored.list({ sourceThreadId: id("parent") })).items).toContainEqual(
        expect.objectContaining({ threadId, sourceThreadId: "parent", archived: true }),
      );
      rows.delete("parent");
      expect((await restored.list({ sourceThreadId: id("parent") })).items).toContainEqual(
        expect.objectContaining({ threadId, sourceThreadId: "parent", sourceAvailable: false }),
      );
      expect(await restarted.listSideChatCollection()).toEqual([saved]);

      rows.set("parent", { id: "parent", projectId: "project-a" });
      attached.set("parent", ["native", "external"]);
      if (threadId === "external")
        rows.set(threadId, { ...rows.get(threadId), id: threadId, codexhostArchived: false });
      await restored.update({ threadId: id(threadId), collected: false, archived: false });
      await restored.update({ threadId: id(threadId), collected: true });
      expect((await restored.list()).items).toContainEqual(
        expect.objectContaining({ threadId, sourceThreadId: "parent", collected: true }),
      );
      expect(await restarted.listSideChatCollection()).toMatchObject([
        {
          threadId,
          sourceThreadId: "parent",
          registeredAt: original?.registeredAt,
          archived: false,
        },
      ]);
    },
  );

  it("registers an uncollected native side before archive removes its only attachment", async () => {
    const { library, store, attached } = await fixture();
    expect(await store.listSideChatCollection()).toEqual([]);
    const entry = (await library.list({ sourceThreadId: id("parent") })).items.find(
      (item) => item.threadId === "native",
    );
    expect(entry).toMatchObject({ threadId: "native", collected: false });
    await library.update({ threadId: id("native"), collected: false });
    attached.set("parent", ["external"]);
    await library.update({ threadId: id("native"), collected: false, archived: true });
    expect((await library.list({ sourceThreadId: id("parent") })).items).toContainEqual(
      expect.objectContaining({ threadId: "native", sourceThreadId: "parent", archived: true }),
    );
    expect(await store.listSideChatCollection()).toMatchObject([
      { threadId: "native", sourceThreadId: "parent", projectId: "project-a", archived: true },
    ]);
  });

  it("uses restored native attachments consistently in parent and global views", async () => {
    const { library, store, attached } = await fixture();
    await library.update({ threadId: id("native"), collected: true, archived: true });
    attached.set("parent", ["external"]);
    expect(await library.list()).toEqual({ items: [] });
    attached.set("parent", ["native", "external"]);
    for (const query of [{}, { sourceThreadId: id("parent") }]) {
      const item = (await library.list(query)).items.find((entry) => entry.threadId === "native");
      expect(item).toMatchObject({ threadId: "native", collected: true });
      expect(item?.archived).toBeUndefined();
    }
    await library.update({ threadId: id("native"), collected: true });
    expect((await store.listSideChatCollection())[0]?.archived).toBe(false);
  });

  it("uses external native archive state over stale collection hints", async () => {
    const { library, store, rows, attached } = await fixture();
    await library.update({ threadId: id("external"), collected: true, archived: true });
    attached.set("parent", ["native"]);
    rows.set("external", { ...rows.get("external"), id: "external", codexhostArchived: false });
    expect((await library.list()).items).toContainEqual(
      expect.objectContaining({ threadId: "external", collected: true }),
    );
    await library.update({ threadId: id("external"), collected: true });
    expect((await store.listSideChatCollection())[0]?.archived).toBe(false);
    rows.set("external", { ...rows.get("external"), id: "external", codexhostArchived: true });
    expect(await library.list()).toEqual({ items: [] });
    expect((await library.list({ sourceThreadId: id("parent") })).items).toContainEqual(
      expect.objectContaining({ threadId: "external", archived: true }),
    );
  });

  it("omits unreadable collected entries without deleting their index", async () => {
    const { library, store, rows, readThread } = await fixture();
    await library.update({ threadId: id("native"), collected: true });
    const before = await store.listSideChatCollection();
    rows.delete("native");
    expect(await library.list()).toEqual({ items: [] });
    readThread.mockRejectedValue(new Error("Wrong account"));
    expect(await library.list()).toEqual({ items: [] });
    expect(await store.listSideChatCollection()).toEqual(before);
  });

  it("recovers uncollected legacy native side chats from their registered origin after restart", async () => {
    const { store, directory, rows, attached, readThread, listAttached } = await fixture();
    attached.set("parent", []);
    await store.registerSideChatOrigin({
      threadId: id("native"),
      sourceThreadId: id("parent"),
      projectId: "project-a",
      registeredAt: "2026-10-31T00:00:00Z",
    });
    await store.close();
    const restarted = new MappingStore({ directory });
    await restarted.initialize();
    cleanup.push(() => restarted.close());
    const library = new SideChatLibrary({ store: restarted, readThread, listAttached });
    expect(await library.list()).toEqual({ items: [] });
    expect((await library.list({ sourceThreadId: id("parent") })).items).toMatchObject([
      { threadId: "native", collected: false, sourceThreadId: "parent" },
    ]);
    await library.update({ threadId: id("native"), collected: true });
    expect((await library.list()).items).toHaveLength(1);
    await library.update({ threadId: id("native"), collected: false });
    expect(await library.list()).toEqual({ items: [] });
    expect((await library.list({ sourceThreadId: id("parent") })).items).toHaveLength(1);
    rows.delete("parent");
    expect((await library.list({ sourceThreadId: id("parent") })).items).toMatchObject([
      { threadId: "native", sourceAvailable: false, projectId: null },
    ]);
    rows.delete("native");
    expect(await library.list({ sourceThreadId: id("parent") })).toEqual({ items: [] });
    expect(await restarted.listSideChatCollection()).toHaveLength(1);
  });
});
