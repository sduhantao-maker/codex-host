import type * as FileSystemPromises from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIDE_CHAT_FEATURES } from "@codexhost/shared-contracts";

const beforeWrite = vi.hoisted(() => vi.fn<() => Promise<void>>());
const beforeRead = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystemPromises>();
  return {
    ...original,
    async writeFile(...args: Parameters<typeof original.writeFile>) {
      await beforeWrite();
      return original.writeFile(...args);
    },
    async readFile(...args: Parameters<typeof original.readFile>) {
      const content = await original.readFile(...args);
      await beforeRead();
      return content;
    },
  };
});

import { SideChatFeaturesStore } from "../src/side-chat-features.js";

afterEach(() => {
  beforeWrite.mockReset();
  beforeRead.mockReset();
});

describe("opt-in side chat settings", () => {
  it("defaults off, merges independent switches, reloads and fails back to off", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-"));
    const changed = vi.fn();
    const diagnose = vi.fn();
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, changed, diagnose);
    try {
      await store.initialize();
      expect(store.value).toEqual(DEFAULT_SIDE_CHAT_FEATURES);
      await store.set({ persistentSideChats: true });
      await store.set({ sideChatLibrary: true });
      expect(store.value).toEqual({
        persistentSideChats: true,
        sideChatLibrary: true,
        claudeActiveSideChatFork: false,
      });
      await writeFile(store.file, JSON.stringify({ claudeActiveSideChatFork: true }));
      await vi.waitFor(() => expect(store.value.claudeActiveSideChatFork).toBe(true));
      expect(store.value.persistentSideChats).toBe(false);
      await writeFile(store.file, "broken");
      await vi.waitFor(() => expect(store.value).toEqual(DEFAULT_SIDE_CHAT_FEATURES));
      expect(diagnose).toHaveBeenCalled();
      expect(changed).toHaveBeenCalled();
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("enables only after a successful durable write", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-enable-"));
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, vi.fn(), vi.fn());
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    beforeWrite.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    const enabling = store.set({ persistentSideChats: true });
    try {
      await entered.promise;
      expect(store.value.persistentSideChats).toBe(false);
      release.resolve(undefined);
      await enabling;
      expect(store.value.persistentSideChats).toBe(true);
    } finally {
      release.resolve(undefined);
      await enabling;
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("disables synchronously and releases persistence waiters while its settings write is stalled", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-disable-"));
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, vi.fn(), vi.fn());
    await store.set({ persistentSideChats: true });
    const pendingInjection = Promise.withResolvers<undefined>();
    const waiting = store.waitForPersistence(pendingInjection.promise);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    beforeWrite.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    const disabling = store.set({ persistentSideChats: false });
    try {
      expect(store.value.persistentSideChats).toBe(false);
      await waiting;
      await entered.promise;
      const persisted = vi.fn();
      void disabling.then(persisted);
      await Promise.resolve(undefined);
      expect(persisted).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      pendingInjection.resolve(undefined);
      await disabling;
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not let an older pending enable overwrite a newer disable of the same switch", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-revision-"));
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, vi.fn(), vi.fn());
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    beforeWrite.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    const enabling = store.set({ persistentSideChats: true, claudeActiveSideChatFork: true });
    let disabling: Promise<unknown> | undefined;
    try {
      await entered.promise;
      disabling = store.set({ persistentSideChats: false });
      expect(store.value.persistentSideChats).toBe(false);
      release.resolve(undefined);
      await enabling;
      expect(store.value).toEqual({
        persistentSideChats: false,
        sideChatLibrary: false,
        claudeActiveSideChatFork: true,
      });
      await disabling;
      expect(JSON.parse(await readFile(store.file, "utf8"))).toEqual(store.value);
    } finally {
      release.resolve(undefined);
      await enabling;
      await disabling;
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not restore an obsolete enabled value from an in-flight reload after hot disable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-reload-"));
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, vi.fn(), vi.fn());
    await store.set({ persistentSideChats: true });
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    beforeRead.mockImplementationOnce(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    const reloading = store.reload();
    let disabling: Promise<unknown> | undefined;
    try {
      await entered.promise;
      disabling = store.set({ persistentSideChats: false });
      release.resolve(undefined);
      await reloading;
      expect(store.value.persistentSideChats).toBe(false);
    } finally {
      release.resolve(undefined);
      await reloading;
      await disabling;
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a hot disable effective when its settings cannot be saved", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sidechat-features-write-failure-"));
    const diagnose = vi.fn();
    const store = new SideChatFeaturesStore({ CODEXHOST_DATA_DIR: directory }, vi.fn(), diagnose);
    try {
      await store.set({ persistentSideChats: true, sideChatLibrary: true });
      const pendingInjection = Promise.withResolvers<undefined>();
      const waiting = store.waitForPersistence(pendingInjection.promise);
      beforeWrite.mockRejectedValueOnce(new Error("disk unavailable"));
      const disabling = store.set({ persistentSideChats: false });
      expect(store.value.persistentSideChats).toBe(false);
      await waiting;
      await expect(disabling).rejects.toThrow("disk unavailable");
      expect(store.value).toEqual(DEFAULT_SIDE_CHAT_FEATURES);
      expect(diagnose).toHaveBeenCalled();
      await store.reload();
      expect(store.value.persistentSideChats).toBe(false);
      pendingInjection.resolve(undefined);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
