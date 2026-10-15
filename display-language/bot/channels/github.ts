import { defaultGitHubAuth, githubChannel } from "@cursor/bdk/channels/github";
import {
  applyAndStore,
  BOT_NAME,
  decideCommentWake,
  decideIssueWake,
  WATCHED_REPOS,
} from "../lib/display-language.js";

const CLARIFY = [
  "No supported language was named.",
  "Call get_display_language, list the supported codes, and ask which one to set.",
  "Do not call set_display_language until one supported code is clear.",
];

export default githubChannel({
  botName: BOT_NAME,
  // Issues and issue comments share github.issue/v2. Pull request events are
  // outside that membership and would stamp a fresh session on every delivery.
  webhookEvents: ["issues", "issue_comment"],
  cursorAccount: {
    repos: WATCHED_REPOS,
    permissions: "pr-write",
  },
  onPullRequest: () => null,
  onIssue: (ctx, issue) => {
    const wake = decideIssueWake({
      repo: ctx.repository.fullName,
      action: issue.action,
      title: issue.title,
      body: issue.body,
    });
    if (wake === "skip") {
      return null;
    }
    if (wake === "auth") {
      return { auth: defaultGitHubAuth(ctx), context: CLARIFY };
    }
    return {
      task: () =>
        storeAndPost(ctx, `${issue.title}\n${issue.body ?? ""}`),
    };
  },
  onComment: (ctx, comment) => {
    const wake = decideCommentWake({
      repo: ctx.repository.fullName,
      body: comment.body,
      authorLogin: comment.author?.login,
    });
    if (wake === "skip") {
      return null;
    }
    if (wake === "auth") {
      return { auth: defaultGitHubAuth(ctx), context: CLARIFY };
    }
    return { task: () => storeAndPost(ctx, comment.body) };
  },
});

async function storeAndPost(
  ctx: {
    host: { kv: Parameters<typeof applyAndStore>[0]["kv"] };
    repository: { fullName: string };
    thread: { post(message: string): Promise<unknown> };
  },
  text: string,
): Promise<void> {
  const comment = await applyAndStore({
    kv: ctx.host.kv,
    repo: ctx.repository.fullName,
    text,
    now: new Date().toISOString(),
  });
  if (comment.length > 0) {
    await ctx.thread.post(comment);
  }
}
