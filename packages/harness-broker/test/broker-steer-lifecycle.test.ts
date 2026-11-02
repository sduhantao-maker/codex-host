import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  HarnessOutputChannel,
  type HarnessOutput,
  type HostCommand,
} from "@codexhost/harness-adapter";
import { FakeHarnessAdapter } from "@codexhost/harness-adapter/testing";
import { harnessIdSchema, hostItemIdSchema, hostTurnIdSchema } from "@codexhost/shared-contracts";
import { BrokeredHarnessAdapter, startHarnessBrokerServer } from "../src/index.js";
import { brokerHostCommandSchema, harnessOutputSchema } from "../src/validation.js";

it("opts new peers into correlated steering events without changing commands from old callers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cx-steer-"));
  const adapter = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  adapter.supportsSteer = true;
  const open = adapter.open.bind(adapter);
  const channel = new HarnessOutputChannel<HarnessOutput>();
  let pumping: Promise<void> = Promise.resolve();
  const commands: HostCommand[] = [];
  adapter.open = async (input) => {
    const result = await open(input);
    if (!result.ok) return result;
    const source = result.value;
    pumping = (async () => {
      try {
        for await (const output of source.outputs) channel.emit(output);
      } finally {
        channel.end();
      }
    })();
    return {
      ok: true,
      value: new Proxy(source, {
        get(target, key) {
          if (key === "steerLifecycle") return true;
          if (key === "outputs") return channel.outputs;
          if (key === "execute")
            return async (command: HostCommand) => {
              commands.push(command);
              const accepted = await Reflect.apply(target.execute, target, [command]);
              return command.type === "turn.steer" && command.steerId && accepted.ok
                ? { ok: true, value: { accepted: true, projection: "deferred" } }
                : accepted;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
  };
  const descriptorPath = path.join(directory, "broker.json");
  const server = await startHarnessBrokerServer({
    descriptorPath,
    socketPath:
      process.platform === "win32"
        ? `\\\\.\\pipe\\steer-${randomUUID()}`
        : path.join(directory, "b.sock"),
    adapter,
  });
  const client = new BrokeredHarnessAdapter({ descriptorPath });
  try {
    const opened = await client.open({ kind: "create", cwd: directory });
    if (!opened.ok) throw new Error(opened.error.message);
    const session = opened.value;
    expect(session.steerLifecycle).toBe(true);
    const outputs = session.outputs[Symbol.asyncIterator]();
    const turnId = hostTurnIdSchema.parse("active-turn");
    await session.execute({
      type: "turn.start",
      turnId,
      input: [{ type: "text", text: "initial" }],
    });
    expect((await outputs.next()).value).toMatchObject({ event: { type: "turn.started", turnId } });
    expect((await outputs.next()).value).toMatchObject({
      event: { type: "item.started", item: { type: "agentMessage" } },
    });
    const oldCommand = {
      type: "turn.steer" as const,
      turnId,
      input: [{ type: "text" as const, text: "legacy" }],
    };
    expect(await session.execute(oldCommand)).toEqual({ ok: true, value: { accepted: true } });
    expect(commands.at(-1)).toEqual(oldCommand);
    const steerId = hostItemIdSchema.parse(randomUUID());
    expect(await session.execute({ ...oldCommand, steerId })).toEqual({
      ok: true,
      value: { accepted: true, projection: "deferred" },
    });
    expect(commands.at(-1)).toEqual({ ...oldCommand, steerId });
    for (const event of [
      { type: "turn.steer.started" as const, turnId, steerId },
      { type: "turn.steer.cancelled" as const, turnId, steerId, reason: "cancelled" as const },
    ]) {
      channel.emit({ kind: "event", event });
      expect((await outputs.next()).value).toEqual({ kind: "event", event });
    }
    await session.close();
  } finally {
    await client.close();
    await server.close();
    await pumping;
    await rm(directory, { recursive: true, force: true });
  }
});

it("validates the lifecycle correlation boundary and keeps the old command shape valid", () => {
  const command = { type: "turn.steer", turnId: "turn", input: [{ type: "text", text: "legacy" }] };
  expect(brokerHostCommandSchema.parse(command)).toEqual(command);
  expect(brokerHostCommandSchema.safeParse({ ...command, steerId: null }).success).toBe(false);
  const event = {
    type: "turn.steer.cancelled",
    turnId: "turn",
    steerId: "steer",
    reason: "cancelled",
  };
  expect(harnessOutputSchema.safeParse({ kind: "event", event }).success).toBe(true);
  for (const invalid of [
    { ...event, reason: "arbitrary body" },
    { ...event, steerId: null },
    { ...event, extra: "not allowed" },
  ]) {
    expect(harnessOutputSchema.safeParse({ kind: "event", event: invalid }).success).toBe(false);
  }
});
