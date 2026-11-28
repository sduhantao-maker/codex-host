import { z } from "zod";

/**
 * Opens the CodexHost desktop window through the local Launcher, or brings the
 * running window forward with its page intact. Local Host only.
 */
export const DESKTOP_SHELL_OPEN_METHOD = "codexhost/desktop-shell/open";
export const desktopShellOpenParamsSchema = z.strictObject({});
export const desktopShellOpenResultSchema = z.strictObject({});
export type DesktopShellOpenResult = z.infer<typeof desktopShellOpenResultSchema>;
