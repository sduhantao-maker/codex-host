import { sideChatLibraryItemSchema } from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";
import { sideChatMenuIcon } from "../src/renderer-sidechat-icons.js";
import {
  SIDE_CHAT_OWNERSHIP_METHOD,
  createSideChatLibrary,
} from "../src/renderer-sidechat-library.js";
import { THREAD_OWNERSHIP_LIST_METHOD } from "../src/renderer-model-client.js";
import {
  disclosureStates,
  sideChatRelativeTime,
  sideChatTitle,
  sideChatTitles,
  stripNativeBindings,
} from "../src/renderer-sidechat-sidebar-style.js";

const entry = sideChatLibraryItemSchema.parse({
  threadId: "child",
  sourceThreadId: "parent",
  projectId: null,
  title: "Side chat",
  collected: true,
});

function fakeElement(values: Record<string, string>) {
  const attributes = new Map(Object.entries(values));
  const element = {
    get attributes() {
      return [...attributes.keys()].map((name) => ({ name }));
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    querySelectorAll: () => [],
  } as unknown as Element;
  return { attributes, element };
}

describe("native sidebar replicas", () => {
  it("keeps the captured CSS and strips native ownership, navigation and accessible associations", () => {
    const { attributes, element } = fakeElement({
      class: "native-row text-native",
      style: "height: 30px",
      role: "group",
      id: "native-id",
      "data-app-action-sidebar-thread-row": "",
      "data-thread-title": "",
      "aria-controls": "native-panel",
      "aria-labelledby": "native-label",
      "aria-label": "Native title",
      href: "/local/native-thread",
      onclick: "nativeAction()",
      tabindex: "0",
      title: "Old text",
    });
    stripNativeBindings(element);
    expect(Object.fromEntries(attributes)).toEqual({
      class: "native-row text-native",
      style: "height: 30px",
      role: "group",
    });
  });

  it("keeps only the requested presentation attributes of a native button", () => {
    const { attributes, element } = fakeElement({
      class: "Button-q1uiwE",
      "data-size": "3xs",
      "data-color": "secondary",
      "data-state": "closed",
      "aria-label": "置顶聊天",
    });
    stripNativeBindings(element, new Set(["data-size", "data-color"]));
    expect(Object.fromEntries(attributes)).toEqual({
      class: "Button-q1uiwE",
      "data-size": "3xs",
      "data-color": "secondary",
    });
  });

  it("uses the name, child prompt or source title without inventing a time title", () => {
    expect(sideChatTitle({ ...entry, title: "命名", preview: "Child" }, "主对话")).toBe("命名");
    expect(sideChatTitle({ ...entry, preview: "第一句\n 第二行" }, "主对话")).toBe("第一句 第二行");
    expect(sideChatTitle(entry, "原主对话")).toBe("侧边聊天 · 原主对话");
    expect(sideChatTitle({ ...entry, updatedAt: 1000 })).toBe("侧边聊天");
  });

  it("numbers only fallback titles that would read the same", () => {
    const rows = [
      { ...entry, threadId: "b", sourceThreadId: "p1" },
      { ...entry, threadId: "a", sourceThreadId: "p1" },
      { ...entry, threadId: "c", sourceThreadId: "p2" },
      { ...entry, threadId: "d", sourceThreadId: "p1", preview: "单独的问题" },
      { ...entry, threadId: "e", sourceThreadId: "p3" },
      { ...entry, threadId: "f", sourceThreadId: "p4" },
    ].map((row) => sideChatLibraryItemSchema.parse(row));
    const titles = sideChatTitles(
      rows,
      new Map([
        ["p1", "第三章论文写作"],
        ["p2", "另一个主对话"],
      ]),
    );
    expect(Object.fromEntries(titles)).toEqual({
      a: "侧边聊天 1 · 第三章论文写作",
      b: "侧边聊天 2 · 第三章论文写作",
      c: "侧边聊天 · 另一个主对话",
      d: "单独的问题",
      e: "侧边聊天 1",
      f: "侧边聊天 2",
    });
  });

  it("formats the native short relative time", () => {
    expect(sideChatRelativeTime(1000, "zh-CN", 1120000)).toBe("2 分钟前");
    expect(sideChatRelativeTime(1000, "en-US", 1120000)).toBe("2m");
  });
});

describe("native disclosure chevron", () => {
  const collapsed = ["icon-disclosure", "transition-transform", "opacity-100", "-rotate-90"];
  const expanded = ["icon-disclosure", "transition-transform", "opacity-0", "rotate-0"];

  it("learns the state classes from collapsed and expanded native sections", () => {
    expect(disclosureStates({ collapsed, expanded })).toEqual({
      collapsed: ["opacity-100", "-rotate-90"],
      expanded: ["opacity-0", "rotate-0"],
    });
  });

  it("uses the 26.1029 classes only when the one visible state carries them", () => {
    expect(disclosureStates({ collapsed })).toEqual({
      collapsed: ["opacity-100", "-rotate-90"],
      expanded: ["opacity-0", "rotate-0"],
    });
    expect(disclosureStates({ expanded })).not.toBeNull();
    expect(disclosureStates({ collapsed: ["icon-disclosure", "rotate-180"] })).toBeNull();
    expect(disclosureStates({})).toBeNull();
  });
});

describe("native menu artwork", () => {
  const markup = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));

  it("encodes icons as Desktop's SVG data URLs for the native menu", () => {
    const pin = sideChatMenuIcon("menuPin");
    expect(pin.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(markup(pin)).toMatch(/^<svg [^>]*width="20" height="20" viewBox="0 0 20 20"/u);
    expect(markup(pin)).toContain('fill="currentColor"');
  });

  it("insets 16-unit glyphs like the 20-unit menu icons", () => {
    expect(markup(sideChatMenuIcon("source"))).toContain('viewBox="-2 -2 20 20"');
  });
});

describe("side chat agents", () => {
  it("reads agents through the sidebar ownership method", async () => {
    expect(SIDE_CHAT_OWNERSHIP_METHOD).toBe(THREAD_OWNERSHIP_LIST_METHOD);
    const calls: unknown[] = [];
    const library = createSideChatLibrary(async (method, params) => {
      calls.push({ method, params });
      return {
        result: {
          threads: [
            { threadId: "019a0000-0000-7000-8000-000000000001", owner: "codex" },
            {
              threadId: "3d28d33e-0000-4000-8000-000000000002",
              owner: "external",
              harnessId: "claude-code",
            },
          ],
        },
      };
    });
    const agents = await library.agents([
      "019a0000-0000-7000-8000-000000000001",
      "3d28d33e-0000-4000-8000-000000000002",
      "019a0000-0000-7000-8000-000000000001",
    ]);
    expect(Object.fromEntries(agents)).toEqual({
      "019a0000-0000-7000-8000-000000000001": "codex",
      "3d28d33e-0000-4000-8000-000000000002": "claude-code",
    });
    expect(calls).toEqual([
      {
        method: THREAD_OWNERSHIP_LIST_METHOD,
        params: {
          threadIds: [
            "019a0000-0000-7000-8000-000000000001",
            "3d28d33e-0000-4000-8000-000000000002",
          ],
        },
      },
    ]);
  });
});
