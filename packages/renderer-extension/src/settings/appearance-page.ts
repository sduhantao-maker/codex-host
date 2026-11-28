import {
  REASONING_SOFT_WRAP_CHANGE_EVENT,
  readReasoningTranscriptSoftWrap,
  setReasoningTranscriptSoftWrap,
} from "../renderer-transcript-dom.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import type { RendererSettingsMessages } from "./localization.js";
import { mountIdleReleaseControls } from "./idle-release-controls.js";
import type { LoadedSessionsClient } from "./loaded-sessions-table.js";
import {
  createPreferenceGroup,
  createPreferenceItem,
  createPreferenceSwitch,
  preferenceId,
} from "./preference-ui.js";

/** Opens the CodexHost window, or brings it forward; Codex Desktop keeps its page. */
function desktopShellGroup(
  document: Document,
  messages: RendererSettingsMessages,
  openDesktopShell: () => Promise<unknown>,
): HTMLElement {
  const { group, card } = createPreferenceGroup(document, messages.desktopShellGroup);
  const buttonId = preferenceId("desktop-shell-open");
  const row = createPreferenceItem(document, {
    title: messages.desktopShellTitle,
    description: messages.desktopShellDescription,
    controlId: buttonId,
  });
  const button = document.createElement("button");
  button.type = "button";
  button.id = buttonId;
  button.className = "settings-command-button settings-command-button--secondary shrink-0";
  button.textContent = messages.desktopShellOpen;
  button.setAttribute("aria-describedby", row.description.id);
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = messages.desktopShellOpening;
    row.description.dataset.invalid = "false";
    row.description.textContent = messages.desktopShellDescription;
    void openDesktopShell()
      .catch((error: unknown) => {
        row.description.dataset.invalid = "true";
        row.description.textContent = `${messages.desktopShellFailed}: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        button.disabled = false;
        button.textContent = messages.desktopShellOpen;
      });
  });
  row.item.append(button);
  card.append(row.item);
  return group;
}

export function createAppearanceSettingsPage(
  messages: RendererSettingsMessages,
  getLoadedSessionsClient: () => LoadedSessionsClient | null = () => null,
  getOpenDesktopShell: () => (() => Promise<unknown>) | undefined = () => undefined,
): RendererSettingsPageDefinition {
  return Object.freeze({
    id: "appearance",
    label: messages.pageLabels.appearance,
    icon: "settings",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const ownerWindow = document.defaultView;
      if (!ownerWindow) return;
      const heading = document.createElement("div");
      heading.className = "settings-section-label";
      heading.textContent = messages.pageLabels.appearance;

      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = messages.appearanceDescription;

      // Without a Host client there is nothing to open the window through.
      const openDesktopShell = getOpenDesktopShell();
      const desktopShell = openDesktopShell
        ? desktopShellGroup(document, messages, openDesktopShell)
        : null;

      const { group, card } = createPreferenceGroup(document, messages.appearanceGroup);
      const softWrapId = preferenceId("reasoning-soft-wrap");
      const row = createPreferenceItem(document, {
        title: messages.reasoningSoftWrapTitle,
        description: messages.reasoningSoftWrapDescription,
        controlId: softWrapId,
      });
      const toggle = createPreferenceSwitch(document, softWrapId, row.description.id);
      toggle.checked = readReasoningTranscriptSoftWrap(ownerWindow);
      toggle.addEventListener("change", () => {
        setReasoningTranscriptSoftWrap(ownerWindow, toggle.checked);
      });
      const sync = (): void => {
        toggle.checked = readReasoningTranscriptSoftWrap(ownerWindow);
      };
      ownerWindow.addEventListener(REASONING_SOFT_WRAP_CHANGE_EVENT, sync);
      row.item.append(toggle);
      card.append(row.item);

      context.content.append(heading, description, ...(desktopShell ? [desktopShell] : []), group);
      const disposeIdleRelease = mountIdleReleaseControls(
        context,
        messages,
        getLoadedSessionsClient,
      );
      return () => {
        ownerWindow.removeEventListener(REASONING_SOFT_WRAP_CHANGE_EVENT, sync);
        disposeIdleRelease();
      };
    },
  });
}
