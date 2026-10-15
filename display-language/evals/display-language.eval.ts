import { defineEval } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "set-es",
      description: "An explicit language configures the display language.",
      async test(t) {
        await t.send("Configure display language to es");
        t.succeeded();
        t.calledTool("set_display_language", { input: { code: "es" } });
        t.notCalledTool("get_display_language");
      },
    },
    {
      id: "ask",
      description: "Configure Display Language with no code asks instead of guessing.",
      async test(t) {
        await t.send("Configure Display Language");
        t.succeeded();
        t.calledTool("get_display_language");
        t.notCalledTool("set_display_language");
      },
    },
  ],
});
