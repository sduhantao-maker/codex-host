import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import {
  BROWSER_SETTINGS_NAMESPACE,
  BrowserSettingsFields,
  DEFAULT_BROWSER_ADDRESS_OPENING,
  DEFAULT_BROWSER_SEARCH_ENGINE,
} from "../src/browser-settings.ts";

interface SchemaNode {
  readonly dict?: Record<string, number>;
  readonly list?: readonly number[];
  readonly [field: string]: unknown;
}

interface SerializedSchema {
  readonly uid: number;
  readonly refs: Record<string, SchemaNode>;
}

/** Inline every reference so two serializations compare by shape, not by uid numbering. */
function expand(schema: SerializedSchema, uid = schema.uid): unknown {
  const node = schema.refs[String(uid)];
  if (node === undefined) throw new Error(`missing schema ref ${String(uid)}`);
  return {
    ...node,
    ...(node.dict === undefined
      ? {}
      : {
          dict: Object.fromEntries(
            Object.entries(node.dict).map(([key, ref]) => [key, expand(schema, ref)]),
          ),
        }),
    ...(node.list === undefined ? {} : { list: node.list.map((ref) => expand(schema, ref)) }),
  };
}

describe("sidebar browser settings", () => {
  it("matches the namespace the Web server describes", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../../../../packages/web-server/fixtures/settings-namespaces.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{ ns: string; schema: SerializedSchema; base: unknown }>;
    const entry = fixture.find((namespace) => namespace.ns === BROWSER_SETTINGS_NAMESPACE);
    const client = z.object(BrowserSettingsFields).default({}) as unknown as {
      toJSON(): SerializedSchema;
    };

    expect(entry).toBeDefined();
    expect(expand(entry!.schema)).toEqual(expand(client.toJSON()));
    expect(entry!.base).toEqual({
      searchEngine: DEFAULT_BROWSER_SEARCH_ENGINE,
      addressOpening: DEFAULT_BROWSER_ADDRESS_OPENING,
    });
  });
});
