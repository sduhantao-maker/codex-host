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
    diagnose?(error: unknown): void;
    now?(): Date;
  },
): Promise<JsonObject> {
  const sourceId = hostThreadIdSchema.safeParse(params.threadId);
  if (!sourceId.success || (params.path !== undefined && params.path !== null)) {
    return { error: { code: -32602, message: "A side chat must reference its source Thread ID" } };
  }
  const diagnose = (error: unknown): void => {
    try {
      options.diagnose?.(error);
    } catch {
      /* Diagnostics must not stop native operations. */
    }
  };
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
  if (historyMode !== "legacy" && historyMode !== "paginated") {
    diagnose(new Error("Unknown side chat history mode; using native Fork parameters"));
    options.assertScope();
    return options.requestOfficial("thread/fork", params);
  }
  let metadataAvailable = true;
  try {
    await options.store.listSideChatCollection();
  } catch (error) {
    metadataAvailable = false;
    diagnose(error);
  }
  options.assertScope();
  const nativeParams = metadataAvailable
    ? { ...params, attachToSource: historyMode === "paginated", ephemeral: false }
    : historyMode === "legacy"
      ? // Renderer persistence rewriting must not send an unsupported attachment to legacy history.
        { ...params, attachToSource: false, ephemeral: true }
      : params;
  const response = await options.requestOfficial("thread/fork", nativeParams);
  if (record(response.error)) return response;
  options.assertScope();
  if (!metadataAvailable) return response;
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
    (typeof child?.forkedFromId === "string" && child.forkedFromId !== sourceId.data)
  ) {
    return failure(
      "Native Fork returned an unexpected side chat identity; its response has been retained",
    );
  }
  if (child?.ephemeral === true) {
    diagnose(new Error("Native side chat remained ephemeral; no origin was registered"));
    return response;
  }
  try {
    const entry = {
      threadId: childId.data,
      sourceThreadId: sourceId.data,
      projectId:
        typeof source.projectId === "string" && source.projectId.trim() ? source.projectId : null,
      registeredAt: (options.now?.() ?? new Date()).toISOString(),
    };
    const delays = [250, 1_000];
    const register = async (attempt: number): Promise<void> => {
      try {
        options.assertScope();
      } catch (error) {
        diagnose(error);
        return;
      }
      try {
        await options.store.registerSideChatOrigin(entry);
      } catch (error) {
        diagnose(error);
        const delay = delays[attempt];
        if (delay !== undefined) {
          const timer = setTimeout(() => {
            void register(attempt + 1);
          }, delay);
          timer.unref();
        }
      }
    };
    // A successful native Fork is acknowledged independently of optional organization metadata.
    void register(0);
  } catch (error) {
    diagnose(error);
  }
  return response;
}
