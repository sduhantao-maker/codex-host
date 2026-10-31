function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mainMessages(values: readonly unknown[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const value of values) {
    if (!isRecord(value)) throw new Error("Invalid Claude Fork history");
    if (value.isSidechain === true || (value.type !== "user" && value.type !== "assistant"))
      continue;
    if (
      typeof value.uuid !== "string" ||
      !isRecord(value.message) ||
      value.message.role !== value.type
    )
      throw new Error("Invalid Claude Fork message");
    messages.push(value);
  }
  return messages;
}

function updatePendingTools(message: Record<string, unknown>, pending: Set<string>): void {
  if (!isRecord(message.message) || !Array.isArray(message.message.content)) return;
  for (const block of message.message.content) {
    if (!isRecord(block)) continue;
    if (
      block.type === "tool_use" ||
      block.type === "server_tool_use" ||
      block.type === "mcp_tool_use"
    ) {
      if (typeof block.id !== "string" || pending.has(block.id))
        throw new Error("Invalid Claude tool identity");
      pending.add(block.id);
    } else if (typeof block.tool_use_id === "string") {
      if (!pending.delete(block.tool_use_id))
        throw new Error("Claude tool result has no matching call");
    }
  }
}

/** Native Forks must retain complete tool call/result pairs, even while their source keeps running. */
export function claudeForkPrefix(
  values: readonly unknown[],
  checkpointId: string,
): unknown[] | null {
  const messages = mainMessages(values);
  const end = messages.findIndex((message) => message.uuid === checkpointId);
  if (end < 0) return null;
  const prefix = messages.slice(0, end + 1);
  const pending = new Set<string>();
  for (const message of prefix) updatePendingTools(message, pending);
  return pending.size === 0 ? prefix : null;
}

/** An in-flight assistant record is not a stable boundary until native stop_reason is present. */
export function selectClaudeActiveForkCheckpoint(
  values: readonly unknown[],
  userMessageId: string,
): string | null {
  const messages = mainMessages(values);
  const userIndex = messages.findIndex(
    (message) => message.type === "user" && message.uuid === userMessageId,
  );
  if (userIndex < 0) return null;
  const pending = new Set<string>();
  let checkpoint: string | null = null;
  for (const [index, message] of messages.entries()) {
    updatePendingTools(message, pending);
    if (index < userIndex || pending.size !== 0) continue;
    const body = message.message;
    if (
      message.type === "user" ||
      (isRecord(body) && typeof body.stop_reason === "string" && body.stop_reason.length > 0)
    ) {
      checkpoint = message.uuid as string;
    }
  }
  return checkpoint;
}
