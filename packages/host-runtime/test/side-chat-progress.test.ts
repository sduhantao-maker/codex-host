import { FakeHarnessAdapter } from "@codexhost/harness-adapter/testing";
import { CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID, type JsonObject } from "@codexhost/protocol-core";
import { harnessIdSchema, hostThreadIdSchema, hostTurnIdSchema } from "@codexhost/shared-contracts";
import { expect, it, vi } from "vitest";
import {
  createFixture,
  requestId,
  startExternalThread,
  startPiTurn,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

function rpc(
  fixture: ReturnType<typeof createFixture>,
  id: number,
  method: string,
  params: JsonObject,
): Promise<JsonObject> {
  writeRequest(fixture.desktopInput, { id, method, params });
  return fixture.collector.waitFor((message) => requestId(message, id));
}

async function newClaudeFork(persistentSideChats: boolean, nativeSideChat: boolean) {
  const claude = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  const fixture = createFixture({
    externalAdapters: new Map([["claude-code", claude]]),
    sideChatFeatures: { persistentSideChats },
  });
  try {
    const parentId = await startExternalThread(fixture, CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID);
    const parent = claude.sessions[0];
    if (!parent) throw new Error("Missing synthetic parent Session");
    const parentTurn = await startPiTurn(fixture, parentId, 2);
    parent.appendText("synthetic parent answer");
    parent.succeedTurn();
    await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", parentTurn));
    const fork = await rpc(fixture, 3, "thread/fork", {
      threadId: parentId,
      ...(nativeSideChat
        ? { excludeTurns: true, threadSource: "user", ephemeral: false, attachToSource: true }
        : {}),
    });
    expect(fork.error).toBeUndefined();
    const threadId = hostThreadIdSchema.parse(
      ((fork.result as JsonObject).thread as JsonObject).id,
    );
    const child = claude.sessions[1];
    if (!child) throw new Error("Missing synthetic child Session");
    return { fixture, parentId, threadId, child };
  } catch (error) {
    await stopFixture(fixture);
    throw error;
  }
}

it("logs external Turn milestones with IDs and timing only", async () => {
  const fixture = createFixture();
  const diagnostics: string[] = [];
  fixture.diagnosticOutput.on("data", (chunk) => diagnostics.push(String(chunk)));
  try {
    const threadId = await startExternalThread(fixture, "codexhost/pi-native");
    writeRequest(fixture.desktopInput, {
      id: 2,
      method: "turn/start",
      params: { threadId, input: [{ type: "text", text: "private synthetic input" }] },
    });
    const response = await fixture.collector.waitFor((message) => requestId(message, 2));
    const turnId = String(((response.result as JsonObject).turn as JsonObject).id);
    const session = fixture.adapter.sessions[0];
    if (!session) throw new Error("Missing synthetic Session");
    await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", turnId));
    session.appendText("private synthetic output");
    session.succeedTurn();
    await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
    const records = () =>
      diagnostics
        .join("")
        .split("\n")
        .filter((line) => line.startsWith("codexhost Host Runtime: external_turn "))
        .map((line) => JSON.parse(line.slice("codexhost Host Runtime: external_turn ".length)));
    await vi.waitFor(() => expect(records()).toHaveLength(5));
    expect(records()).toEqual(
      [
        "turn_start_received",
        "adapter_ready_observed",
        "turn_started_emitted",
        "first_output_emitted",
        "turn_completed_emitted",
      ].map((stage) => ({
        threadId,
        turnId,
        stage,
        atMs: expect.any(Number),
        ...(stage === "turn_completed_emitted" ? { reason: "succeeded" } : {}),
      })),
    );
    expect(diagnostics.join("")).not.toContain("private synthetic");
  } finally {
    await stopFixture(fixture);
  }
});

it.each([true, false])(
  "publishes exactly one in-progress start before a cold Claude Side Chat is ready (persistence=%s)",
  async (persistent) => {
    const { fixture, threadId, child, parentId } = await newClaudeFork(persistent, true);
    const startup = Promise.withResolvers<undefined>();
    const executing = Promise.withResolvers<undefined>();
    const ready = Promise.withResolvers<undefined>();
    const execute = child.execute.bind(child);
    vi.spyOn(child, "execute").mockImplementationOnce(async (command) => {
      executing.resolve(undefined);
      await startup.promise;
      const result = await execute(command);
      ready.resolve(undefined);
      return result;
    });
    try {
      await rpc(fixture, 9, "thread/inject_items", {
        threadId,
        items: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "private inherited context" }],
          },
        ],
      });
      const response = await rpc(fixture, 4, "turn/start", {
        threadId,
        clientUserMessageId: "side-chat-authored-prompt",
        input: [{ type: "text", text: "synthetic first prompt" }],
      });
      const turnId = hostTurnIdSchema.parse(
        ((response.result as JsonObject).turn as JsonObject).id,
      );
      const started = await fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/started", turnId),
      );
      await executing.promise;
      expect(started).toMatchObject({ params: { threadId, turn: { status: "inProgress" } } });
      const input = await fixture.collector.waitFor(
        (message) =>
          message.method === "item/started" &&
          (message.params as JsonObject).turnId === turnId &&
          ((message.params as JsonObject).item as JsonObject).type === "userMessage",
      );
      expect(input).toMatchObject({
        params: {
          item: {
            clientId: "side-chat-authored-prompt",
            content: [{ type: "text", text: "synthetic first prompt" }],
          },
        },
      });
      expect(fixture.collector.messages.indexOf(response)).toBeLessThan(
        fixture.collector.messages.indexOf(started),
      );
      expect(
        fixture.collector.messages.some((message) => turnEvent(message, "turn/completed", turnId)),
      ).toBe(false);
      startup.resolve(undefined);
      await ready.promise;
      child.appendText("synthetic streamed answer");
      await fixture.collector.waitFor(
        (message) =>
          message.method === "item/agentMessage/delta" &&
          (message.params as JsonObject).turnId === turnId,
      );
      child.succeedTurn();
      await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
      expect(
        fixture.collector.messages.filter((message) => turnEvent(message, "turn/started", turnId)),
      ).toHaveLength(1);
      expect(
        fixture.collector.messages.filter(
          (message) =>
            message.method === "turn/started" &&
            (message.params as JsonObject).threadId === parentId,
        ),
      ).toHaveLength(1);
    } finally {
      startup.resolve(undefined);
      await stopFixture(fixture);
    }
  },
);

it("retains the old acceptance boundary for an ordinary Claude fork", async () => {
  const { fixture, threadId, child } = await newClaudeFork(true, false);
  const startup = Promise.withResolvers<undefined>();
  const executing = Promise.withResolvers<undefined>();
  const execute = child.execute.bind(child);
  vi.spyOn(child, "execute").mockImplementationOnce(async (command) => {
    executing.resolve(undefined);
    await startup.promise;
    return execute(command);
  });
  const starting = rpc(fixture, 4, "turn/start", {
    threadId,
    input: [{ type: "text", text: "synthetic ordinary fork" }],
  });
  try {
    await executing.promise;
    expect(fixture.collector.messages.some((message) => requestId(message, 4))).toBe(false);
    expect(
      fixture.collector.messages.some(
        (message) =>
          message.method === "turn/started" && (message.params as JsonObject).threadId === threadId,
      ),
    ).toBe(false);
    startup.resolve(undefined);
    const response = await starting;
    const turnId = hostTurnIdSchema.parse(((response.result as JsonObject).turn as JsonObject).id);
    child.succeedTurn();
    await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId));
  } finally {
    startup.resolve(undefined);
    await starting.catch(() => undefined);
    await stopFixture(fixture);
  }
});

it.each(["startup failure", "interrupt during startup"])(
  "settles the acknowledged Claude Side Chat on %s",
  async (scenario) => {
    const { fixture, threadId, child } = await newClaudeFork(false, true);
    const startup = Promise.withResolvers<undefined>();
    const executing = Promise.withResolvers<undefined>();
    const execute = child.execute.bind(child);
    if (scenario === "startup failure") {
      child.rejectNextTurn({
        code: "nativeFailure",
        message: "Synthetic startup failure",
        retryable: true,
      });
    }
    const spy = vi.spyOn(child, "execute").mockImplementationOnce(async (command) => {
      executing.resolve(undefined);
      await startup.promise;
      return execute(command);
    });
    try {
      const response = await rpc(fixture, 4, "turn/start", {
        threadId,
        input: [{ type: "text", text: "synthetic first prompt" }],
      });
      const turnId = hostTurnIdSchema.parse(
        ((response.result as JsonObject).turn as JsonObject).id,
      );
      await executing.promise;
      if (scenario === "interrupt during startup") {
        child.completeCancellationOnRequest();
        const interrupt = rpc(fixture, 5, "turn/interrupt", { threadId, turnId });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(spy).toHaveBeenCalledTimes(1);
        startup.resolve(undefined);
        expect(await interrupt).toMatchObject({ result: {} });
      } else startup.resolve(undefined);
      expect(
        await fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", turnId)),
      ).toMatchObject({
        params: { turn: { status: scenario === "startup failure" ? "failed" : "interrupted" } },
      });
      expect(fixture.collector.messages.filter((message) => requestId(message, 4))).toHaveLength(1);
    } finally {
      startup.resolve(undefined);
      await stopFixture(fixture);
    }
  },
);
