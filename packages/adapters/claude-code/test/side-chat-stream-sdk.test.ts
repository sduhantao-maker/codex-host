import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessOutput } from "@codexhost/harness-adapter";
import {
  hostTurnIdSchema,
  nativeCheckpointRefSchema,
  nativeSessionRefSchema,
} from "@codexhost/shared-contracts";
import { expect, it, vi } from "vitest";
import { ClaudeCodeAdapter } from "../src/index.js";
import { ClaudeSdkTransport, type ClaudeSdkTransportOptions } from "../src/sdk-transport.js";
import type { ClaudeAdapterDependencies } from "../src/transport.js";
import { FakeQuery } from "./fake-sdk-query.js";

it("a cold fork waits for SDK readiness, then delivers partial frames before completion like a warm turn", async () => {
  const sourceSessionId = "00000000-0000-4000-8000-000000000011";
  const forkSessionId = "00000000-0000-4000-8000-000000000012";
  const sdk = new FakeQuery();
  const init = await sdk.initializationResult();
  const startup = Promise.withResolvers<undefined>();
  sdk.initializationResult.mockImplementationOnce(async () => {
    await startup.promise;
    return init;
  });
  let uuid = 20;
  let sdkOptions: Parameters<NonNullable<ClaudeSdkTransportOptions["queryFactory"]>>[0]["options"];
  const createTransport = vi.fn(
    (input: Parameters<ClaudeAdapterDependencies["createTransport"]>[0]) =>
      new ClaudeSdkTransport({
        ...input,
        command: process.execPath,
        closeTimeoutMs: 50,
        queryFactory: ({ options }) => {
          sdkOptions = options;
          return sdk as unknown as Query;
        },
      }),
  );
  const adapter = new ClaudeCodeAdapter(
    { closeTimeoutMs: 50 },
    {
      randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
      bypassPermissionsAvailable: () => false,
      inspectInstallation() {},
      createInspector() {
        throw new Error("A transcript fork must not inspect the model");
      },
      deleteSession: async () => {},
      forkSession: async () => ({ sessionId: forkSessionId }),
      getSessionInfo: async () => ({ cwd: "/synthetic" }),
      readSessionMessages: async ({ sessionId }) => [
        {
          type: "user",
          uuid: `${sessionId}-user`,
          session_id: sessionId,
          message: { role: "user", content: "synthetic inherited input" },
        },
        {
          type: "assistant",
          uuid: `${sessionId}-assistant`,
          session_id: sessionId,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "synthetic inherited output" }],
          },
        },
      ],
      readSubagentMessages: async () => [],
      createTransport,
    },
  );
  const sourceRef = nativeSessionRefSchema.parse({
    harnessId: "claude-code",
    nativeSessionId: sourceSessionId,
    formatVersion: 1,
  });
  const checkpoint = nativeCheckpointRefSchema.parse({
    ...sourceRef,
    checkpointId: `${sourceSessionId}-assistant`,
  });
  const opened = await adapter.open({ kind: "fork", cwd: "/synthetic", sourceRef, checkpoint });
  if (!opened.ok) throw new Error(opened.error.message);
  const session = opened.value;
  const outputs: HarnessOutput[] = [];
  const consuming = (async () => {
    for await (const output of session.outputs) outputs.push(output);
  })();
  const hasEvent = (type: string, turnId: string) =>
    outputs.some(
      (output) =>
        output.kind === "event" &&
        output.event.type === type &&
        "turnId" in output.event &&
        output.event.turnId === turnId,
    );
  const execute = (id: string) =>
    session.execute({
      type: "turn.start",
      turnId: hostTurnIdSchema.parse(id),
      input: [{ type: "text", text: "synthetic child prompt" }],
    });
  try {
    const cold = execute("cold-child");
    await vi.waitFor(() =>
      expect(sdkOptions).toMatchObject({ resume: forkSessionId, includePartialMessages: true }),
    );
    expect(hasEvent("turn.started", "cold-child")).toBe(false);
    startup.resolve(undefined);
    await expect(cold).resolves.toMatchObject({ ok: true });
    for (const id of ["cold-child", "warm-child"]) {
      if (id === "warm-child") await expect(execute(id)).resolves.toMatchObject({ ok: true });
      await vi.waitFor(() => expect(hasEvent("turn.started", id)).toBe(true));
      for (const text of ["partial ", "answer"]) {
        sdk.push({
          type: "stream_event",
          parent_tool_use_id: null,
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        } as unknown as SDKMessage);
        await vi.waitFor(() =>
          expect(
            outputs.some(
              (output) =>
                output.kind === "event" &&
                output.event.type === "item.updated" &&
                output.event.turnId === id &&
                output.event.update.type === "text.append" &&
                output.event.update.text === text,
            ),
          ).toBe(true),
        );
        expect(hasEvent("turn.completed", id)).toBe(false);
      }
      sdk.push({
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "completed",
      } as unknown as SDKMessage);
      await vi.waitFor(() => expect(hasEvent("turn.completed", id)).toBe(true));
    }
    expect(createTransport).toHaveBeenCalledTimes(1);
  } finally {
    startup.resolve(undefined);
    await adapter.close();
    await consuming;
  }
});
