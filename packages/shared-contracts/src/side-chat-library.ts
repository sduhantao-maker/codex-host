import { z } from "zod";
import { hostThreadIdSchema } from "./ids.js";

export const SIDE_CHAT_LIST_METHOD = "codexhost/sideChat/list";
export const SIDE_CHAT_UPDATE_METHOD = "codexhost/sideChat/update";
export const SIDE_CHAT_UI_DIAGNOSTICS_METHOD = "codexhost/sideChat/uiDiagnostics";

const byte = z.number().int().min(0).max(255);
const dimension = z.number().min(0).max(10_000);
const sideChatUiMetricsSchema = z
  .object({
    fontSize: dimension,
    fontWeight: z.number().min(0).max(1000),
    color: z.tuple([byte, byte, byte, byte]),
    lineHeight: dimension,
    height: dimension,
    paddingLeft: dimension,
  })
  .strict();
const sideChatUiComparisonSchema = z
  .object({
    native: sideChatUiMetricsSchema,
    sidechat: sideChatUiMetricsSchema,
  })
  .strict();
export const sideChatUiDiagnosticsSchema = z
  .object({
    heading: sideChatUiComparisonSchema,
    row: sideChatUiComparisonSchema,
  })
  .strict();
export type SideChatUiDiagnostics = z.infer<typeof sideChatUiDiagnosticsSchema>;

export const sideChatListParamsSchema = z
  .object({ sourceThreadId: hostThreadIdSchema.optional(), collected: z.boolean().optional() })
  .strict();

export const sideChatUpdateParamsSchema = z
  .object({
    threadId: hostThreadIdSchema,
    collected: z.boolean(),
    archived: z.boolean().optional(),
  })
  .strict();

export const sideChatLibraryItemSchema = z
  .object({
    threadId: hostThreadIdSchema,
    sourceThreadId: hostThreadIdSchema,
    projectId: z.string().min(1).nullable(),
    title: z.string(),
    preview: z.string().max(80).optional(),
    updatedAt: z.number().int().nonnegative().optional(),
    collected: z.boolean(),
    sourceAvailable: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const sideChatListResultSchema = z.object({ items: z.array(sideChatLibraryItemSchema) });
export const sideChatUpdateResultSchema = z.object({ item: sideChatLibraryItemSchema });
export type SideChatLibraryItem = z.infer<typeof sideChatLibraryItemSchema>;
export type SideChatListParams = z.infer<typeof sideChatListParamsSchema>;
export type SideChatUpdateParams = z.infer<typeof sideChatUpdateParamsSchema>;
