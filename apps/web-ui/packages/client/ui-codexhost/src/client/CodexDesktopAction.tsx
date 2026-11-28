import { useEffect, useState } from "react";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { Toast, Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import css from "./CodexDesktopAction.module.css";

/** Desktop shell bridge to the official Codex Desktop, injected on the live Web page only. */
interface CodexDesktopBridge {
  isInstalled(): Promise<boolean>;
  open(): Promise<void>;
}

declare global {
  interface Window {
    __codexhostCodexDesktop?: Partial<CodexDesktopBridge>;
  }
}

function getCodexDesktopBridge(): CodexDesktopBridge | undefined {
  const candidate = window.__codexhostCodexDesktop;
  return typeof candidate?.isInstalled === "function" && typeof candidate.open === "function"
    ? (candidate as CodexDesktopBridge)
    : undefined;
}

function failureDetail(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "";
}

/**
 * Opens the official Codex Desktop from the CodexHost desktop window, or brings
 * it forward when it already runs. This window keeps its page.
 */
export function CodexDesktopAction({
  wide,
  t,
}: PropsRuntime<"sidebar.footer.action"> & PropsLocale<"codexhostImport">) {
  const bridge = getCodexDesktopBridge();
  const [installed, setInstalled] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<{ seq: number; text: string } | null>(null);

  useEffect(() => {
    if (bridge === undefined) return;
    let active = true;
    bridge.isInstalled().then(
      (value) => {
        if (active) setInstalled(value);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [bridge]);

  if (bridge === undefined || !installed) return null;

  const label = t(opening ? "codexDesktop.opening" : "codexDesktop.open");
  const open = (): void => {
    setOpening(true);
    bridge.open().then(
      () => {
        setOpening(false);
      },
      (error: unknown) => {
        setOpening(false);
        const text = t("codexDesktop.failed", { detail: failureDetail(error) }).trim();
        setFailure((previous) => ({ seq: (previous?.seq ?? 0) + 1, text }));
      },
    );
  };

  return (
    <>
      <Tooltip disabled={wide} label={label}>
        <button
          type="button"
          className={css.trigger}
          data-wide={wide}
          aria-label={label}
          aria-busy={opening}
          disabled={opening}
          onClick={open}
        >
          <span className={css.icon} aria-hidden="true">
            <svg
              width={wide ? 16 : 18}
              height={wide ? 16 : 18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
            </svg>
          </span>
          {wide ? <span className={css.label}>{label}</span> : null}
        </button>
      </Tooltip>
      {failure ? (
        <Toast
          key={failure.seq}
          text={failure.text}
          holdMs={6000}
          onDone={() => {
            setFailure(null);
          }}
        />
      ) : null}
    </>
  );
}
