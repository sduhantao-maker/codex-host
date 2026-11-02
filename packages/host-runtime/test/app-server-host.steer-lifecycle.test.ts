import {
  HarnessOutputChannel,
  type HarnessOutput,
  type HostCommand,
  type TurnSteerCommand,
} from "@codexhost/harness-adapter";
import { FakeHarnessAdapter, type FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import { CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID, type JsonObject } from "@codexhost/protocol-core";
import { harnessIdSchema, hostTurnIdSchema, type HostItemId } from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  requestId,
  startExternalThread,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

const typed = "ask [@Grok](subagent://codexhost.grok) to review";
const clientId = "lifecycle-client-message";
const usageUpdatedMethod = "codexhost/thread/usage/updated";

async function scenario(
  options: {
    lifecycle?: boolean;
    deferred?: boolean;
    holdAck?: boolean;
    nativeSteer?: boolean;
  } = {},
) {
  const adapter = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  adapter.supportsSteer = options.nativeSteer ?? true;
  const stream = new HarnessOutputChannel<HarnessOutput>();
  const commands: HostCommand[] = [];
  const steers: TurnSteerCommand[] = [];
  const pending = new Map<HostItemId, TurnSteerCommand>();
  const ack = Promise.withResolvers<undefined>();
  let native: FakeHarnessSession | undefined;
  const nativeOpen = adapter.open.bind(adapter);
  vi.spyOn(adapter, "open").mockImplementation(async (input) => {
    const opened = await nativeOpen(input);
    if (!opened.ok) return opened;
    const session = adapter.sessions.at(-1);
    if (!session) throw new Error("Fake Adapter did not retain its Session");
    native = session;
    const forwarding = (async () => {
      try {
        for await (const output of session.outputs) stream.emit(output);
      } finally {
        stream.end();
      }
    })();
    const wrapped = new Proxy(session, {
      get(target, key) {
        if (key === "steerLifecycle") return options.lifecycle === false ? undefined : true;
        if (key === "outputs") return stream.outputs;
        if (key === "close")
          return async () => {
            ack.resolve(undefined);
            await target.close();
            await forwarding;
          };
        if (key === "execute")
          return async (command: HostCommand) => {
            commands.push(command);
            if (command.type === "turn.steer") {
              steers.push(command);
              if (options.deferred !== false) {
                if (!command.steerId) throw new Error("Host did not reserve a steer identity");
                pending.set(command.steerId, command);
                if (options.holdAck) await ack.promise;
                return { ok: true, value: { accepted: true, projection: "deferred" } };
              }
            }
            if (command.type === "turn.cancel") {
              for (const [steerId, steer] of pending) {
                stream.emit({
                  kind: "event",
                  event: {
                    type: "turn.steer.cancelled",
                    turnId: steer.turnId,
                    steerId: steer.steerId ?? steerId,
                    reason: "cancelled",
                  },
                });
              }
              pending.clear();
            }
            return Reflect.apply(target.execute, target, [command]);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { ok: true, value: wrapped };
  });
  const fixture = createFixture({ externalAdapters: new Map([["claude-code", adapter]]) });
  const threadId = await startExternalThread(fixture, CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID);
  writeRequest(fixture.desktopInput, {
    id: 2,
    method: "turn/start",
    params: { threadId, input: [{ type: "text", text: "synthetic" }] },
  });
  const initial = await fixture.collector.waitFor((message) => requestId(message, 2));
  if (initial.error) {
    await stopFixture(fixture);
    expect(initial).not.toHaveProperty("error");
  }
  const turnId = ((initial.result as JsonObject).turn as JsonObject).id;
  if (typeof turnId !== "string") throw new Error("Missing synthetic active Turn");
  await fixture.collector.waitFor((message) => turnEvent(message, "turn/started", turnId));
  if (!native) throw new Error("Synthetic Session was not opened");
  const session = native;
  const submit = (id = 30) => {
    writeRequest(fixture.desktopInput, {
      id,
      method: "turn/steer",
      params: {
        threadId,
        expectedTurnId: turnId,
        clientUserMessageId: clientId,
        input: [{ type: "text", text: typed }],
      },
    });
    return fixture.collector.waitFor((message) => requestId(message, id));
  };
  const started = (sourceTurnId = turnId) => {
    const steer = steers[0];
    if (!steer?.steerId) throw new Error("Missing reserved steer identity");
    if (sourceTurnId === steer.turnId) pending.delete(steer.steerId);
    stream.emit({
      kind: "event",
      event: {
        type: "turn.steer.started",
        turnId: hostTurnIdSchema.parse(sourceTurnId),
        steerId: steer.steerId,
      },
    });
  };
  const flush = async () => {
    const after = fixture.collector.messages.length;
    stream.emit({ kind: "event", event: { type: "session.usage.changed", usage: null } });
    await fixture.collector.waitFor(
      (message) =>
        fixture.collector.messages.indexOf(message) >= after &&
        message.method === usageUpdatedMethod,
    );
  };
  const finish = async (id = turnId) => {
    session.appendText("SYNTHETIC_REPLY");
    session.succeedTurn();
    return fixture.collector.waitFor((message) => turnEvent(message, "turn/completed", id));
  };
  const close = async () => {
    ack.resolve(undefined);
    await stopFixture(fixture);
  };
  return {
    fixture,
    threadId,
    turnId,
    session,
    commands,
    steers,
    submit,
    started,
    flush,
    finish,
    close,
    acknowledge: () => ack.resolve(undefined),
  };
}

function canonical(messages: JsonObject[]) {
  return messages.filter((message) => {
    const item = (message.params as JsonObject | undefined)?.item as JsonObject | undefined;
    return (
      (message.method === "item/started" || message.method === "item/completed") &&
      item?.type === "userMessage" &&
      item.clientId === clientId
    );
  });
}

describe("Host canonical steering lifecycle", () => {
  it("waits for native started, then projects the original input once on the original Turn", async () => {
    const f = await scenario();
    try {
      expect(await f.submit()).toMatchObject({
        result: { turnId: f.turnId, delivery: "activeTurn" },
      });
      expect(canonical(f.fixture.collector.messages)).toEqual([]);
      expect(f.steers).toHaveLength(1);
      expect(f.steers[0]?.input[0]?.text).toContain("[codexhost delegation]");
      expect(f.steers[0]?.input[0]?.text).not.toBe(typed);
      f.started();
      await f.flush();
      const items = canonical(f.fixture.collector.messages);
      expect(items.map((message) => message.method)).toEqual(["item/started", "item/completed"]);
      for (const message of items)
        expect(message.params).toMatchObject({
          turnId: f.turnId,
          item: { clientId, content: [{ type: "text", text: typed }] },
        });
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
      expect(f.commands.filter((command) => command.type === "turn.cancel")).toEqual([]);
      const terminal = await f.finish();
      expect((terminal.params as JsonObject).turn).toMatchObject({
        id: f.turnId,
        status: "completed",
      });
      expect(f.commands.filter((command) => command.type === "turn.start")).toHaveLength(1);
      const diagnostics: string = f.fixture.diagnosticOutput.read()?.toString() ?? "";
      expect(diagnostics).not.toContain(typed);
      expect(diagnostics).not.toContain("[codexhost delegation]");
      const rows = diagnostics
        .split("\n")
        .filter((line) => line.startsWith("codexhost Host Runtime: {"))
        .map((line) => JSON.parse(line.slice("codexhost Host Runtime: ".length)));
      expect(rows.map((row) => row.event)).toEqual(
        expect.arrayContaining(["steer.received", "steer.accepted", "steer.merged", "turn.ended"]),
      );
      const allowed = new Set([
        "component",
        "event",
        "at",
        "threadId",
        "nativeSessionId",
        "turnId",
        "steerId",
        "clientUserMessageId",
        "length",
        "delivery",
        "reason",
      ]);
      expect(rows.every((row) => Object.keys(row).every((key) => allowed.has(key)))).toBe(true);
    } finally {
      await f.close();
    }
  });

  it("handles native started before the queued acknowledgment without a duplicate projection", async () => {
    const f = await scenario({ holdAck: true });
    try {
      const response = f.submit();
      await vi.waitFor(() => expect(f.steers).toHaveLength(1));
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
      expect(f.fixture.collector.messages.some((message) => requestId(message, 30))).toBe(false);
      f.acknowledge();
      expect(await response).toMatchObject({
        result: { turnId: f.turnId, delivery: "activeTurn" },
      });
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
      await f.finish();
    } finally {
      await f.close();
    }
  });

  it("does not consume a token on another source Turn and ignores a repeated valid started event", async () => {
    const f = await scenario();
    try {
      await f.submit();
      f.started("unrelated-turn");
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toEqual([]);
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
      await f.finish();
    } finally {
      await f.close();
    }
  });

  it("cancels a queued unstarted guide without canonical confirmation or late resurrection", async () => {
    const f = await scenario();
    try {
      await f.submit();
      f.session.completeCancellationOnRequest();
      writeRequest(f.fixture.desktopInput, {
        id: 31,
        method: "turn/interrupt",
        params: { threadId: f.threadId, turnId: f.turnId },
      });
      expect(await f.fixture.collector.waitFor((message) => requestId(message, 31))).toMatchObject({
        result: {},
      });
      const terminal = await f.fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", f.turnId),
      );
      expect((terminal.params as JsonObject).turn).toMatchObject({ status: "interrupted" });
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toEqual([]);
      expect(f.commands.filter((command) => command.type === "turn.start")).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it("does not restart a cancelled reserved guide when its acceptance reply arrives after Stop", async () => {
    const f = await scenario({ holdAck: true });
    try {
      const submitted = f.submit();
      await vi.waitFor(() => expect(f.steers).toHaveLength(1));
      f.session.completeCancellationOnRequest();
      writeRequest(f.fixture.desktopInput, {
        id: 31,
        method: "turn/interrupt",
        params: { threadId: f.threadId, turnId: f.turnId },
      });
      await vi.waitFor(() =>
        expect(f.commands.some((command) => command.type === "turn.cancel")).toBe(true),
      );
      f.acknowledge();
      expect(await submitted).toMatchObject({
        result: { turnId: f.turnId, delivery: "activeTurn" },
      });
      await f.fixture.collector.waitFor((message) => requestId(message, 31));
      const terminal = await f.fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", f.turnId),
      );
      expect((terminal.params as JsonObject).turn).toMatchObject({ status: "interrupted" });
      f.started();
      await f.flush();
      expect(canonical(f.fixture.collector.messages)).toEqual([]);
      expect(f.commands.filter((command) => command.type === "turn.start")).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it.each([false, true])(
    "preserves immediate legacy acceptance with lifecycle advertised=%s",
    async (lifecycle) => {
      const f = await scenario({ lifecycle, deferred: false });
      try {
        expect(await f.submit()).toMatchObject({
          result: { turnId: f.turnId, delivery: "activeTurn" },
        });
        expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
        if (!lifecycle) expect(f.steers[0]).not.toHaveProperty("steerId");
        else {
          f.started();
          await f.flush();
          expect(canonical(f.fixture.collector.messages)).toHaveLength(2);
        }
        expect(f.commands.filter((command) => command.type === "turn.cancel")).toEqual([]);
        await f.finish();
      } finally {
        await f.close();
      }
    },
  );

  it("preserves the old-CLI replacement path when native steering is not available", async () => {
    const f = await scenario({ lifecycle: false, nativeSteer: false });
    try {
      f.session.completeCancellationOnRequest();
      const response = await f.submit();
      expect(response).toMatchObject({ result: { delivery: "newTurn" } });
      const newTurnId = (response.result as JsonObject).turnId;
      if (typeof newTurnId !== "string") throw new Error("Missing legacy replacement identity");
      expect(newTurnId).not.toBe(f.turnId);
      expect(f.steers).toEqual([]);
      expect(f.commands.filter((command) => command.type === "turn.cancel")).toHaveLength(1);
      await f.finish(newTurnId);
    } finally {
      await f.close();
    }
  });

  it("keeps accepted native input successful when its later canonical write fails", async () => {
    const f = await scenario();
    let restoreWrite: (() => void) | undefined;
    try {
      const response = await f.submit();
      expect(response.error).toBeUndefined();
      const originalWrite = f.fixture.desktopOutput.write.bind(f.fixture.desktopOutput);
      let failed = false;
      const write = vi
        .spyOn(f.fixture.desktopOutput, "write")
        .mockImplementation((chunk, ...rest) => {
          const message = JSON.parse(String(chunk)) as JsonObject;
          if (!failed && canonical([message]).length > 0) {
            failed = true;
            throw new Error("Synthetic canonical projection write failure");
          }
          return Reflect.apply(originalWrite, f.fixture.desktopOutput, [chunk, ...rest]);
        });
      restoreWrite = () => write.mockRestore();
      f.started();
      await vi.waitFor(() => expect(failed).toBe(true));
      const terminal = await f.finish();
      expect((terminal.params as JsonObject).turn).toMatchObject({ status: "completed" });
      expect(f.fixture.collector.messages.filter((message) => requestId(message, 30))).toEqual([
        response,
      ]);
      expect(f.steers).toHaveLength(1);
      expect(f.commands.filter((command) => command.type === "turn.cancel")).toEqual([]);
    } finally {
      restoreWrite?.();
      await f.close();
    }
  });

  it("keeps idle steering rejected without delivering or projecting an input", async () => {
    const f = await scenario();
    try {
      await f.finish();
      expect(await f.submit()).toMatchObject({ error: { code: -32074 } });
      expect(f.steers).toEqual([]);
      expect(canonical(f.fixture.collector.messages)).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
