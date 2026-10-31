import { describe, expect, it } from "vitest";
import { decodeThreadForkRequest, decodeThreadListRequest } from "../src/index.js";
import type { JsonObject } from "../src/index.js";

describe("persistent side chat protocol", () => {
  it("retains the native attachment flag instead of silently discarding it", () => {
    expect(
      decodeThreadForkRequest({
        id: 1,
        method: "thread/fork",
        params: { threadId: "parent", attachToSource: true, excludeTurns: true },
      }),
    ).toMatchObject({ threadId: "parent", attachToSource: true, excludeTurns: true });
    expect(() =>
      decodeThreadForkRequest({
        id: 2,
        method: "thread/fork",
        params: { threadId: "parent", attachToSource: "yes" },
      }),
    ).toThrow("attachToSource");
    expect(() =>
      decodeThreadForkRequest({
        id: 3,
        method: "thread/fork",
        params: { threadId: "parent", attachToSource: true, ephemeral: true },
      }),
    ).toThrow("cannot combine");
  });

  it("includes attached external chats in native parent-scoped listing", () => {
    const decode = (params: JsonObject) =>
      decodeThreadListRequest({ id: 1, method: "thread/list", params });
    const first = decode({ attachedToThreadId: "parent", useStateDbOnly: true });
    expect(first).toMatchObject({ attachedToThreadId: "parent", supportsExternal: true });
    expect(
      decode({ attachedToThreadId: "other", useStateDbOnly: true })?.queryFingerprint,
    ).not.toBe(first?.queryFingerprint);
    expect(decode({ attachedToThreadId: null })).toMatchObject({ attachedToThreadId: null });
    expect(decode({})?.attachedToThreadId).toBeUndefined();
    expect(() => decode({ attachedToThreadId: 42 })).toThrow("attachedToThreadId");
    expect(() => decode({ attachedToThreadId: "parent", parentThreadId: "parent" })).toThrow(
      "cannot combine",
    );
  });
});
