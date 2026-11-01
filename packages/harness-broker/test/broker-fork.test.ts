import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FakeHarnessAdapter, FakeHarnessSession } from "@codexhost/harness-adapter/testing";
import {
  harnessIdSchema,
  hostTurnIdSchema,
  nativeCheckpointRefSchema,
} from "@codexhost/shared-contracts";
import { BrokeredHarnessAdapter, startHarnessBrokerServer } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  captureActiveForkBoundary = false,
  foreignBoundary = false,
  beforeCapture?: () => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cx-fork-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const descriptorPath = path.join(root, "broker.json");
  const native = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  const nativeOpen = native.open.bind(native);
  const open = vi.spyOn(native, "open").mockImplementation(async (input) => {
    const opened = await nativeOpen(input);
    if (opened.ok && captureActiveForkBoundary)
      Object.assign(opened.value, {
        captureActiveForkBoundary: async () => {
          await beforeCapture?.();
          return {
            ok: true as const,
            value: {
              turnId: hostTurnIdSchema.parse("source-turn-2"),
              checkpoint: nativeCheckpointRefSchema.parse({
                harnessId: native.harnessId,
                nativeSessionId: foreignBoundary
                  ? "another-native-session"
                  : opened.value.initialState.nativeRef?.nativeSessionId,
                checkpointId: "durable-active-user",
                formatVersion: 1,
              }),
            },
          };
        },
      });
    return opened;
  });
  const server = await startHarnessBrokerServer({
    descriptorPath,
    socketPath:
      process.platform === "win32"
        ? `\\\\.\\pipe\\cx-fork-${randomUUID()}`
        : path.join(root, "b.sock"),
    adapter: native,
  });
  cleanups.push(() => server.close());
  const client = new BrokeredHarnessAdapter({ descriptorPath });
  const otherClient = new BrokeredHarnessAdapter({ descriptorPath });
  cleanups.push(() => Promise.all([client.close(), otherClient.close()]).then(() => undefined));
  const opened = await client.open({ kind: "create", cwd: root });
  if (!opened.ok) throw new Error(opened.error.message);
  const source = opened.value;
  await source.execute({
    type: "turn.start",
    turnId: hostTurnIdSchema.parse("source-turn-1"),
    input: [{ type: "text", text: "hello" }],
  });
  const nativeSource = native.sessions[0];
  if (!nativeSource) throw new Error("Missing native source Session");
  nativeSource.succeedTurn();
  const sourceRef = source.initialState.nativeRef;
  const checkpoint = nativeSource.persistedSnapshot().turns[0]?.checkpoint;
  if (!sourceRef || !checkpoint) throw new Error("Missing source Fork identity");
  return {
    root,
    native,
    nativeSource,
    open,
    client,
    otherClient,
    source,
    fork: { kind: "fork" as const, cwd: root, sourceRef, checkpoint },
  };
}

it("forwards an advertised active Fork capture without canceling or closing the parent", async () => {
  const f = await fixture(true);
  const sourceClose = vi.spyOn(f.nativeSource, "close");
  await f.source.execute({
    type: "turn.start",
    turnId: hostTurnIdSchema.parse("source-turn-2"),
    input: [{ type: "text", text: "continue" }],
  });
  const execute = vi.spyOn(f.nativeSource, "execute");
  await expect(f.source.captureActiveForkBoundary?.()).resolves.toEqual({
    ok: true,
    value: {
      turnId: "source-turn-2",
      checkpoint: {
        harnessId: "claude-code",
        nativeSessionId: f.fork.sourceRef.nativeSessionId,
        checkpointId: "durable-active-user",
        formatVersion: 1,
      },
    },
  });
  expect(execute).not.toHaveBeenCalled();
  expect(sourceClose).not.toHaveBeenCalled();
  f.nativeSource.succeedTurn();
  await f.source.close();
});

it("does not expose active Fork capture for an adapter that does not advertise it", async () => {
  const f = await fixture();
  expect(f.source.captureActiveForkBoundary).toBeUndefined();
  await f.source.close();
});

it("processes approval and cancellation on the same connection while active Fork capture is pending", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const f = await fixture(true, false, async () => {
    entered.resolve(undefined);
    await release.promise;
  });
  const turnId = hostTurnIdSchema.parse("source-turn-2");
  await f.source.execute({
    type: "turn.start",
    turnId,
    input: [{ type: "text", text: "continue" }],
  });
  const interactionId = f.nativeSource.requestApproval("Approve while capture is pending");
  const captureFinished = vi.fn();
  const capturing = f.source.captureActiveForkBoundary?.().then(captureFinished);
  const execute = vi.spyOn(f.nativeSource, "execute");
  let approval: Promise<unknown> | undefined;
  let cancellation: Promise<unknown> | undefined;
  try {
    await entered.promise;
    approval = f.source.execute({
      type: "interaction.respond",
      interactionId,
      response: { type: "approval", actionId: "allowOnce" },
    });
    cancellation = f.source.execute({ type: "turn.cancel", turnId });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await expect(approval).resolves.toMatchObject({ ok: true });
    await expect(cancellation).resolves.toMatchObject({ ok: true });
    expect(execute.mock.calls.map(([command]) => command.type)).toEqual([
      "interaction.respond",
      "turn.cancel",
    ]);
    expect(captureFinished).not.toHaveBeenCalled();
  } finally {
    release.resolve(undefined);
    await capturing;
    await approval;
    await cancellation;
  }
  f.nativeSource.completeCancellation();
});

it("rejects an active Fork capture that finishes after its owning Session closes", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const f = await fixture(true, false, async () => {
    entered.resolve(undefined);
    await release.promise;
  });
  const closing = vi.spyOn(f.nativeSource, "close");
  const capturing = f.source.captureActiveForkBoundary?.();
  let closed: Promise<void> | undefined;
  try {
    await entered.promise;
    closed = f.source.close();
    await vi.waitFor(() => expect(closing).toHaveBeenCalledOnce());
    await closed;
    release.resolve(undefined);
    await expect(capturing).resolves.toMatchObject({
      ok: false,
      error: { message: "Harness broker Session is unavailable" },
    });
  } finally {
    release.resolve(undefined);
    await capturing;
    await closed;
  }
});

it("handles a late active Fork capture reply after its connection closes", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const f = await fixture(true, false, async () => {
    entered.resolve(undefined);
    await release.promise;
  });
  const capturing = f.source.captureActiveForkBoundary?.();
  try {
    await entered.promise;
    await f.client.close();
  } finally {
    release.resolve(undefined);
    await expect(capturing).resolves.toMatchObject({ ok: false });
    await new Promise((resolve) => setImmediate(resolve));
  }
});

it("rejects a captured boundary that names another native Session", async () => {
  const f = await fixture(true, true);
  await expect(f.source.captureActiveForkBoundary?.()).resolves.toMatchObject({
    ok: false,
    error: { message: "Broker Fork boundary belongs to another Session" },
  });
  await f.source.close();
});

it.each([false, true])(
  "forks an open source with a later Turn running=%s without releasing either writer",
  async (running) => {
    const f = await fixture();
    const sourceClose = vi.spyOn(f.nativeSource, "close");
    if (running) {
      await f.source.execute({
        type: "turn.start",
        turnId: hostTurnIdSchema.parse("source-turn-2"),
        input: [{ type: "text", text: "continue" }],
      });
    }
    const forked = await f.client.open(f.fork);
    expect(forked.ok).toBe(true);
    if (!forked.ok) throw new Error(forked.error.message);
    expect(f.open).toHaveBeenLastCalledWith(f.fork);
    const derivedRef = forked.value.initialState.nativeRef;
    if (!derivedRef) throw new Error("Missing derived Session identity");
    expect(derivedRef.nativeSessionId).not.toBe(f.fork.sourceRef.nativeSessionId);
    const snapshot = await forked.value.readSnapshot();
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    expect(snapshot.value.turns).toHaveLength(1);
    for (const nativeRef of [f.fork.sourceRef, derivedRef]) {
      await expect(
        f.otherClient.open({ kind: "resume", cwd: f.root, nativeRef }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "sessionBusy" },
      });
    }
    await forked.value.close();
    await expect(
      f.otherClient.open({ kind: "resume", cwd: f.root, nativeRef: f.fork.sourceRef }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "sessionBusy" },
    });
    expect(sourceClose).not.toHaveBeenCalled();
    if (running) f.nativeSource.succeedTurn();
    await expect(
      f.source.execute({
        type: "turn.start",
        turnId: hostTurnIdSchema.parse("source-next"),
        input: [{ type: "text", text: "next" }],
      }),
    ).resolves.toMatchObject({ ok: true });
    f.nativeSource.succeedTurn();
  },
);

it("preserves the source writer after a failed Fork and allows a subsequent valid Fork", async () => {
  const f = await fixture();
  await expect(
    f.client.open({
      ...f.fork,
      checkpoint: { ...f.fork.checkpoint, checkpointId: "missing" },
    }),
  ).resolves.toMatchObject({ ok: false, error: { code: "checkpointNotFound" } });
  await expect(
    f.otherClient.open({ kind: "resume", cwd: f.root, nativeRef: f.fork.sourceRef }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "sessionBusy" },
  });
  await expect(f.client.open(f.fork)).resolves.toMatchObject({ ok: true });
});

it("still rejects a Fork that would claim the source's existing write identity", async () => {
  const f = await fixture();
  const colliding = new FakeHarnessSession(
    f.native.harnessId,
    f.native.catalog,
    undefined,
    f.fork.sourceRef,
  );
  const close = vi.spyOn(colliding, "close");
  const sourceClose = vi.spyOn(f.nativeSource, "close");
  f.open.mockResolvedValueOnce({ ok: true, value: colliding });
  await expect(f.client.open(f.fork)).resolves.toMatchObject({
    ok: false,
    error: { code: "sessionBusy" },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(sourceClose).not.toHaveBeenCalled();
  await expect(
    f.otherClient.open({ kind: "resume", cwd: f.root, nativeRef: f.fork.sourceRef }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "sessionBusy" },
  });
});
