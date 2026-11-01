import { CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID, type JsonObject } from "@codexhost/protocol-core";
import { FakeHarnessAdapter } from "@codexhost/harness-adapter/testing";
import { harnessIdSchema } from "@codexhost/shared-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createFixture,
  requestId,
  startExternalThread,
  startPiTurn,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

const clientId = "replay-steering-user";
const input = "SYNTHETIC_STEERING_REPLACEMENT";

async function scenario(nativeSteer: boolean) {
  const adapter = new FakeHarnessAdapter(harnessIdSchema.parse("claude-code"));
  adapter.supportsSteer = nativeSteer;
  const fixture = createFixture({ externalAdapters: new Map([["claude-code", adapter]]) });
  const threadId = await startExternalThread(fixture, CLAUDE_CODE_NATIVE_TRANSPORT_MODEL_ID);
  const oldTurnId = await startPiTurn(fixture, threadId);
  const session = adapter.sessions[0];
  if (!session) throw new Error("Synthetic Session was not opened");
  const execute = vi.spyOn(session, "execute");
  const submit = () => {
    // The current native main-RPC route sends no codexhostSteerDelivery annotation.
    writeRequest(fixture.desktopInput, {
      id: 30,
      method: "turn/steer",
      params: {
        threadId,
        expectedTurnId: oldTurnId,
        clientUserMessageId: clientId,
        input: [{ type: "text", text: input }],
      },
    });
    return fixture.collector.waitFor((message) => requestId(message, 30));
  };
  return { fixture, threadId, oldTurnId, session, execute, submit };
}

function userItems(messages: JsonObject[], turnId?: string) {
  return messages.flatMap((message) => {
    const params = message.params as JsonObject | undefined;
    const item = params?.item as JsonObject | undefined;
    return (message.method === "item/started" || message.method === "item/completed") &&
      item?.type === "userMessage" &&
      (turnId === undefined || params?.turnId === turnId)
      ? [item]
      : [];
  });
}

describe("diagnosis: current main-RPC steering replacement", () => {
  it("acknowledges a replacement but never confirms the old-Turn client message", async () => {
    const f = await scenario(false);
    try {
      const response = f.submit();
      await vi.waitFor(() =>
        expect(f.execute).toHaveBeenCalledWith(
          expect.objectContaining({ type: "turn.cancel", turnId: f.oldTurnId }),
        ),
      );
      expect(f.fixture.collector.messages.some((message) => requestId(message, 30))).toBe(false);
      expect(f.execute).not.toHaveBeenCalledWith(expect.objectContaining({ type: "turn.start" }));
      f.session.completeCancellation();
      const reply = await response;
      expect(reply.error).toBeUndefined();
      expect(reply.result).toMatchObject({ delivery: "newTurn", turnId: expect.any(String) });
      const newTurnId = (reply.result as JsonObject).turnId;
      if (typeof newTurnId !== "string") throw new Error("Missing real replacement identity");
      expect(newTurnId).not.toBe(f.oldTurnId);
      await f.fixture.collector.waitFor((message) => turnEvent(message, "turn/started", newTurnId));
      f.session.appendText("SYNTHETIC_REPLACEMENT_REPLY");
      f.session.succeedTurn();
      await f.fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", newTurnId),
      );

      const messages = f.fixture.collector.messages;
      const oldTerminalIndex = messages.findIndex((message) =>
        turnEvent(message, "turn/completed", f.oldTurnId),
      );
      const responseIndex = messages.findIndex((message) => requestId(message, 30));
      const newStartIndex = messages.findIndex((message) =>
        turnEvent(message, "turn/started", newTurnId),
      );
      expect((messages[oldTerminalIndex]?.params as JsonObject).turn).toMatchObject({
        id: f.oldTurnId,
        status: "interrupted",
      });
      expect(oldTerminalIndex).toBeLessThan(responseIndex);
      expect(responseIndex).toBeLessThan(newStartIndex);
      expect(userItems(messages).filter((item) => item.clientId === clientId)).toEqual([]);
      expect(f.session.persistedSnapshot().turns.at(-1)?.input).toEqual([
        { type: "text", text: input },
      ]);
      expect(messages.filter((message) => requestId(message, 30))).toEqual([reply]);
    } finally {
      await stopFixture(f.fixture);
    }
  });

  it("can start native replacement before Desktop consumes the buffered old terminal", async () => {
    const f = await scenario(false);
    try {
      f.fixture.desktopOutput.pause();
      f.session.completeCancellationOnRequest();
      const response = f.submit();
      await vi.waitFor(() =>
        expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "turn.start" })),
      );
      expect(
        f.fixture.collector.messages.some((message) =>
          turnEvent(message, "turn/completed", f.oldTurnId),
        ),
      ).toBe(false);
      expect(f.fixture.collector.messages.some((message) => requestId(message, 30))).toBe(false);
      // writeBytes resolves when write() accepts the frame, not after a Desktop listener consumes it.
      f.fixture.desktopOutput.resume();
      const reply = await response;
      expect(reply).toMatchObject({ result: { delivery: "newTurn" } });
      const newTurnId = String((reply.result as JsonObject).turnId);
      await f.fixture.collector.waitFor((message) => turnEvent(message, "turn/started", newTurnId));
      f.session.appendText("SYNTHETIC_REPLACEMENT_REPLY");
      f.session.succeedTurn();
      await f.fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", newTurnId),
      );
    } finally {
      f.fixture.desktopOutput.resume();
      await stopFixture(f.fixture);
    }
  });

  it("confirms the same client message on the original Turn when native steer is available", async () => {
    const f = await scenario(true);
    try {
      expect(await f.submit()).toMatchObject({
        result: { delivery: "activeTurn", turnId: f.oldTurnId },
      });
      expect(f.execute).not.toHaveBeenCalledWith(expect.objectContaining({ type: "turn.cancel" }));
      expect(userItems(f.fixture.collector.messages, f.oldTurnId)).toEqual([
        expect.objectContaining({ clientId }),
        expect.objectContaining({ clientId }),
      ]);
      f.session.appendText("SYNTHETIC_SAME_TURN_REPLY");
      f.session.succeedTurn();
      await f.fixture.collector.waitFor((message) =>
        turnEvent(message, "turn/completed", f.oldTurnId),
      );
    } finally {
      await stopFixture(f.fixture);
    }
  });
});
