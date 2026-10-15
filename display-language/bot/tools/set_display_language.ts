import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  configureDisplayLanguage,
  DISPLAY_LANGUAGE_CODES,
  resolveRepo,
} from "../lib/display-language.js";

export default defineTool({
  description:
    "Set this repository's display language to one supported code. Call once.",
  effect: "write",
  inputSchema: z.object({
    code: z.enum(DISPLAY_LANGUAGE_CODES).describe("Supported display language code."),
  }),
  async execute({ code }, ctx) {
    if (ctx.session.purpose === "eval") {
      return { posted: false, reason: "eval", code };
    }
    const repo = resolveRepo(ctx.session.continuationKey ?? undefined);
    const record = await configureDisplayLanguage({
      kv: ctx.host.kv,
      repo,
      code,
      now: new Date().toISOString(),
    });
    return {
      posted: false,
      repo,
      code: record.code,
      name: record.name,
      updatedAt: record.updatedAt,
    };
  },
});
