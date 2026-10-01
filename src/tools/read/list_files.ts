import { z } from "zod";
import { bind, type ToolDef } from "../types.js";

export const listFiles: ToolDef = {
  name: "list_files",
  gate: "read",
  create(ctx) {
    return bind(listFiles, {
      description: "List files on the printer FTPS cache.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Remote directory. Default /"),
      }),
      handler: async (args) => {
        if (!ctx.capabilities.ftps) return { supported: false, files: [] };
        return { files: await ctx.port.listFiles(typeof args.dir === "string" ? args.dir : "/") };
      },
    });
  },
};
