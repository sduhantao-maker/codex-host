import {
  forkSession,
  getSessionInfo,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import {
  harnessIdSchema,
  nativeCheckpointRefSchema,
  nativeSessionRefSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import { forkClaudeSession } from "../src/claude-fork.js";
import { claudeForkPrefix, selectClaudeActiveForkCheckpoint } from "../src/claude-fork-boundary.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const assistantId = "33333333-3333-4333-8333-333333333333";
const resultId = "44444444-4444-4444-8444-444444444444";

function entry(
  type: "user" | "assistant",
  uuid: string,
  parentUuid: string | null,
  content: unknown,
  stopReason?: string,
): SessionStoreEntry {
  return {
    type,
    uuid,
    parentUuid,
    sessionId: sourceId,
    timestamp: "2026-10-31T00:00:00.000Z",
    cwd: "/synthetic",
    isSidechain: false,
    message: { role: type, content, ...(stopReason ? { stop_reason: stopReason } : {}) },
  };
}

const user = () => entry("user", userId, null, "Parent request");
const tool = () =>
  entry(
    "assistant",
    assistantId,
    userId,
    [{ type: "tool_use", id: "tool-1", name: "Read", input: {} }],
    "tool_use",
  );
const result = () =>
  entry("user", resultId, assistantId, [
    { type: "tool_result", tool_use_id: "tool-1", content: "Read result" },
  ]);

function fixture(messages: SessionStoreEntry[]) {
  const sessions = new Map<string, SessionStoreEntry[]>([[sourceId, structuredClone(messages)]]);
  const store: SessionStore = {
    load: async ({ sessionId }) => structuredClone(sessions.get(sessionId) ?? null),
    append: async ({ sessionId }, values) => {
      sessions.set(sessionId, [...(sessions.get(sessionId) ?? []), ...structuredClone(values)]);
    },
  };
  const dependencies = {
    getSessionInfo: async ({ sessionId }: { sessionId: string }) =>
      getSessionInfo(sessionId, { dir: "/synthetic", sessionStore: store }),
    readSessionMessages: async ({ sessionId }: { sessionId: string }) =>
      structuredClone(sessions.get(sessionId) ?? [])
        .filter((value) => value.type === "user" || value.type === "assistant")
        .map((value) => ({ ...value, session_id: sessionId })),
    forkSession: vi.fn(
      async ({
        sourceSessionId,
        checkpointId,
      }: {
        sourceSessionId: string;
        checkpointId: string;
      }) =>
        forkSession(sourceSessionId, {
          dir: "/synthetic",
          upToMessageId: checkpointId,
          sessionStore: store,
        }),
    ),
    deleteSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
      sessions.delete(sessionId);
    }),
  };
  const fork = (checkpointId: string) =>
    forkClaudeSession({
      kind: "fork",
      cwd: "/synthetic",
      dependencies,
      harnessId: harnessIdSchema.parse("claude-code"),
      sourceRef: nativeSessionRefSchema.parse({
        harnessId: "claude-code",
        nativeSessionId: sourceId,
        formatVersion: 1,
      }),
      checkpoint: nativeCheckpointRefSchema.parse({
        harnessId: "claude-code",
        nativeSessionId: sourceId,
        checkpointId,
        formatVersion: 1,
      }),
    });
  return { sessions, dependencies, fork };
}

describe("Claude active native Fork boundary", () => {
  it("uses the durable user entry while assistant output or a tool call is still incomplete", () => {
    expect(selectClaudeActiveForkCheckpoint([user()], userId)).toBe(userId);
    expect(
      selectClaudeActiveForkCheckpoint(
        [user(), entry("assistant", assistantId, userId, [{ type: "text", text: "partial" }])],
        userId,
      ),
    ).toBe(userId);
    expect(selectClaudeActiveForkCheckpoint([user(), tool()], userId)).toBe(userId);
    expect(claudeForkPrefix([user(), tool()], assistantId)).toBeNull();
  });

  it("allows a fully paired tool result and never treats an unrelated result as a checkpoint", () => {
    expect(selectClaudeActiveForkCheckpoint([user(), tool(), result()], userId)).toBe(resultId);
    expect(
      selectClaudeActiveForkCheckpoint([user(), tool(), result()], "not-persisted"),
    ).toBeNull();
    expect(() => claudeForkPrefix([user(), result()], resultId)).toThrow("matching call");
  });

  it.each(["user", "tool-result"])(
    "forks the real SDK at a %s boundary without completing or changing the source",
    async (boundary) => {
      const messages = boundary === "user" ? [user()] : [user(), tool(), result()];
      const f = fixture(messages);
      const before = structuredClone(f.sessions.get(sourceId));
      const opened = await f.fork(boundary === "user" ? userId : resultId);
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(opened.error.message);
      expect(f.sessions.get(sourceId)).toEqual(before);
      expect(opened.value.sessionId).not.toBe(sourceId);
      const derived = (f.sessions.get(opened.value.sessionId) ?? []).filter(
        (value) => value.type === "user" || value.type === "assistant",
      );
      expect(derived).toHaveLength(messages.length);
      expect(derived.every((value) => !messages.some((source) => source.uuid === value.uuid))).toBe(
        true,
      );
      expect(f.dependencies.deleteSession).not.toHaveBeenCalled();
    },
  );

  it("allows the parent to append within its current Turn after the captured prefix", async () => {
    const f = fixture([user()]);
    const nativeFork = f.dependencies.forkSession.getMockImplementation();
    if (!nativeFork) throw new Error("Missing native Fork");
    f.dependencies.forkSession.mockImplementationOnce(async (input) => {
      const forked = await nativeFork(input);
      f.sessions
        .get(sourceId)
        ?.push(
          entry("assistant", assistantId, userId, [{ type: "text", text: "parent continues" }]),
        );
      return forked;
    });
    await expect(f.fork(userId)).resolves.toMatchObject({ ok: true });
    expect(f.sessions.get(sourceId)).toHaveLength(2);
    expect(f.dependencies.deleteSession).not.toHaveBeenCalled();
  });

  it("removes only the new Fork if an already captured parent entry changes", async () => {
    const f = fixture([user()]);
    const nativeFork = f.dependencies.forkSession.getMockImplementation();
    if (!nativeFork) throw new Error("Missing native Fork");
    f.dependencies.forkSession.mockImplementationOnce(async (input) => {
      const forked = await nativeFork(input);
      f.sessions.set(sourceId, [entry("user", userId, null, "changed parent request")]);
      return forked;
    });
    await expect(f.fork(userId)).resolves.toMatchObject({
      ok: false,
      error: { code: "protocolError" },
    });
    expect(f.dependencies.deleteSession).toHaveBeenCalledOnce();
    expect(f.sessions.size).toBe(1);
    expect(f.sessions.has(sourceId)).toBe(true);
  });

  it("rejects an incomplete tool prefix before asking the SDK to create anything", async () => {
    const f = fixture([user(), tool()]);
    await expect(f.fork(assistantId)).resolves.toMatchObject({ ok: false });
    expect(f.dependencies.forkSession).not.toHaveBeenCalled();
  });
});
