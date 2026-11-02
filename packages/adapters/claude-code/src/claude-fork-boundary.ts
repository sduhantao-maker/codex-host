function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const CLAUDE_ACTIVE_SIDECHAT_CHECKPOINT = {
  kind: "codexhost.claude-active-sidechat",
  version: 1,
} as const;

function records(values: readonly unknown[]): Map<string, Record<string, unknown>> {
  const entries = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    if (!isRecord(value)) throw new Error("Invalid Claude Fork history");
    if (value.isSidechain === true || typeof value.uuid !== "string") continue;
    if (
      (value.type === "user" || value.type === "assistant") &&
      (!isRecord(value.message) || value.message.role !== value.type)
    )
      throw new Error("Invalid Claude Fork message");
    entries.set(value.uuid, value);
  }
  return entries;
}

/** Follow native parent links; append order also contains discarded retry branches. */
function parentChain(
  entries: ReadonlyMap<string, Record<string, unknown>>,
  checkpointId: string,
): Record<string, unknown>[] | null {
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let current = checkpointId;
  while (!seen.has(current)) {
    seen.add(current);
    const entry = entries.get(current);
    if (!entry) return null;
    if (entry.type === "user" || entry.type === "assistant") chain.push(entry);
    if (entry.parentUuid === null) return chain.reverse();
    if (typeof entry.parentUuid !== "string" || !entry.parentUuid) return null;
    current = entry.parentUuid;
  }
  return null;
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

/** Only opt-in active side chats require a complete tool prefix on the selected native branch. */
export function claudeForkPrefix(
  values: readonly unknown[],
  checkpointId: string,
): unknown[] | null {
  const entries = records(values);
  const checkpoint = entries.get(checkpointId);
  if (checkpoint?.type !== "user" && checkpoint?.type !== "assistant") return null;
  const prefix = parentChain(entries, checkpointId);
  if (!prefix) return null;
  const pending = new Set<string>();
  for (const message of prefix) updatePendingTools(message, pending);
  return pending.size === 0 ? prefix : null;
}

/** An in-flight assistant record is not a stable boundary until native stop_reason is present. */
export function selectClaudeActiveForkCheckpoint(
  values: readonly unknown[],
  userMessageId: string,
): string | null {
  const entries = records(values);
  const latest = [...entries.values()].findLast(
    (entry) => entry.type === "user" || entry.type === "assistant",
  );
  if (typeof latest?.uuid !== "string") return null;
  const messages = parentChain(entries, latest.uuid);
  if (!messages) return null;
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
