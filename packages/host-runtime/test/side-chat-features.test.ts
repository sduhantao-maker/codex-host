import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SIDE_CHAT_FEATURES } from "@codexhost/shared-contracts";
import { SideChatFeaturesStore } from "../src/side-chat-features.js";

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
});
