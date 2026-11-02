import type { StoredSideChatCollectionEntry } from "@codexhost/mapping-store";
import type { JsonObject } from "@codexhost/protocol-core";
import {
  hostThreadIdSchema,
  sideChatListParamsSchema,
  sideChatUpdateParamsSchema,
  type HostThreadId,
  type SideChatLibraryItem,
  type SideChatListParams,
  type SideChatUpdateParams,
} from "@codexhost/shared-contracts";

export interface SideChatCollectionStore {
  listSideChatCollection(): Promise<StoredSideChatCollectionEntry[]>;
  registerSideChatOrigin(entry: StoredSideChatCollectionEntry): Promise<void>;
  setSideChatCollected(
    threadId: HostThreadId,
    entry: StoredSideChatCollectionEntry | null,
  ): Promise<void>;
}

export interface SideChatLibraryOptions {
  store: SideChatCollectionStore;
  /** These readers must enforce the current Host/account's Thread ownership. */
  readThread(threadId: HostThreadId): Promise<JsonObject | null>;
  readPreview?(threadId: HostThreadId, assertScope: () => void): Promise<string | undefined>;
  listAttached(sourceThreadId: HostThreadId): Promise<JsonObject[]>;
  now?(): Date;
}

export function sideChatPreviewText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/gu, " ").trim().slice(0, 80);
  // Avoid splitting a surrogate pair at the display limit.
  return text.replace(/[\uD800-\uDBFF]$/u, "") || undefined;
}

function id(value: unknown): HostThreadId | null {
  const parsed = hostThreadIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function origin(
  row: JsonObject,
): { sourceThreadId: HostThreadId; projectId?: string; external: boolean } | null {
  const stored = row.codexhostSideChatOrigin;
  if (stored !== undefined) {
    if (
      row.modelProvider !== "codexhost" ||
      !stored ||
      typeof stored !== "object" ||
      Array.isArray(stored)
    )
      return null;
    const sourceThreadId = id(stored.threadId);
    if (
      !sourceThreadId ||
      (stored.projectId !== undefined &&
        (typeof stored.projectId !== "string" || !stored.projectId.trim()))
    )
      return null;
    return {
      sourceThreadId,
      external: true,
      ...(typeof stored.projectId === "string" && stored.projectId.trim()
        ? { projectId: stored.projectId }
        : {}),
    };
  }
  const sourceThreadId = id(row.forkedFromId);
  return sourceThreadId ? { sourceThreadId, external: false } : null;
}

export class SideChatLibrary {
  constructor(private readonly options: SideChatLibraryOptions) {}

  async #read(threadId: HostThreadId): Promise<JsonObject | null> {
    const row = await this.options.readThread(threadId).catch(() => null);
    return row?.id === threadId ? row : null;
  }

  async #attached(sourceThreadId: HostThreadId): Promise<Set<HostThreadId>> {
    const rows = await this.options.listAttached(sourceThreadId).catch(() => []);
    return new Set(
      rows.flatMap((row) => {
        const threadId = id(row.id);
        return threadId ? [threadId] : [];
      }),
    );
  }

  async #item(
    threadId: HostThreadId,
    saved: StoredSideChatCollectionEntry | undefined,
    source?: { id: HostThreadId; row: JsonObject | null; attached: Set<HostThreadId> },
    listScope?: () => void,
  ): Promise<SideChatLibraryItem | null> {
    const row = await this.#read(threadId);
    if (!row) return null;
    const provenance =
      origin(row) ??
      (saved?.registeredAt &&
      row.modelProvider !== "codexhost" &&
      row.codexhostSideChatOrigin === undefined
        ? {
            sourceThreadId: saved.sourceThreadId,
            projectId: saved.projectId ?? undefined,
            external: false,
          }
        : null);
    if (!provenance || provenance.sourceThreadId === threadId) return null;
    if (source && provenance.sourceThreadId !== source.id) return null;
    if (saved && saved.sourceThreadId !== provenance.sourceThreadId) return null;
    const parent = source ? source.row : await this.#read(provenance.sourceThreadId);
    const attached =
      source?.attached ??
      (!provenance.external && (!saved || (saved.archived && row.codexhostArchived === undefined))
        ? await this.#attached(provenance.sourceThreadId)
        : undefined);
    if (!provenance.external && !saved) {
      if (!attached?.has(threadId)) return null;
    }
    const projectId = !parent
      ? null
      : typeof parent.projectId === "string" && parent.projectId.trim()
        ? parent.projectId
        : parent.projectId === null
          ? null
          : (provenance.projectId ?? saved?.projectId ?? null);
    const title = [row.name, row.title].find((value) => typeof value === "string" && value.trim());
    listScope?.();
    const preview = listScope
      ? provenance.external
        ? await this.options.readPreview?.(threadId, listScope).catch(() => undefined)
        : sideChatPreviewText(row.preview)
      : undefined;
    const updatedAt = row.updatedAt;
    return {
      threadId,
      sourceThreadId: provenance.sourceThreadId,
      projectId,
      title: typeof title === "string" ? title : "Side chat",
      ...(preview ? { preview } : {}),
      ...(typeof updatedAt === "number" && Number.isSafeInteger(updatedAt) && updatedAt >= 0
        ? { updatedAt }
        : {}),
      collected: saved?.collectedAt !== undefined,
      ...(row.codexhostArchived === true ||
      (row.codexhostArchived === undefined && !attached?.has(threadId) && saved?.archived)
        ? { archived: true }
        : {}),
      ...(!parent ? { sourceAvailable: false } : {}),
    };
  }

  async list(
    input: SideChatListParams = {},
    assertScope: () => void = () => {},
  ): Promise<{ items: SideChatLibraryItem[] }> {
    assertScope();
    const params = sideChatListParamsSchema.parse(input);
    const entries = await this.options.store.listSideChatCollection();
    const saved = new Map(entries.map((entry) => [entry.threadId, entry]));
    if (!params.sourceThreadId) {
      if (params.collected === false) return { items: [] };
      const items = await Promise.all(
        entries
          .filter((entry) => entry.collectedAt !== undefined)
          .map((entry) => this.#item(entry.threadId, entry, undefined, assertScope)),
      );
      assertScope();
      return {
        items: items.filter((item): item is SideChatLibraryItem => item !== null && !item.archived),
      };
    }
    const parent = await this.#read(params.sourceThreadId);
    const source = {
      id: params.sourceThreadId,
      row: parent,
      attached: await this.#attached(params.sourceThreadId),
    };
    const candidates = new Set([
      ...source.attached,
      ...entries
        .filter((entry) => entry.sourceThreadId === source.id)
        .map((entry) => entry.threadId),
    ]);
    const items = await Promise.all(
      [...candidates].map((threadId) =>
        this.#item(threadId, saved.get(threadId), source, assertScope),
      ),
    );
    assertScope();
    return {
      items: items.filter(
        (item): item is SideChatLibraryItem =>
          item !== null && (params.collected === undefined || item.collected === params.collected),
      ),
    };
  }

  async update(
    input: SideChatUpdateParams,
    assertScope: () => void = () => {},
  ): Promise<{ item: SideChatLibraryItem }> {
    assertScope();
    const params = sideChatUpdateParamsSchema.parse(input);
    const saved = (await this.options.store.listSideChatCollection()).find(
      (entry) => entry.threadId === params.threadId,
    );
    const item = await this.#item(params.threadId, saved);
    assertScope();
    if (!item) throw new Error("Side chat or its source is unavailable");
    await this.options.store.setSideChatCollected(params.threadId, {
      threadId: item.threadId,
      sourceThreadId: item.sourceThreadId,
      projectId: item.projectId,
      registeredAt:
        saved?.registeredAt ??
        saved?.collectedAt ??
        (this.options.now?.() ?? new Date()).toISOString(),
      ...(params.archived !== undefined
        ? { archived: params.archived }
        : saved?.archived !== undefined
          ? { archived: item.archived === true }
          : {}),
      ...(params.collected
        ? { collectedAt: saved?.collectedAt ?? (this.options.now?.() ?? new Date()).toISOString() }
        : {}),
    });
    assertScope();
    return {
      item: {
        ...item,
        collected: params.collected,
        ...(params.archived !== undefined ? { archived: params.archived } : {}),
      },
    };
  }
}
