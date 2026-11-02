import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { HarnessSession, HostCommand } from "@codexhost/harness-adapter";
import { FakeHarnessAdapter } from "@codexhost/harness-adapter/testing";
import { harnessIdSchema } from "@codexhost/shared-contracts";
import { expect, it, vi } from "vitest";
import { consumeBrokerFrames, writeBrokerFrame } from "../src/framing.js";
import { startHarnessBrokerServer } from "../src/server.js";
import {
  HARNESS_BROKER_MAX_PENDING_REQUESTS,
  type HarnessBrokerDescriptorV1,
  type HarnessBrokerMethod,
  type HarnessBrokerServerFrame,
} from "../src/protocol.js";

async function connect(descriptor: HarnessBrokerDescriptorV1) {
  const socket = net.createConnection(descriptor.socketPath);
  const hello = Promise.withResolvers<undefined>();
  const closed = Promise.withResolvers<undefined>();
  const pending = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<HarnessBrokerServerFrame>>
  >();
  const frames: HarnessBrokerServerFrame[] = [];
  let sequence = 1;
  consumeBrokerFrames(
    socket,
    (raw) => {
      const frame = raw as HarnessBrokerServerFrame;
      frames.push(frame);
      if (frame.kind !== "response") return;
      if (frame.ok && frame.value && typeof frame.value === "object" && "ready" in frame.value)
        hello.resolve(undefined);
      pending.get(frame.id)?.resolve(frame);
      pending.delete(frame.id);
    },
    (error) => hello.reject(error),
  );
  socket.once("close", () => {
    hello.reject(new Error("closed"));
    for (const waiter of pending.values()) waiter.reject(new Error("closed"));
    pending.clear();
    closed.resolve(undefined);
  });
  await once(socket, "connect");
  await writeBrokerFrame(socket, {
    version: 1,
    generation: descriptor.generation,
    sequence,
    kind: "hello",
    token: descriptor.token,
  });
  await hello.promise;
  return {
    frames,
    closed: closed.promise,
    call(method: HarnessBrokerMethod, params: unknown) {
      const id = randomUUID();
      const waiter = Promise.withResolvers<HarnessBrokerServerFrame>();
      pending.set(id, waiter);
      void writeBrokerFrame(socket, {
        version: 1,
        generation: descriptor.generation,
        sequence: ++sequence,
        kind: "request",
        id,
        method,
        params,
      }).catch((error) => {
        waiter.reject(error);
        pending.delete(id);
      });
      return { id, result: waiter.promise };
    },
    invalid(kind: "generation" | "sequence") {
      return writeBrokerFrame(socket, {
        version: 1,
        generation: kind === "generation" ? randomUUID() : descriptor.generation,
        sequence: ++sequence + (kind === "sequence" ? 1 : 0),
        kind: "request",
        id: randomUUID(),
        method: "session.execute",
        params: {},
      });
    },
    async close() {
      socket.destroy();
      await closed.promise;
    },
  };
}

async function fixture({ lifecycle = true, token = true, holdCancel = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cx-steer-stop-"));
  const ack = Promise.withResolvers<undefined>();
  const cancelAck = Promise.withResolvers<undefined>();
  const reserved = Promise.withResolvers<undefined>();
  const events: string[] = [];
  const native = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  const originalOpen = native.open.bind(native);
  native.open = async (input) => {
    const opened = await originalOpen(input);
    if (!opened.ok) return opened;
    const session = opened.value;
    if (lifecycle) Object.assign(session, { steerLifecycle: true });
    const execute = session.execute.bind(session);
    session.execute = (async (command: HostCommand) => {
      if (command.type === "turn.steer") {
        events.push("steer-reserved");
        reserved.resolve(undefined);
        await ack.promise;
        events.push("steer-ack");
        return { ok: true, value: { accepted: true, projection: "deferred" } };
      }
      if (command.type === "turn.cancel") {
        events.push("cancel-start");
        if (holdCancel) await cancelAck.promise;
        events.push("cancel-done");
      }
      if (command.type === "model.select") {
        events.push("model");
        return { ok: true, value: { completed: true } };
      }
      if (command.type === "thinking.select") {
        events.push("thinking");
        return { ok: true, value: { completed: true } };
      }
      return Reflect.apply(execute, session, [command]);
    }) as HarnessSession["execute"];
    return opened;
  };
  const server = await startHarnessBrokerServer({
    descriptorPath: path.join(directory, "broker.json"),
    socketPath:
      process.platform === "win32"
        ? `\\\\.\\pipe\\cx-steer-stop-${randomUUID()}`
        : path.join(directory, "b.sock"),
    adapter: native,
  });
  const client = await connect(server.descriptor);
  const opened = await client.call("adapter.open", { kind: "create", cwd: directory }).result;
  expect(opened).toMatchObject({ ok: true, value: { ok: true } });
  if (opened.kind !== "response") throw new Error("Missing open reply");
  const metadata = (opened.value as { value: { sessionId: string; sessionGeneration: number } })
    .value;
  const params = { sessionId: metadata.sessionId, sessionGeneration: metadata.sessionGeneration };
  await client.call("session.execute", {
    ...params,
    command: {
      type: "turn.start",
      turnId: "active-turn",
      input: [{ type: "text", text: "synthetic" }],
    },
  }).result;
  const model = native.catalog.defaultModel ?? native.catalog.models[0]?.ref;
  if (!model) throw new Error("Missing model");
  return {
    client,
    events,
    ack,
    cancelAck,
    reserved,
    steer: () =>
      client.call("session.execute", {
        ...params,
        command: {
          type: "turn.steer",
          turnId: "active-turn",
          input: [{ type: "text", text: "synthetic" }],
          ...(token ? { steerId: randomUUID() } : {}),
        },
      }),
    cancel: (generation = params.sessionGeneration, turnId = "active-turn") =>
      client.call("session.execute", {
        ...params,
        sessionGeneration: generation,
        command: { type: "turn.cancel", turnId },
      }),
    model: () =>
      client.call("session.execute", { ...params, command: { type: "model.select", model } }),
    thinking: () =>
      client.call("session.execute", {
        ...params,
        command: { type: "thinking.select", thinkingOptionId: "auto" },
      }),
    async close() {
      ack.resolve(undefined);
      cancelAck.resolve(undefined);
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

it("runs a same-session Stop after synchronous input reservation without waiting for its receipt", async () => {
  const f = await fixture();
  const steer = f.steer();
  const cancel = f.cancel();
  try {
    await vi.waitFor(() => expect(f.events).toContain("cancel-start"));
    expect(f.events).toEqual(["steer-reserved", "cancel-start", "cancel-done"]);
    expect(await cancel.result).toMatchObject({ id: cancel.id, ok: true });
    f.ack.resolve(undefined);
    expect(await steer.result).toMatchObject({ id: steer.id, ok: true });
    expect(f.client.frames.map((frame) => frame.sequence)).toEqual(
      f.client.frames.map((_, index) => index + 1),
    );
  } finally {
    f.ack.resolve(undefined);
    await Promise.allSettled([steer.result, cancel.result]);
    await f.close();
  }
});

it("skips a different-Turn cancellation while promoting the matching Stop", async () => {
  const f = await fixture();
  const steer = f.steer();
  await f.reserved.promise;
  const wrongTurn = f.cancel(undefined, "another-turn");
  const matching = f.cancel();
  try {
    expect(await matching.result).toMatchObject({ id: matching.id, ok: true });
    expect(f.events).toEqual(["steer-reserved", "cancel-start", "cancel-done"]);
    f.ack.resolve(undefined);
    await steer.result;
    expect(await wrongTurn.result).toMatchObject({
      id: wrongTurn.id,
      ok: true,
      value: { ok: false, error: { code: "invalidState" } },
    });
  } finally {
    f.ack.resolve(undefined);
    await Promise.allSettled([steer.result, wrongTurn.result, matching.result]);
    await f.close();
  }
});

it("keeps ordinary mutations FIFO and holds them behind the priority cancellation completion", async () => {
  const f = await fixture({ holdCancel: true });
  const steer = f.steer();
  await f.reserved.promise;
  const model = f.model();
  const thinking = f.thinking();
  const cancel = f.cancel();
  try {
    await vi.waitFor(() => expect(f.events).toContain("cancel-start"));
    f.ack.resolve(undefined);
    await steer.result;
    expect(f.events).toEqual(["steer-reserved", "cancel-start", "steer-ack"]);
    f.cancelAck.resolve(undefined);
    await Promise.all([model.result, thinking.result, cancel.result]);
    expect(f.events).toEqual([
      "steer-reserved",
      "cancel-start",
      "steer-ack",
      "cancel-done",
      "model",
      "thinking",
    ]);
  } finally {
    f.ack.resolve(undefined);
    f.cancelAck.resolve(undefined);
    await Promise.allSettled([steer.result, model.result, thinking.result, cancel.result]);
    await f.close();
  }
});

it.each([
  { lifecycle: false, token: true },
  { lifecycle: true, token: false },
])("preserves legacy receipt ordering for %o", async (options) => {
  const f = await fixture(options);
  const steer = f.steer();
  await f.reserved.promise;
  const cancel = f.cancel();
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(f.events).toEqual(["steer-reserved"]);
    f.ack.resolve(undefined);
    await Promise.all([steer.result, cancel.result]);
    expect(f.events).toEqual(["steer-reserved", "steer-ack", "cancel-start", "cancel-done"]);
  } finally {
    f.ack.resolve(undefined);
    await Promise.allSettled([steer.result, cancel.result]);
    await f.close();
  }
});

it.each(["generation", "sequence"] as const)(
  "rejects an invalid %s before priority Stop execution",
  async (kind) => {
    const f = await fixture();
    const steer = f.steer();
    const settled = steer.result.catch(() => undefined);
    await f.reserved.promise;
    try {
      await f.client.invalid(kind);
      await f.client.closed;
      expect(f.events).toEqual(["steer-reserved"]);
    } finally {
      f.ack.resolve(undefined);
      await settled;
      await f.close();
    }
  },
);

it("does not prioritize a stale Session generation", async () => {
  const f = await fixture();
  const steer = f.steer();
  await f.reserved.promise;
  const cancel = f.cancel(2);
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(f.events).toEqual(["steer-reserved"]);
    f.ack.resolve(undefined);
    await steer.result;
    expect(await cancel.result).toMatchObject({ ok: false, error: { code: "protocolError" } });
    expect(f.events).toEqual(["steer-reserved", "steer-ack"]);
  } finally {
    f.ack.resolve(undefined);
    await Promise.allSettled([steer.result, cancel.result]);
    await f.close();
  }
});

it("drops queued mutations on connection close and contains late receipt/reply failures", async () => {
  const f = await fixture({ holdCancel: true });
  const steer = f.steer();
  const steerSettled = steer.result.catch(() => undefined);
  await f.reserved.promise;
  const model = f.model();
  const modelSettled = model.result.catch(() => undefined);
  const cancel = f.cancel();
  const cancelSettled = cancel.result.catch(() => undefined);
  try {
    await vi.waitFor(() => expect(f.events).toContain("cancel-start"));
    await f.client.close();
    f.ack.resolve(undefined);
    f.cancelAck.resolve(undefined);
    await Promise.all([steerSettled, modelSettled, cancelSettled]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.events).not.toContain("model");
  } finally {
    await f.close();
  }
});

it("counts receipt waits and queued requests toward the existing connection limit", async () => {
  const f = await fixture();
  const steer = f.steer();
  const work = [steer.result.catch(() => undefined)];
  await f.reserved.promise;
  try {
    for (let index = 0; index < HARNESS_BROKER_MAX_PENDING_REQUESTS; index++)
      work.push(f.model().result.catch(() => undefined));
    await f.client.closed;
    expect(f.events).toEqual(["steer-reserved"]);
  } finally {
    f.ack.resolve(undefined);
    await Promise.allSettled(work);
    await f.close();
  }
});
