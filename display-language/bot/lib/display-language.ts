export const BOT_NAME = "display-language";

export const WATCHED_REPOS = ["circleJ/jk_test"] as const;

export const DISPLAY_LANGUAGES = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  pt: "Português",
} as const;

export const DISPLAY_LANGUAGE_CODES = [
  "en",
  "es",
  "fr",
  "de",
  "ja",
  "zh",
  "ko",
  "pt",
] as const;

export type DisplayLanguageCode = keyof typeof DISPLAY_LANGUAGES;

export type DisplayLanguageRecord = {
  code: DisplayLanguageCode;
  name: string;
  updatedAt: string;
};

export type DisplayLanguageIntent =
  | { kind: "set"; code: DisplayLanguageCode }
  | { kind: "show" }
  | { kind: "unsupported"; requested: string }
  | { kind: "unclear" }
  | { kind: "ignore" };

export type Wake = "task" | "auth" | "skip";

export interface DisplayLanguageKv {
  get(key: string): Promise<unknown>;
  put(key: string, value: DisplayLanguageRecord): Promise<void>;
}

const ALIASES: Record<string, DisplayLanguageCode> = {
  en: "en",
  "en-us": "en",
  english: "en",
  es: "es",
  "es-es": "es",
  spanish: "es",
  español: "es",
  espanol: "es",
  fr: "fr",
  "fr-fr": "fr",
  french: "fr",
  français: "fr",
  francais: "fr",
  de: "de",
  "de-de": "de",
  german: "de",
  deutsch: "de",
  ja: "ja",
  "ja-jp": "ja",
  japanese: "ja",
  日本語: "ja",
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  chinese: "zh",
  中文: "zh",
  ko: "ko",
  "ko-kr": "ko",
  korean: "ko",
  한국어: "ko",
  pt: "pt",
  "pt-br": "pt",
  "pt-pt": "pt",
  portuguese: "pt",
  português: "pt",
  portugues: "pt",
};

const LANGUAGE_MENTION = /display language|locale|idioma/i;
const SET_VERBS = /\b(configure|set|change|update|switch|use)\b/i;
const SHOW_VERBS = /\b(what|show|get|current|which)\b/i;
const ASSIGNMENT =
  /(?:display language|locale|idioma)\s*(?:to|=|:)\s*([^\s,.;!?]+)/i;
const PROXIMITY =
  /(?:display language|locale|idioma)\s+([^\s,.;!?]+)/i;
const BOT_MENTION = /@display-language\b/i;
const OUTBOUND_MARKER = "<!-- agent-serve-github -->";
const CONTINUATION =
  /^(?:cont:)?github-(?:issue|pr):([^/\s#]+)\/([^#\s]+)#\d+$/;

const ISSUE_ACTIONS = new Set(["opened", "edited", "reopened"]);
const PULL_REQUEST_ACTIONS = new Set([
  "opened",
  "edited",
  "reopened",
  "ready_for_review",
]);

export function supportedCatalog(): string {
  return DISPLAY_LANGUAGE_CODES.map(
    (code) => `${code} (${DISPLAY_LANGUAGES[code]})`,
  ).join(", ");
}

export function languageKey(repo: string): string {
  return `display-language:${repo.toLowerCase()}`;
}

export function parseDisplayLanguageIntent(text: string): DisplayLanguageIntent {
  if (!LANGUAGE_MENTION.test(text)) {
    return { kind: "ignore" };
  }

  const assignment = text.match(ASSIGNMENT);
  if (assignment?.[1] !== undefined) {
    return intentForRequested(assignment[1], text);
  }

  const proximity = text.match(PROXIMITY);
  if (proximity?.[1] !== undefined && ALIASES[normalizeToken(proximity[1])]) {
    return intentForRequested(proximity[1], text);
  }

  if (SHOW_VERBS.test(text)) {
    return { kind: "show" };
  }
  if (SET_VERBS.test(text)) {
    return { kind: "unclear" };
  }
  return { kind: "ignore" };
}

export function applyDisplayLanguage(input: {
  text: string;
  current: DisplayLanguageRecord | undefined;
  now: string;
}): {
  intent: DisplayLanguageIntent;
  record: DisplayLanguageRecord | undefined;
  comment: string;
  changed: boolean;
} {
  const intent = parseDisplayLanguageIntent(input.text);
  if (intent.kind === "set") {
    if (input.current?.code === intent.code) {
      return {
        intent,
        record: input.current,
        comment: formatSet(input.current),
        changed: false,
      };
    }
    const record: DisplayLanguageRecord = {
      code: intent.code,
      name: DISPLAY_LANGUAGES[intent.code],
      updatedAt: input.now,
    };
    return { intent, record, comment: formatSet(record), changed: true };
  }
  if (intent.kind === "show") {
    return {
      intent,
      record: input.current,
      comment: input.current ? formatSet(input.current) : formatUnset(),
      changed: false,
    };
  }
  if (intent.kind === "unsupported") {
    return {
      intent,
      record: input.current,
      comment: `Unsupported display language "${intent.requested}". Supported: ${supportedCatalog()}`,
      changed: false,
    };
  }
  if (intent.kind === "unclear") {
    return {
      intent,
      record: input.current,
      comment: `Name a supported display language. Supported: ${supportedCatalog()}`,
      changed: false,
    };
  }
  return { intent, record: input.current, comment: "", changed: false };
}

export function decideIssueWake(input: {
  repo: string;
  action: string;
  title: string;
  body?: string;
}): Wake {
  if (!isWatchedRepo(input.repo) || !ISSUE_ACTIONS.has(input.action)) {
    return "skip";
  }
  return wakeForIntent(
    parseDisplayLanguageIntent(`${input.title}\n${input.body ?? ""}`),
  );
}

export function decideCommentWake(input: {
  repo: string;
  body: string;
  authorLogin?: string;
}): Wake {
  if (!isWatchedRepo(input.repo) || isOwnComment(input.authorLogin, input.body)) {
    return "skip";
  }
  const intent = parseDisplayLanguageIntent(input.body);
  if (
    BOT_MENTION.test(input.body) &&
    (intent.kind === "ignore" || intent.kind === "unclear")
  ) {
    return "auth";
  }
  return wakeForIntent(intent);
}

export function decidePullRequestWake(input: {
  repo: string;
  action: string;
  title: string;
  body?: string;
  draft: boolean;
}): Wake {
  if (
    input.draft ||
    !isWatchedRepo(input.repo) ||
    !PULL_REQUEST_ACTIONS.has(input.action)
  ) {
    return "skip";
  }
  return wakeForIntent(
    parseDisplayLanguageIntent(`${input.title}\n${input.body ?? ""}`),
  );
}

export function repoFromContinuationKey(key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }
  const match = CONTINUATION.exec(key);
  if (match === null) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

export function resolveRepo(key: string | undefined): string {
  const parsed = repoFromContinuationKey(key);
  if (parsed === undefined) {
    return WATCHED_REPOS[0];
  }
  const match = WATCHED_REPOS.find(
    (repo) => repo.toLowerCase() === parsed.toLowerCase(),
  );
  if (match === undefined) {
    throw new Error(`Repository ${parsed} is not watched`);
  }
  return match;
}

export async function loadDisplayLanguage(
  kv: DisplayLanguageKv,
  repo: string,
): Promise<DisplayLanguageRecord | undefined> {
  const value = await kv.get(languageKey(repo));
  if (!isDisplayLanguageRecord(value)) {
    return undefined;
  }
  return value;
}

export async function configureDisplayLanguage(input: {
  kv: DisplayLanguageKv;
  repo: string;
  code: DisplayLanguageCode;
  now: string;
}): Promise<DisplayLanguageRecord> {
  const current = await loadDisplayLanguage(input.kv, input.repo);
  if (current?.code === input.code) {
    return current;
  }
  const record: DisplayLanguageRecord = {
    code: input.code,
    name: DISPLAY_LANGUAGES[input.code],
    updatedAt: input.now,
  };
  await input.kv.put(languageKey(input.repo), record);
  return record;
}

export async function applyAndStore(input: {
  kv: DisplayLanguageKv;
  repo: string;
  text: string;
  now: string;
}): Promise<string> {
  const current = await loadDisplayLanguage(input.kv, input.repo);
  const result = applyDisplayLanguage({
    text: input.text,
    current,
    now: input.now,
  });
  if (result.changed && result.record) {
    await input.kv.put(languageKey(input.repo), result.record);
  }
  return result.comment;
}

export function isWatchedRepo(repo: string): boolean {
  const normalized = repo.toLowerCase();
  return WATCHED_REPOS.some((watched) => watched.toLowerCase() === normalized);
}

function intentForRequested(requested: string, text: string): DisplayLanguageIntent {
  const token = normalizeToken(requested);
  const code = ALIASES[token];
  const others = codesIn(text).filter((item) => item !== code);
  if (code !== undefined && others.length > 0) {
    return { kind: "unclear" };
  }
  if (code !== undefined) {
    return { kind: "set", code };
  }
  return { kind: "unsupported", requested: token };
}

function codesIn(text: string): DisplayLanguageCode[] {
  const found: DisplayLanguageCode[] = [];
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) {
    const code = ALIASES[token];
    if (code !== undefined && !found.includes(code)) {
      found.push(code);
    }
  }
  return found;
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[("'「]+|[)"'」]+$/g, "");
}

function wakeForIntent(intent: DisplayLanguageIntent): Wake {
  if (intent.kind === "ignore") {
    return "skip";
  }
  if (intent.kind === "unclear") {
    return "auth";
  }
  return "task";
}

function isOwnComment(login: string | undefined, body: string): boolean {
  if (body.includes(OUTBOUND_MARKER)) {
    return true;
  }
  if (login === undefined) {
    return false;
  }
  const normalized = login.toLowerCase();
  return normalized === BOT_NAME || normalized === `${BOT_NAME}[bot]`;
}

function formatSet(record: DisplayLanguageRecord): string {
  return `Display language: ${record.code} (${record.name})`;
}

function formatUnset(): string {
  return `Display language is not set. Supported: ${supportedCatalog()}`;
}

function isDisplayLanguageRecord(value: unknown): value is DisplayLanguageRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<DisplayLanguageRecord>;
  if (typeof record.code !== "string" || typeof record.updatedAt !== "string") {
    return false;
  }
  if (!isDisplayLanguageCode(record.code)) {
    return false;
  }
  return record.name === DISPLAY_LANGUAGES[record.code];
}

function isDisplayLanguageCode(code: string): code is DisplayLanguageCode {
  return Object.prototype.hasOwnProperty.call(DISPLAY_LANGUAGES, code);
}
