import type { JsonObject } from "@codexhost/protocol-core";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import type { SideChatCollectionStore } from "./side-chat-library.js";

function record(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep the native Fork response intact; only metadata is stored outside the native owner. */
export async function forkOfficialSideChat(
  params: JsonObject,
  options: {
    store: SideChatCollectionStore;
    requestOfficial(method: string, params: JsonObject): Promise<JsonObject>;
    assertScope(): void;
    now?(): Date;
  },
): Promise<JsonObject> {
  const sourceId = hostThreadIdSchema.safeParse(params.threadId);
  if (!sourceId.success || (params.path !== undefined && params.path !== null)) {
    return { error: { code: -32602, message: "A side chat must reference its source Thread ID" } };
  }
  try {
    options.assertScope();
    await options.store.listSideChatCollection();
  } catch {
    return {
      error: { code: -32081, message: "Side chat metadata is unavailable; no chat was created" },
    };
  }
  options.assertScope();
  const sourceResponse = await options.requestOfficial("thread/read", {
    threadId: sourceId.data,
    includeTurns: false,
  });
  if (record(sourceResponse.error)) return sourceResponse;
  const source =
    record(sourceResponse.result) && record(sourceResponse.result.thread)
      ? sourceResponse.result.thread
      : null;
  if (!source || source.id !== sourceId.data)
    return { error: { code: -32080, message: "The side chat source could not be verified" } };
  const historyMode = source.historyMode ?? "legacy";
  if (historyMode !== "legacy" && historyMode !== "paginated")
    return { error: { code: -32080, message: "The source history mode is unsupported" } };
  options.assertScope();
  const response = await options.requestOfficial("thread/fork", {
    ...params,
    attachToSource: historyMode === "paginated",
    ephemeral: false,
  });
  if (record(response.error)) return response;
  const child =
    record(response.result) && record(response.result.thread) ? response.result.thread : null;
  const childId = hostThreadIdSchema.safeParse(child?.id);
  const failure = (message: string): JsonObject => ({
    error: {
      code: -32081,
      message,
      data: {
        createdThreadId: childId.success ? childId.data : null,
        sourceThreadId: sourceId.data,
        nativeResult: response.result ?? null,
      },
    },
  });
  if (
    !childId.success ||
    childId.data === sourceId.data ||
    child?.ephemeral === true ||
    (typeof child?.forkedFromId === "string" && child.forkedFromId !== sourceId.data)
  ) {
    return failure(
      "Native Fork returned an unexpected side chat identity; its response has been retained",
    );
  }
  try {
    options.assertScope();
    await options.store.registerSideChatOrigin({
      threadId: childId.data,
      sourceThreadId: sourceId.data,
      projectId:
        typeof source.projectId === "string" && source.projectId.trim() ? source.projectId : null,
      registeredAt: (options.now?.() ?? new Date()).toISOString(),
    });
    options.assertScope();
  } catch {
    return failure(
      `Side chat ${childId.data} was created, but its source link could not be confirmed. The chat was retained; do not retry the Fork automatically.`,
    );
  }
  return response;
}
