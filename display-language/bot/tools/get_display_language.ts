import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  DISPLAY_LANGUAGE_CODES,
  loadDisplayLanguage,
  resolveRepo,
} from "../lib/display-language.js";

export default defineTool({
  description: "Read the display language configured for this repository.",
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const repo = resolveRepo(ctx.session.continuationKey ?? undefined);
    const record = await loadDisplayLanguage(ctx.host.kv, repo);
    if (record === undefined) {
      return {
        configured: false as const,
        repo,
        supported: DISPLAY_LANGUAGE_CODES,
      };
    }
    return {
      configured: true as const,
      repo,
      code: record.code,
      name: record.name,
      updatedAt: record.updatedAt,
    };
  },
});
