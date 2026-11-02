import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SideChatUiDiagnostics } from "@codexhost/shared-contracts";

export async function writeSideChatUiDiagnostics(
  dataDirectory: string,
  value: SideChatUiDiagnostics,
) {
  const directory = path.join(dataDirectory, "diagnostics");
  const file = path.join(directory, "sidechat-ui.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
