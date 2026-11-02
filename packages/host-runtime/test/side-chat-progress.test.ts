import type { JsonObject } from "@codexhost/protocol-core";
import { expect, it, vi } from "vitest";
import {
  createFixture,
  requestId,
  startExternalThread,
  stopFixture,
  turnEvent,
  writeRequest,
} from "./app-server-host-fixture.js";

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
