import { describe, expect, it, vi } from "vitest";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { createSideChatLibrary } from "../src/renderer-sidechat-library.js";

const side = {
  threadId: hostThreadIdSchema.parse("side-1"),
  sourceThreadId: hostThreadIdSchema.parse("parent-1"),
  projectId: "project-1",
  title: "子聊",
  collected: false,
};

describe("side chat library ownership", () => {
  it("lists children of the requested parent without submitting a turn or parent context", async () => {
    const request = vi.fn(async () => ({ items: [side] }));
    expect(await createSideChatLibrary(request).list("parent-1")).toEqual([side]);
    expect(request.mock.calls).toEqual([
      ["codexhost/sideChat/list", { sourceThreadId: "parent-1" }],
    ]);
  });

  it("lists only collected entries for the global folder", async () => {
    const request = vi.fn(async () => ({ items: [{ ...side, collected: true }] }));
    await createSideChatLibrary(request).list();
    expect(request).toHaveBeenCalledExactlyOnceWith("codexhost/sideChat/list", { collected: true });
  });

  it("changes only the child collection metadata", async () => {
    const request = vi.fn(async () => ({ item: { ...side, collected: true } }));
    expect(await createSideChatLibrary(request).collect("side-1", true)).toMatchObject({
      collected: true,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("codexhost/sideChat/update", {
      threadId: "side-1",
      collected: true,
    });
  });

  it.each([true, false])(
    "preserves collection and origin before native archive=%s, then synchronizes only child metadata",
    async (archived) => {
      const request = vi.fn(async (method: string) =>
        method === "codexhost/sideChat/update"
          ? { item: { ...side, archived, collected: false } }
          : {},
      );
      expect(await createSideChatLibrary(request).setArchived(side, archived)).toEqual({
        collectionUpdated: true,
      });
      expect(request.mock.calls).toEqual([
        ["codexhost/sideChat/update", { threadId: "side-1", collected: false }],
        [archived ? "thread/archive" : "thread/unarchive", { threadId: "side-1" }],
        ["codexhost/sideChat/update", { threadId: "side-1", collected: false, archived }],
      ]);
    },
  );

  it("preserves collection state when the native archive is rejected", async () => {
    const entry = { ...side, collected: true };
    const request = vi.fn(async (method: string) =>
      method === "codexhost/sideChat/update"
        ? { item: entry }
        : { error: { message: "archive rejected" } },
    );
    await expect(createSideChatLibrary(request).setArchived(entry, true)).rejects.toThrow(
      "archive rejected",
    );
    expect(request.mock.calls).toEqual([
      ["codexhost/sideChat/update", { threadId: "side-1", collected: true }],
      ["thread/archive", { threadId: "side-1" }],
    ]);
  });

  it("reports native success separately when collection synchronization fails", async () => {
    let updates = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "codexhost/sideChat/update") {
        if (++updates === 2) throw new Error("metadata unavailable");
        return { item: side };
      }
      return {};
    });
    expect(await createSideChatLibrary(request).setArchived(side, true)).toEqual({
      collectionUpdated: false,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps native archive available when origin registration fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "codexhost/sideChat/update") throw new Error("index unavailable");
      return {};
    });
    expect(await createSideChatLibrary(request).setArchived(side, true)).toEqual({
      collectionUpdated: false,
    });
    expect(request.mock.calls).toEqual([
      ["codexhost/sideChat/update", { threadId: "side-1", collected: false }],
      ["thread/archive", { threadId: "side-1" }],
    ]);
  });

  it.each([
    { items: [{ ...side, sourceThreadId: "other-parent" }] },
    { items: [{ ...side, sourceThreadId: "side-1" }] },
    { items: [side, side] },
    { items: [{ ...side, projectId: undefined }] },
  ])("rejects crossed, duplicate, or unproven identities", async ({ items }) => {
    await expect(createSideChatLibrary(async () => ({ items })).list("parent-1")).rejects.toThrow();
  });

  it("does not report success when the server kept the previous state", async () => {
    await expect(
      createSideChatLibrary(async () => ({ item: side })).collect("side-1", true),
    ).rejects.toThrow("未确认");
  });

  it("keeps backend errors visible", async () => {
    await expect(
      createSideChatLibrary(async () => ({ error: { message: "offline" } })).list(),
    ).rejects.toThrow("offline");
  });

  it("resolves names through read-only identity-checked requests", async () => {
    const request = vi.fn(async (method: string) =>
      method === "thread/read"
        ? { thread: { id: "parent-1", name: "主聊" } }
        : { project: { id: "project-1", name: "项目" } },
    );
    const client = createSideChatLibrary(request);
    expect(await client.sourceTitle("parent-1")).toBe("主聊");
    expect(await client.projectName("project-1")).toBe("项目");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/read", "project/read"]);
  });
});
