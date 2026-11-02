import { z } from "zod";

export const SIDE_CHAT_FEATURES_GET_METHOD = "codexhost/sideChat/features/get";
export const SIDE_CHAT_FEATURES_SET_METHOD = "codexhost/sideChat/features/set";
export const SIDE_CHAT_FEATURES_CHANGED_METHOD = "codexhost/sideChat/features/changed";
export const DEFAULT_SIDE_CHAT_FEATURES = {
  persistentSideChats: false,
  sideChatLibrary: false,
  claudeActiveSideChatFork: false,
} as const;
export const sideChatFeaturesSchema = z
  .object({
    persistentSideChats: z.boolean().default(false),
    sideChatLibrary: z.boolean().default(false),
    claudeActiveSideChatFork: z.boolean().default(false),
  })
  .strict();
export const sideChatFeaturesGetParamsSchema = z
  .object({ probeId: z.string().min(1).max(128).optional() })
  .strict();
export const sideChatFeaturesSetParamsSchema = z
  .object({
    persistentSideChats: z.boolean().optional(),
    sideChatLibrary: z.boolean().optional(),
    claudeActiveSideChatFork: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const sideChatFeaturesResultSchema = z.object({
  settings: sideChatFeaturesSchema,
  capabilities: sideChatFeaturesSchema,
});
export type SideChatFeatures = z.infer<typeof sideChatFeaturesSchema>;
