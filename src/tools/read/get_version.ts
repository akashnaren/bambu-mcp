import { bind, type ToolDef } from "../types.js";
import { noArgs } from "../schema.js";

export const getVersion: ToolDef = {
  name: "get_version",
  gate: "read",
  create(ctx) {
    return bind(getVersion, {
      description:
        "Read module hardware and software versions (MQTT info.get_version). Serial numbers are omitted.",
      inputSchema: noArgs,
      handler: async () => ctx.port.getVersion(),
    });
  },
};
