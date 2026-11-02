import { describe, expect, it, vi } from "vitest";
import { SharedThreadBridge } from "../src/shared-thread-bridge.js";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  createFixture,
  startPiThread,
  startExternalThread,
  completePiTurn,
  requestId,
  writeRequest,
  stopFixture,
} from "./app-server-host-fixture.js";

function rpc(
  fixture: ReturnType<typeof createFixture>,
  id: number,
  method: string,
  params: JsonObject,
) {
  writeRequest(fixture.desktopInput, { id, method, params });
  return fixture.collector.waitFor((message) => requestId(message, id));
}

describe("sidechat library diagnostic fallbacks", () => {
  it("keeps local collected rows when an older shared peer does not implement the sidechat API", async () => {
    const bridge = new SharedThreadBridge({
      connect: async () => {
        throw new Error("unused peer connection");
      },
      delegateCreates: false,
      diagnose: () => undefined,
    });
    vi.spyOn(bridge, "sideChats").mockRejectedValue(
      new Error("Method not found: codexhost/sideChat/list"),
    );
    const fixture = createFixture({
      sharedThreads: bridge,
      sideChatFeatures: { persistentSideChats: true, sideChatLibrary: true },
    });
    try {
      const parentId = await startPiThread(fixture);
      await completePiTurn(fixture, parentId, 2);
      const fork = await rpc(fixture, 3, "thread/fork", {
        threadId: parentId,
        attachToSource: true,
      });
      const childId = hostThreadIdSchema.parse(
        ((fork.result as JsonObject).thread as JsonObject).id,
      );
      await rpc(fixture, 4, "codexhost/sideChat/update", { threadId: childId, collected: true });
      const result = await rpc(fixture, 5, "codexhost/sideChat/list", { collected: true });
      expect(result).toMatchObject({
        result: {
          items: [expect.objectContaining({ threadId: childId, sourceThreadId: parentId })],
        },
      });
      expect(fixture.diagnosticOutput.read()?.toString()).toContain("Method not found");
    } finally {
      await stopFixture(fixture);
    }
  });

  it("diagnoses a corrupt local index without affecting ordinary native requests", async () => {
    const fixture = createFixture({ sideChatFeatures: { sideChatLibrary: true } });
    try {
      await fixture.ready;
      vi.spyOn(fixture.mappingStore, "listSideChatCollection").mockRejectedValue(
        new Error("synthetic corrupt sidechat index"),
      );
      expect(await rpc(fixture, 1, "codexhost/sideChat/list", {})).toHaveProperty("error");
      expect(fixture.diagnosticOutput.read()?.toString()).toContain(
        "synthetic corrupt sidechat index",
      );
      const parentId = await startExternalThread(fixture, "codexhost/pi-native", 2);
      await completePiTurn(fixture, parentId, 3);
    } finally {
      await stopFixture(fixture);
    }
  });
});
