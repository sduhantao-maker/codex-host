/** General Settings row choosing one Sidebar Browser preference. */
import { useRef, useState } from "react";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { IconChevronDownOutlineRegular, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SidebarBrowserKey } from "../locales.ts";
import css from "./BrowserChoiceRow.module.css";

/** Registration-side values for one preference row. */
export interface BrowserChoiceRowInjected {
  hooks: {
    /** Current choice, bound as useChoice. */
    choice: ObservableSnapshot<string>;
  };
  readonly title: SidebarBrowserKey;
  readonly description: SidebarBrowserKey;
  readonly choices: readonly { readonly id: string; readonly label: SidebarBrowserKey }[];
  /** Apply and persist one choice. */
  choose: (id: string) => void;
}

/** Full Settings-row props. */
export type BrowserChoiceRowProps = PropsRuntime<"settings.general.item"> &
  PropsLocale<"sidebarBrowser"> &
  InjectFace<BrowserChoiceRowInjected>;

/**
 * Render a preference label and its menu; selection restores focus before publishing the choice.
 * @param props - composed Settings slot props.
 * @returns the settings row.
 */
export function BrowserChoiceRow({
  useChoice,
  title,
  description,
  choices,
  choose,
  t,
}: BrowserChoiceRowProps) {
  const value = useChoice((current) => current);
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLButtonElement>(null);
  const selected = choices.find((choice) => choice.id === value) ?? choices[0];
  const closeMenu = () => {
    setOpen(false);
  };
  const selector = (
    <button
      ref={selectorRef}
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => {
        setOpen((current) => !current);
      }}
    >
      {selected === undefined ? "" : t(selected.label)}
      <IconChevronDownOutlineRegular className={css.chevron} />
    </button>
  );

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={choices.map((choice) => ({ id: choice.id, label: t(choice.label) }))}
        selectedId={value}
        onSelect={(id: string) => {
          selectorRef.current?.focus({ preventScroll: true });
          closeMenu();
          choose(id);
        }}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  );
}
