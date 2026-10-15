import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAndStore,
  applyDisplayLanguage,
  configureDisplayLanguage,
  decideCommentWake,
  decideIssueWake,
  decidePullRequestWake,
  languageKey,
  loadDisplayLanguage,
  parseDisplayLanguageIntent,
  repoFromContinuationKey,
  resolveRepo,
  supportedCatalog,
} from "../bot/lib/display-language.js";

const NOW = "2026-10-15T03:30:00.000Z";
const CATALOG =
  "en (English), es (Español), fr (Français), de (Deutsch), ja (日本語), zh (中文), ko (한국어), pt (Português)";

function memoryKv() {
  const store = new Map<string, unknown>();
  return {
    store,
    async get(key: string) {
      return store.get(key);
    },
    async put(key: string, value: unknown) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe("parseDisplayLanguageIntent", () => {
  it("sets an explicit code from Configure Display Language", () => {
    assert.deepEqual(parseDisplayLanguageIntent("Configure Display Language to es"), {
      kind: "set",
      code: "es",
    });
  });

  it("sets a language name and a BCP-47 alias", () => {
    assert.deepEqual(parseDisplayLanguageIntent("Configure Display Language: Español"), {
      kind: "set",
      code: "es",
    });
    assert.deepEqual(parseDisplayLanguageIntent("set locale to ja-JP"), {
      kind: "set",
      code: "ja",
    });
    assert.deepEqual(parseDisplayLanguageIntent("display language zh-CN"), {
      kind: "set",
      code: "zh",
    });
    assert.deepEqual(parseDisplayLanguageIntent("use display language english"), {
      kind: "set",
      code: "en",
    });
  });

  it("treats a bare Configure Display Language as unclear", () => {
    assert.deepEqual(parseDisplayLanguageIntent("Configure Display Language"), {
      kind: "unclear",
    });
  });

  it("rejects an unknown language and keeps the requested token", () => {
    assert.deepEqual(
      parseDisplayLanguageIntent("Configure the display language to Klingon."),
      { kind: "unsupported", requested: "klingon" },
    );
  });

  it("asks to show the current language", () => {
    assert.deepEqual(parseDisplayLanguageIntent("What is the current display language?"), {
      kind: "show",
    });
    assert.deepEqual(parseDisplayLanguageIntent("get display language"), { kind: "show" });
  });

  it("ignores unrelated text and casual mentions", () => {
    assert.deepEqual(parseDisplayLanguageIntent("3. Hello jenkins"), { kind: "ignore" });
    assert.deepEqual(parseDisplayLanguageIntent("the display language looks fine"), {
      kind: "ignore",
    });
  });

  it("is unclear when two languages are named", () => {
    assert.deepEqual(parseDisplayLanguageIntent("set display language to en and es"), {
      kind: "unclear",
    });
  });
});

describe("applyDisplayLanguage", () => {
  it("stores a new language and confirms it", () => {
    const result = applyDisplayLanguage({ text: "locale=fr", current: undefined, now: NOW });
    assert.equal(result.changed, true);
    assert.deepEqual(result.record, { code: "fr", name: "Français", updatedAt: NOW });
    assert.equal(result.comment, "Display language: fr (Français)");
  });

  it("does not rewrite an unchanged language", () => {
    const current = { code: "fr" as const, name: "Français", updatedAt: "2020-01-01T00:00:00.000Z" };
    const result = applyDisplayLanguage({
      text: "set display language to fr",
      current,
      now: NOW,
    });
    assert.equal(result.changed, false);
    assert.equal(result.record, current);
    assert.equal(result.comment, "Display language: fr (Français)");
  });

  it("replaces a different language", () => {
    const current = { code: "en" as const, name: "English", updatedAt: "2020-01-01T00:00:00.000Z" };
    const result = applyDisplayLanguage({
      text: "change display language to de",
      current,
      now: NOW,
    });
    assert.equal(result.changed, true);
    assert.deepEqual(result.record, { code: "de", name: "Deutsch", updatedAt: NOW });
  });

  it("reports the current language or the catalog when unset", () => {
    const unset = applyDisplayLanguage({
      text: "show display language",
      current: undefined,
      now: NOW,
    });
    assert.equal(unset.changed, false);
    assert.equal(unset.record, undefined);
    assert.equal(unset.comment, `Display language is not set. Supported: ${CATALOG}`);

    const current = { code: "ko" as const, name: "한국어", updatedAt: NOW };
    const shown = applyDisplayLanguage({ text: "which display language", current, now: NOW });
    assert.equal(shown.comment, "Display language: ko (한국어)");
    assert.equal(shown.record, current);
  });

  it("does not replace the current language when the request is unsupported or unclear", () => {
    const current = { code: "pt" as const, name: "Português", updatedAt: NOW };
    const unsupported = applyDisplayLanguage({
      text: "set locale to klingon",
      current,
      now: NOW,
    });
    assert.equal(unsupported.changed, false);
    assert.equal(unsupported.record, current);
    assert.equal(
      unsupported.comment,
      `Unsupported display language "klingon". Supported: ${CATALOG}`,
    );

    const unclear = applyDisplayLanguage({
      text: "Configure Display Language",
      current,
      now: NOW,
    });
    assert.equal(unclear.changed, false);
    assert.equal(unclear.record, current);
    assert.equal(unclear.comment, `Name a supported display language. Supported: ${CATALOG}`);
  });
});

describe("wake decisions", () => {
  it("runs a task for an explicit issue request and a model turn when the code is missing", () => {
    assert.equal(
      decideIssueWake({
        repo: "circleJ/jk_test",
        action: "opened",
        title: "Configure Display Language to es",
      }),
      "task",
    );
    assert.equal(
      decideIssueWake({
        repo: "circleJ/jk_test",
        action: "opened",
        title: "Configure Display Language",
      }),
      "auth",
    );
    assert.equal(
      decideIssueWake({
        repo: "circleJ/jk_test",
        action: "edited",
        title: "status",
        body: "what is the display language?",
      }),
      "task",
    );
  });

  it("skips closed issues, unrelated issues, and other repositories", () => {
    assert.equal(
      decideIssueWake({
        repo: "circleJ/jk_test",
        action: "closed",
        title: "Configure Display Language to es",
      }),
      "skip",
    );
    assert.equal(
      decideIssueWake({
        repo: "circleJ/jk_test",
        action: "opened",
        title: "Hello jenkins",
      }),
      "skip",
    );
    assert.equal(
      decideIssueWake({
        repo: "other/repo",
        action: "opened",
        title: "Configure Display Language to es",
      }),
      "skip",
    );
  });

  it("routes comments by mention, intent, and author", () => {
    assert.equal(
      decideCommentWake({
        repo: "circleJ/jk_test",
        body: "@display-language please help",
        authorLogin: "octocat",
      }),
      "auth",
    );
    assert.equal(
      decideCommentWake({
        repo: "circleJ/jk_test",
        body: "set display language to pt",
        authorLogin: "octocat",
      }),
      "task",
    );
    assert.equal(
      decideCommentWake({
        repo: "circleJ/jk_test",
        body: "thanks",
        authorLogin: "octocat",
      }),
      "skip",
    );
    assert.equal(
      decideCommentWake({
        repo: "circleJ/jk_test",
        body: "@display-language set locale to es",
        authorLogin: "display-language[bot]",
      }),
      "skip",
    );
    assert.equal(
      decideCommentWake({
        repo: "circleJ/jk_test",
        body: "Display language: es (Español)\n<!-- agent-serve-github -->",
        authorLogin: "octocat",
      }),
      "skip",
    );
  });

  it("skips draft and synchronize pull requests", () => {
    assert.equal(
      decidePullRequestWake({
        repo: "circleJ/jk_test",
        action: "opened",
        title: "Configure Display Language to ja",
        draft: true,
      }),
      "skip",
    );
    assert.equal(
      decidePullRequestWake({
        repo: "circleJ/jk_test",
        action: "synchronize",
        title: "Configure Display Language to ja",
        draft: false,
      }),
      "skip",
    );
    assert.equal(
      decidePullRequestWake({
        repo: "circleJ/jk_test",
        action: "ready_for_review",
        title: "Configure Display Language",
        draft: false,
      }),
      "auth",
    );
  });
});

describe("storage", () => {
  it("keys the language by repository and round-trips a write", async () => {
    assert.equal(languageKey("CircleJ/jk_test"), "display-language:circlej/jk_test");
    assert.equal(supportedCatalog(), CATALOG);
    const kv = memoryKv();
    const saved = await configureDisplayLanguage({
      kv,
      repo: "circleJ/jk_test",
      code: "es",
      now: NOW,
    });
    assert.deepEqual(saved, { code: "es", name: "Español", updatedAt: NOW });
    assert.deepEqual(await loadDisplayLanguage(kv, "circleJ/jk_test"), saved);

    const again = await configureDisplayLanguage({
      kv,
      repo: "circleJ/jk_test",
      code: "es",
      now: "2026-10-16T00:00:00.000Z",
    });
    assert.equal(again, saved);
    assert.equal(kv.store.size, 1);

    const comment = await applyAndStore({
      kv,
      repo: "circleJ/jk_test",
      text: "Configure Display Language to ja",
      now: "2026-10-16T00:00:00.000Z",
    });
    assert.equal(comment, "Display language: ja (日本語)");
    assert.deepEqual(await loadDisplayLanguage(kv, "circleJ/jk_test"), {
      code: "ja",
      name: "日本語",
      updatedAt: "2026-10-16T00:00:00.000Z",
    });
  });

  it("resolves the repo from a GitHub continuation key", () => {
    assert.equal(
      repoFromContinuationKey("cont:github-issue:circleJ/jk_test#12"),
      "circleJ/jk_test",
    );
    assert.equal(repoFromContinuationKey("github-pr:circleJ/jk_test#4"), "circleJ/jk_test");
    assert.equal(repoFromContinuationKey(undefined), undefined);
    assert.equal(resolveRepo(undefined), "circleJ/jk_test");
    assert.equal(resolveRepo("cont:github-issue:circleJ/jk_test#3"), "circleJ/jk_test");
    assert.throws(() => resolveRepo("github-issue:other/repo#1"), /not watched/);
  });
});
