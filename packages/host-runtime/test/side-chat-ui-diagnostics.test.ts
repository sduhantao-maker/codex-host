import { readFile } from "node:fs/promises";
import path from "node:path";
import { SIDE_CHAT_UI_DIAGNOSTICS_METHOD } from "@codexhost/shared-contracts";
import { expect, it } from "vitest";
import { createFixture, requestId, stopFixture, writeRequest } from "./app-server-host-fixture.js";

const metrics = {
  fontSize: 14,
  fontWeight: 500,
  color: [26, 28, 31, 128],
  lineHeight: 21,
  height: 25,
  paddingLeft: 4,
};
const params = {
  heading: { native: metrics, sidechat: metrics },
  row: { native: metrics, sidechat: { ...metrics, height: 30 } },
};

it.each([true, false])(
  "only writes numeric side chat UI diagnostics with the library enabled (%s)",
  async (enabled) => {
    const fixture = createFixture({ sideChatFeatures: { sideChatLibrary: enabled } });
    const file = path.join(fixture.mappingStoreDirectory, "diagnostics", "sidechat-ui.json");
    try {
      writeRequest(fixture.desktopInput, {
        id: 1,
        method: SIDE_CHAT_UI_DIAGNOSTICS_METHOD,
        params,
      });
      const response = await fixture.collector.waitFor((message) => requestId(message, 1));
      if (!enabled) {
        expect(response).toMatchObject({ error: { code: -32601 } });
        await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
        return;
      }
      expect(response).toMatchObject({ result: {} });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(params);
      writeRequest(fixture.desktopInput, {
        id: 2,
        method: SIDE_CHAT_UI_DIAGNOSTICS_METHOD,
        params: { ...params, title: "never log text" },
      });
      expect(await fixture.collector.waitFor((message) => requestId(message, 2))).toMatchObject({
        error: { code: -32602 },
      });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(params);
    } finally {
      await stopFixture(fixture);
    }
  },
);
