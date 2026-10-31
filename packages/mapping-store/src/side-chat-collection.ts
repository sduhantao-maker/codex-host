import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { hostThreadIdSchema } from "@codexhost/shared-contracts";
import { z } from "zod";

export const storedSideChatCollectionEntrySchema = z
  .object({
    threadId: hostThreadIdSchema,
    sourceThreadId: hostThreadIdSchema,
    projectId: z.string().min(1).max(1_024).nullable(),
    collectedAt: z.string().datetime({ offset: true }).optional(),
    registeredAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough()
  .refine((entry) => entry.threadId !== entry.sourceThreadId, {
    message: "A side chat cannot be its own source",
  })
  .refine((entry) => entry.collectedAt !== undefined || entry.registeredAt !== undefined, {
    message: "A side chat must have a registration or collection timestamp",
  });

export type StoredSideChatCollectionEntry = z.infer<typeof storedSideChatCollectionEntrySchema>;

const collectionFileSchema = z
  .object({
    formatVersion: z.literal(1),
    entries: z.array(storedSideChatCollectionEntrySchema),
  })
  .passthrough()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    for (const [index, entry] of file.entries.entries()) {
      if (ids.has(entry.threadId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "threadId"],
          message: "Duplicate side chat",
        });
      }
      ids.add(entry.threadId);
    }
  });

export type StoredSideChatCollectionFile = z.infer<typeof collectionFileSchema>;

export async function readSideChatCollectionFile(
  file: string,
): Promise<StoredSideChatCollectionFile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
      return { formatVersion: 1, entries: [] };
    throw error;
  }
  // Unknown formats are left intact; collection errors must never erase chat history or newer metadata.
  return collectionFileSchema.parse(JSON.parse(text));
}

export async function writeSideChatCollectionFile(
  file: string,
  value: StoredSideChatCollectionFile,
): Promise<void> {
  const parsed = collectionFileSchema.parse(value);
  const temporary = `${file}.tmp-${randomUUID()}`;
  let handle: FileHandle | null = null;
  try {
    handle = await open(temporary, "wx", constants.S_IRUSR | constants.S_IWUSR);
    await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
