import {
  SIDE_CHAT_LIST_METHOD,
  SIDE_CHAT_UPDATE_METHOD,
  sideChatListResultSchema,
  sideChatUpdateResultSchema,
  type SideChatLibraryItem,
} from "@codexhost/shared-contracts";

export type SideChatEntry = SideChatLibraryItem;
export type SideChatRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function result(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("侧聊服务返回了无效数据");
  if (record(value.error))
    throw new Error(typeof value.error.message === "string" ? value.error.message : "侧聊请求失败");
  return record(value.result) ? value.result : value;
}

/** The Host index stores organization only; reads and updates never append parent context. */
export function createSideChatLibrary(request: SideChatRequest) {
  return {
    async list(sourceThreadId?: string): Promise<SideChatEntry[]> {
      const response = sideChatListResultSchema.parse(
        result(
          await request(SIDE_CHAT_LIST_METHOD, {
            ...(sourceThreadId ? { sourceThreadId } : { collected: true }),
          }),
        ),
      );
      const entries = response.items;
      if (new Set(entries.map((item) => item.threadId)).size !== entries.length)
        throw new Error("侧聊列表存在重复身份");
      if (
        entries.some(
          (item) =>
            item.threadId === item.sourceThreadId ||
            (sourceThreadId && item.sourceThreadId !== sourceThreadId),
        )
      )
        throw new Error("侧聊不属于当前主对话");
      return entries;
    },
    async collect(threadId: string, collected: boolean): Promise<SideChatEntry> {
      const response = sideChatUpdateResultSchema.parse(
        result(await request(SIDE_CHAT_UPDATE_METHOD, { threadId, collected })),
      );
      const item = response.item;
      if (
        item.threadId !== threadId ||
        item.collected !== collected ||
        item.threadId === item.sourceThreadId
      )
        throw new Error("侧聊收纳状态未确认");
      return item;
    },
    async sourceTitle(threadId: string): Promise<string | null> {
      const response = result(await request("thread/read", { threadId, includeTurns: false }));
      if (!record(response.thread) || response.thread.id !== threadId)
        throw new Error("无法确认原主对话身份");
      return typeof response.thread.name === "string" ? response.thread.name : null;
    },
    async workspaceRoot(threadId: string): Promise<string> {
      const response = result(await request("thread/read", { threadId, includeTurns: false }));
      if (
        !record(response.thread) ||
        response.thread.id !== threadId ||
        typeof response.thread.cwd !== "string" ||
        !response.thread.cwd.trim()
      )
        throw new Error("无法确认侧聊工作目录，未创建新主对话");
      return response.thread.cwd;
    },
    async projectName(projectId: string): Promise<string | null> {
      const response = result(await request("project/read", { projectId }));
      return record(response.project) &&
        response.project.id === projectId &&
        typeof response.project.name === "string"
        ? response.project.name
        : null;
    },
  };
}
