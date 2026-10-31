import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  hostThreadIdSchema,
  harnessIdSchema,
  nativeSessionRefSchema,
} from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MappingStore, type StoredSideChatCollectionEntry } from "../src/index.js";

const directories: string[] = [];
const stores: MappingStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function open(directory?: string) {
  const root =
    directory ?? (await mkdtemp(path.join(os.tmpdir(), "codexhost-sidechat-collection-")));
  if (!directory) directories.push(root);
  const store = new MappingStore({ directory: root });
  stores.push(store);
  await store.initialize();
  return { store, directory: root };
}
function entry(id: string): StoredSideChatCollectionEntry {
  return {
    threadId: hostThreadIdSchema.parse(id),
    sourceThreadId: hostThreadIdSchema.parse("parent"),
    projectId: "project",
    collectedAt: "2026-10-31T00:00:00.000Z",
  };
}

describe("side chat collection storage", () => {
  it("retains registered origins when uncollecting and rejects reparenting", async () => {
    const { store, directory } = await open();
    const original = { ...entry("legacy-side"), registeredAt: "2026-10-31T00:00:00.000Z" };
    await store.registerSideChatOrigin(original);
    expect((await store.listSideChatCollection())[0]?.collectedAt).toBeUndefined();
    await store.setSideChatCollected(original.threadId, original);
    await store.setSideChatCollected(original.threadId, null);
    expect(await store.listSideChatCollection()).toEqual([
      {
        threadId: original.threadId,
        sourceThreadId: original.sourceThreadId,
        projectId: original.projectId,
        registeredAt: original.registeredAt,
      },
    ]);
    await expect(
      store.registerSideChatOrigin({
        ...original,
        sourceThreadId: hostThreadIdSchema.parse("other-parent"),
      }),
    ).rejects.toMatchObject({ code: "MAPPING_CONFLICT" });
    await store.close();
    const restarted = await open(directory);
    expect((await restarted.store.listSideChatCollection())[0]?.registeredAt).toBe(
      original.registeredAt,
    );
    expect(await restarted.store.listThreads()).toEqual([]);
  });
  it("restores native and external entries without changing or deleting their threads", async () => {
    const first = await open();
    const external = entry("external");
    const harnessId = harnessIdSchema.parse("claude-code");
    await first.store.createProvisional({
      hostThreadId: external.threadId,
      createRequestId: "create",
      harnessId,
      cwd: "/synthetic",
      transportModelId: "codexhost/claude-code",
      ephemeral: false,
      historyMode: "legacy",
    });
    await first.store.commitReady({
      hostThreadId: external.threadId,
      nativeSessionRef: nativeSessionRefSchema.parse({
        harnessId,
        nativeSessionId: "native-external",
        locator: {},
        formatVersion: 1,
      }),
    });
    const before = await first.store.getThread(external.threadId);
    await first.store.setSideChatCollected(external.threadId, external);
    await first.store.setSideChatCollected(
      entry("official-native").threadId,
      entry("official-native"),
    );
    await expect(first.store.getThread(external.threadId)).resolves.toEqual(before);
    await first.store.close();
    const second = await open(first.directory);
    expect(await second.store.listSideChatCollection()).toEqual([
      external,
      entry("official-native"),
    ]);
    await second.store.setSideChatCollected(external.threadId, null);
    await expect(second.store.getThread(external.threadId)).resolves.toEqual(before);
    expect(await second.store.listSideChatCollection()).toEqual([entry("official-native")]);
  });

  it("serializes concurrent updates under the existing store lock", async () => {
    const { store, directory } = await open();
    const second = new MappingStore({ directory });
    await expect(second.initialize()).rejects.toMatchObject({ code: "STORE_LOCKED" });
    const entries = Array.from({ length: 20 }, (_, i) => entry(`side-${i}`));
    await Promise.all(entries.map((item) => store.setSideChatCollected(item.threadId, item)));
    expect(await store.listSideChatCollection()).toEqual(entries);
    const disk = JSON.parse(
      await readFile(path.join(directory, "side-chat-collection.json"), "utf8"),
    );
    expect(disk.entries).toEqual(entries);
  });

  it("preserves unknown fields in the current format", async () => {
    const { store, directory } = await open();
    const file = path.join(directory, "side-chat-collection.json");
    await writeFile(
      file,
      JSON.stringify({
        formatVersion: 1,
        futureFileField: ["opaque"],
        entries: [{ ...entry("side"), futureEntryField: { value: 1 } }],
      }),
    );
    await store.setSideChatCollected(entry("side").threadId, {
      ...entry("side"),
      projectId: "moved",
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      formatVersion: 1,
      futureFileField: ["opaque"],
      entries: [{ ...entry("side"), projectId: "moved", futureEntryField: { value: 1 } }],
    });
  });

  it.each(["{invalid", JSON.stringify({ formatVersion: 2, entries: [] })])(
    "does not overwrite unreadable or future collection metadata",
    async (contents) => {
      const { store, directory } = await open();
      const file = path.join(directory, "side-chat-collection.json");
      await writeFile(file, contents);
      await expect(store.listSideChatCollection()).rejects.toThrow();
      await expect(
        store.setSideChatCollected(entry("side").threadId, entry("side")),
      ).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(contents);
      expect(await store.listThreads()).toEqual([]);
    },
  );
});
