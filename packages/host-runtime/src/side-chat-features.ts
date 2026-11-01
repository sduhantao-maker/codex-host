import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SIDE_CHAT_FEATURES,
  sideChatFeaturesSchema,
  sideChatFeaturesSetParamsSchema,
  type SideChatFeatures,
} from "@codexhost/shared-contracts";

/** Cached settings: Desktop request admission never reads configuration from disk. */
export class SideChatFeaturesStore {
  readonly file: string;
  #value: SideChatFeatures = { ...DEFAULT_SIDE_CHAT_FEATURES };
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(
    environment: NodeJS.ProcessEnv,
    private readonly changed: () => void,
    private readonly diagnose: (error: unknown) => void,
  ) {
    this.file = path.join(
      environment.CODEXHOST_DATA_DIR
        ? path.resolve(environment.CODEXHOST_DATA_DIR)
        : path.join(os.homedir(), ".codexhost"),
      "sidechat-features.json",
    );
  }
  get value(): SideChatFeatures {
    return { ...this.#value };
  }
  #apply(value: SideChatFeatures): void {
    if (JSON.stringify(value) === JSON.stringify(this.#value)) return;
    this.#value = value;
    this.changed();
  }
  async reload(): Promise<void> {
    try {
      this.#apply(sideChatFeaturesSchema.parse(JSON.parse(await readFile(this.file, "utf8"))));
    } catch (error) {
      this.#apply({ ...DEFAULT_SIDE_CHAT_FEATURES });
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        this.diagnose(error);
    }
  }
  async initialize(): Promise<void> {
    await this.reload();
    try {
      this.#watcher = watch(path.dirname(this.file), { persistent: false }, (_event, name) => {
        if (name && name.toString() !== path.basename(this.file)) return;
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
          this.#tail = this.#tail.then(() => this.reload());
        }, 25);
        this.#timer.unref();
      });
      this.#watcher.on("error", (error) => {
        this.#apply({ ...DEFAULT_SIDE_CHAT_FEATURES });
        this.diagnose(error);
      });
    } catch (error) {
      this.diagnose(error);
    }
  }
  set(input: unknown): Promise<SideChatFeatures> {
    const patch = sideChatFeaturesSetParamsSchema.parse(input);
    const update = this.#tail.then(async () => {
      const value = sideChatFeaturesSchema.parse({ ...this.#value, ...patch });
      const temporary = this.file + ".tmp-" + randomUUID();
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
      this.#apply(value);
      return this.value;
    });
    this.#tail = update.catch((error: unknown) => {
      this.#apply({ ...DEFAULT_SIDE_CHAT_FEATURES });
      this.diagnose(error);
    });
    return update;
  }
  close(): void {
    clearTimeout(this.#timer);
    this.#watcher?.close();
  }
}
