import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const SIDE_CHAT_LIST_METHOD = "codexhost/sideChat/list";
export const SIDE_CHAT_UPDATE_METHOD = "codexhost/sideChat/update";

export const sideChatListParamsSchema = z
  .object({ sourceThreadId: hostThreadIdSchema.optional(), collected: z.boolean().optional() })
  .strict();

export const sideChatUpdateParamsSchema = z
  .object({ threadId: hostThreadIdSchema, collected: z.boolean() })
  .strict();

export const sideChatLibraryItemSchema = z
  .object({
    threadId: hostThreadIdSchema,
    sourceThreadId: hostThreadIdSchema,
    projectId: z.string().min(1).nullable(),
    title: z.string(),
    collected: z.boolean(),
    sourceAvailable: z.boolean().optional(),
  })
  .strict();

export const sideChatListResultSchema = z.object({ items: z.array(sideChatLibraryItemSchema) });
export const sideChatUpdateResultSchema = z.object({ item: sideChatLibraryItemSchema });
export type SideChatLibraryItem = z.infer<typeof sideChatLibraryItemSchema>;
export type SideChatListParams = z.infer<typeof sideChatListParamsSchema>;
export type SideChatUpdateParams = z.infer<typeof sideChatUpdateParamsSchema>;
