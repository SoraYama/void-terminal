import {
  CONTENT_TYPES,
  type ChatEvent,
  type ContentType,
  type ChatRequest,
  type Citation,
  type SearchResult,
  type LibraryResult,
  type Source,
  type SourceResult,
  type DocumentResult,
  type DocumentSummary,
  type Usage,
} from "../contracts";
import {
  requestByteLimit,
  MAX_TOOL_ROUNDS,
  outputLimit,
} from "./config";
import { AppError, safeError } from "./errors";
import { knowledge } from "./knowledge";
import { parseSSE } from "./sse";
import { record } from "./validation";
import { openProviderTransport, resolveProvider, type ResolvedProvider, type ProviderTransport } from "./provider";
import { expandLoreQuery, initialLoreTypes, needsNarrativeContext, loreSystemPrompt, overviewRegion } from "./lore-policy";

type Message = {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type Options = {
  key: string;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
  provider?: ResolvedProvider;
};
const MAX_CONTEXT_CHARS = 24000,
  MAX_SOURCES = 40,
  MAX_ANSWER_CHARS = 120000;
const invalidEvidence = () =>
  new AppError(
    "INVALID_EVIDENCE",
    "The knowledge service returned evidence outside the requested source boundary.",
  );
function boundedMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!record(value)) return undefined;
  const result: Record<string, unknown> = Object.create(null);
  let total = 0;
  const priorityKeys = [
    "kind",
    "outline",
    "contextUnknown",
    "schemaState",
    "testState",
    "sourceHash",
    "contextRelation",
    "relation",
    "conditions",
    "nextIds",
    "series",
    "volume",
    "speaker",
    "chunkStart",
    "chunkEnd",
  ];
  const entries = [
    ...priorityKeys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]] as const),
    ...Object.entries(value).filter(([key]) => !priorityKeys.includes(key)),
  ];
  for (const [key, item] of entries.slice(0, 24)) {
    const encoded = JSON.stringify(item);
    if (
      key.length > 128 ||
      encoded === undefined ||
      encoded.length > 2000 ||
      total + encoded.length > 4000
    )
      continue;
    result[key] = JSON.parse(encoded);
    total += encoded.length;
  }
  return Object.keys(result).length ? result : undefined;
}
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "search_corpus",
      description:
        "Search the local imported corpus, preserving the current language and snapshot. Optionally narrow types within the user-selected content filters. Use focused names/events rather than keyword bags.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, types: { type: "array", items: { type: "string", enum: CONTENT_TYPES }, minItems: 1, maxItems: CONTENT_TYPES.length } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_documents',
      description: 'Find documents containing an exact name or phrase in their title/body. Use when broad ranked search returns incidental mentions. Returns leads, not citable evidence; read discovered documents before citing them. When multiple user content filters are selected, specify one allowed type.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: CONTENT_TYPES } }, required: ['query'], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_source",
      description:
        "Read a source already returned by search, with adjacent context and related document summaries.",
      parameters: {
        type: "object",
        properties: { sourceId: { type: "string" } },
        required: ["sourceId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read an already discovered document, including dialogue branches or book metadata. Only known document ids are accepted.",
      parameters: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
        additionalProperties: false,
      },
    },
  },
];

class Evidence {
  sources: Citation[] = [];
  documents = new Map<string, DocumentSummary>();
  snapshotId: string | null;
  private chars = 0;
  constructor(private input: ChatRequest) {
    this.snapshotId = input.snapshotId ?? null;
  }
  pin(snapshot: unknown) {
    if (typeof snapshot !== "string" || !snapshot || snapshot.length > 512)
      throw invalidEvidence();
    if (this.snapshotId && this.snapshotId !== snapshot)
      throw invalidEvidence();
    this.snapshotId = snapshot;
  }
  add(items: unknown, allowance?: { sources: number; chars: number; perSourceChars?: number }): Citation[] {
    const startChars = this.chars;
    if (!Array.isArray(items) || items.length > 100) throw invalidEvidence();
    const added: Citation[] = [];
    for (const item of items) {
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 512 ||
        typeof item.documentId !== "string" ||
        item.documentId.length > 512 ||
        typeof item.title !== "string" ||
        item.title.length > 1000 ||
        typeof item.text !== "string" ||
        typeof item.path !== "string" ||
        item.path.length > 2000 ||
        typeof item.locator !== "string" ||
        item.locator.length > 1000 ||
        typeof item.sourceUrl !== "string" ||
        item.sourceUrl.length > 4000 ||
        !CONTENT_TYPES.includes(item.type as Source["type"]) ||
        item.language !== this.input.language ||
        item.snapshotId !== this.snapshotId ||
        (this.input.types?.length &&
          !this.input.types.includes(item.type as Source["type"]))
      )
        throw invalidEvidence();
      if (item.sourceUrl) {
        let url: URL;
        try {
          url = new URL(item.sourceUrl);
        } catch {
          throw invalidEvidence();
        }
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw invalidEvidence();
      }
      const prior = this.sources.find((s) => s.id === item.id);
      if (prior) {
        if (
          prior.documentId !== item.documentId ||
          prior.path !== item.path ||
          prior.locator !== item.locator
        )
          throw invalidEvidence();
        continue;
      }
      if (
        !item.text.trim() ||
        this.sources.length >= MAX_SOURCES ||
        this.chars >= MAX_CONTEXT_CHARS ||
        added.length >= (allowance?.sources ?? MAX_SOURCES) ||
        this.chars - startChars >= (allowance?.chars ?? MAX_CONTEXT_CHARS)
      )
        continue;
      const text = item.text.slice(
        0,
        Math.min(allowance?.perSourceChars ?? 2400, MAX_CONTEXT_CHARS - this.chars, (allowance?.chars ?? MAX_CONTEXT_CHARS) - (this.chars - startChars)),
      );
      this.chars += text.length;
      // Only documented fields cross into the browser/model. Arbitrary source metadata cannot inflate context.
      const citation: Citation = {
        id: item.id,
        documentId: item.documentId,
        title: item.title,
        type: item.type as Source["type"],
        language: this.input.language,
        text,
        path: item.path,
        locator: item.locator,
        sourceUrl: item.sourceUrl,
        snapshotId: this.snapshotId!,
        citation: this.sources.length + 1,
        ...(boundedMetadata(item.metadata)
          ? { metadata: boundedMetadata(item.metadata) }
          : {}),
        ...(typeof item.speaker === "string"
          ? { speaker: item.speaker.slice(0, 256) }
          : {}),
        ...(typeof item.gameVersion === "string"
          ? { gameVersion: item.gameVersion.slice(0, 128) }
          : {}),
      };
      this.sources.push(citation);
      added.push(citation);
    }
    return added;
  }
  addDocument(items: unknown, documentId: string) {
    if (!Array.isArray(items)) throw invalidEvidence();
    const known = this.sources.find(
      (source) => source.documentId === documentId,
    );
    const hit = known
      ? items.findIndex((item) => record(item) && item.id === known.id)
      : -1;
    const anchor = Math.max(0, hit);
    const selected: unknown[] = [];
    // The document endpoint returns all chunks. Consume a bounded window around
    // the discovered hit rather than treating ordinary large documents as corrupt.
    for (
      let distance = 0;
      distance < items.length && selected.length < MAX_SOURCES;
      distance++
    ) {
      const indices =
        distance === 0 ? [anchor] : [anchor - distance, anchor + distance];
      for (const index of indices) {
        if (
          index < 0 ||
          index >= items.length ||
          selected.length >= MAX_SOURCES
        )
          continue;
        const item: unknown = items[index];
        if (!record(item) || item.documentId !== documentId)
          throw invalidEvidence();
        selected.push(item);
      }
    }
    this.add(selected);
    const sources = this.sources.filter(
      (source) => source.documentId === documentId,
    );
    return {
      sources,
      selection: {
        totalSources: items.length,
        selectedSources: sources.length,
        truncated: sources.length < items.length,
      },
    };
  }
  related(items: unknown): DocumentSummary[] {
    if (!Array.isArray(items) || items.length > 100) throw invalidEvidence();
    const related: DocumentSummary[] = [];
    for (const item of items) {
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 512 ||
        typeof item.title !== "string" ||
        item.title.length > 1000 ||
        typeof item.excerpt !== "string" ||
        item.language !== this.input.language ||
        item.snapshotId !== this.snapshotId ||
        !CONTENT_TYPES.includes(item.type as Source["type"])
      )
        throw invalidEvidence();
      if (
        this.input.types?.length &&
        !this.input.types.includes(item.type as Source["type"])
      )
        continue;
      if (this.documents.size >= 100 && !this.documents.has(item.id)) continue;
      const summary: DocumentSummary = {
        id: item.id,
        title: item.title,
        type: item.type as Source["type"],
        language: this.input.language,
        excerpt: item.excerpt.slice(0, 600),
        snapshotId: this.snapshotId!,
        metadata: boundedMetadata(item.metadata),
      };
      this.documents.set(item.id, summary);
      related.push(summary);
    }
    return related;
  }
  event(): ChatEvent {
    return {
      event: "sources",
      data: {
        sources: this.sources.map((s) => ({ ...s })),
        snapshotId: this.snapshotId!,
      },
    };
  }
}
function parseToolArgs(call: ToolCall): Record<string, unknown> | null {
  try {
    const args: unknown = JSON.parse(call.function.arguments);
    return record(args) ? args : null;
  } catch {
    return null;
  }
}
function toolError(code: string) {
  return JSON.stringify({ error: code });
}
function contextPayload(sources: Citation[]) {
  return JSON.stringify({ snapshotId: sources[0]?.snapshotId, sources });
}

/** Conservative reference detection: explicit new subjects stay independent. */
function isShortFollowup(question: string): boolean {
  const text = question.trim();
  if (text.length > 400) return false;
  return (
    /^(?:(?:那(?:么)?)?[他她它](?:们)?)(?:$|[的呢又还曾会可要应为在有是和与比能就最也怎何属叫以。！？?!，,\s]|后来|之后|之前)/u.test(
      text,
    ) ||
    /^(?:这|那)(?:个|件|段|些|本|时|里|种|位|呢|么[，,\s]|后来|之后|之前|然后|接着|又|还|现在|为什么|为何|怎么|如何)/u.test(
      text,
    ) ||
    /^(?:后来|然后|之后|接下来)(?:发生|怎么样|如何|又|呢|[，,\s])/u.test(
      text,
    ) ||
    /^(?:为什么|为何|怎么回事|后来呢|之后呢|然后呢|接下来呢|再讲讲|详细一点|说详细点|继续)[。！？?!\s]*$/u.test(
      text,
    ) ||
    /^(?:he|she|it|they|him|her|his|its|their|them)\b/iu.test(text) ||
    /^(?:who|what|why|how|when|where)\s+(?:is|are|was|were|do|does|did|can|could|would|has|have)\s+(?:he|she|it|they|him|her|his|their|that|this|these|those)\b/iu.test(
      text,
    ) ||
    /^(?:what\s+(?:about\s+(?:him|her|it|them|that|this)|happened\s+(?:next|then|after\s+that|before\s+that))|and\s+(?:then|after\s+that|before\s+that|what\s+happened)|(?:tell\s+me|explain|say)\s+more|(?:can|could|would)\s+you\s+(?:elaborate|continue|go\s+on|explain\s+(?:that|this)))\b/iu.test(
      text,
    ) ||
    /^(?:why|how|when|where|then|next|continue|go\s+on|what\s+next)[.!?\s]*$/iu.test(
      text,
    )
  );
}
function boundedQuestion(question: string, max: number): string {
  const text = question.trim();
  if (text.length <= max) return text;
  const tail = Math.floor(max / 3);
  return `${text.slice(0, max - tail - 1)} ${text.slice(-tail)}`;
}
function initialRetrievalQuery(messages: ChatRequest["messages"]): string {
  const current = messages.at(-1)!.content.trim().slice(0, 2000);
  if (!isShortFollowup(current)) return current;
  // Prior USER questions only identify a possible referent. They do not become
  // evidence; retrieved sources still pass the same snapshot/language/type checks.
  const recent = messages
    .slice(0, -1)
    .filter((message) => message.role === "user")
    .slice(-6);
  if (!recent.length) return current;
  const anchorIndex = recent.findLastIndex(
    (message) => !isShortFollowup(message.content),
  );
  const context: string[] = [];
  if (anchorIndex >= 0)
    context.push(boundedQuestion(recent[anchorIndex].content, 1200));
  if (anchorIndex < recent.length - 1)
    context.push(boundedQuestion(recent.at(-1)!.content, 300));
  return [...context, current].join("\n").slice(0, 2000);
}

export async function runAgent(
  input: ChatRequest,
  options: Options,
): Promise<{ usedTokens: number | null }> {
  const answerLanguage = input.answerLanguage ?? input.language;
  const deadline = AbortSignal.timeout(180_000);
  const signal = AbortSignal.any([options.signal, deadline]);
  const emit = (event: ChatEvent) => {
    if (!signal.aborted) options.emit(event);
  };
  let dispatched = false,
    unknownBilling = false,
    earlierUnknownBilling = false,
    usedTokens = 0;
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let aggregate = "";
  let transport: ProviderTransport | undefined;
  try {
    const config = options.provider ?? await resolveProvider(input.mode, input.provider, signal);
    transport = openProviderTransport(config, signal);
    const evidence = new Evidence(input);
    const researchSelections: { query: string; types?: ContentType[]; matchedSources: number; includedSources: number; truncated: boolean }[] = [];
    const search = async (query: string, types = input.types, prepare = false) => {
      const result = await knowledge<SearchResult>("/v1/search", {
        body: {
          query: expandLoreQuery(query),
          language: input.language,
          ...(types ? { types } : {}),
          ...(evidence.snapshotId ? { snapshotId: evidence.snapshotId } : {}),
          limit: 10,
        },
        signal,
        // Full-corpus cold searches need headroom; other reads keep their
        // default timeout, and the 180s deadline/caller abort still apply.
        timeout: 30_000,
      });
      if (!record(result) || !Array.isArray(result.sources))
        throw invalidEvidence();
      if (result.snapshotId === null && result.sources.length === 0)
        throw new AppError(
          "NO_SNAPSHOT",
          "No imported knowledge snapshot is available.",
          503,
          false,
        );
      evidence.pin(result.snapshotId);
      evidence.add(result.sources, prepare ? { sources: 6, chars: 8000 } : undefined);
      emit(evidence.event());
      const matchedIds = new Set(result.sources.map((source) => source.id));
      const included = evidence.sources.filter((source) => matchedIds.has(source.id));
      const selection = {
        query, ...(types ? { types } : {}),
        matchedSources: result.sources.length, includedSources: included.length,
        truncated: included.length < result.sources.length || result.sources.some(item => included.find(source => source.id === item.id)?.text.length !== item.text.length),
      };
      researchSelections.push(selection);
      return { snapshotId: evidence.snapshotId, sources: included, selection };

    };
    emit({
      event: "status",
      data: {
        stage: "searching",
        message:
          answerLanguage === "en"
            ? "Searching the imported sources…"
            : "正在检索已导入资料…",
      },
    });
    const initialQuery = initialRetrievalQuery(input.messages);
    const initialTypes = initialLoreTypes(initialQuery, input.types);
    let outlineLoaded = false;
    const region = overviewRegion(input.messages.at(-1)!.content, input.language);
    if (region && (!input.types?.length || input.types.includes('quest'))) {
      const params = new URLSearchParams({ region, language: input.language, includeChapters: String(!input.types?.length || input.types.includes('other')), ...(evidence.snapshotId ? { snapshotId: evidence.snapshotId } : {}) });
      try {
        const outline = await knowledge<SearchResult>(`/v1/quest-outline?${params}`, { signal, timeout: 12000 });
        if (!record(outline) || !Array.isArray(outline.sources) || outline.sources.length > 24) throw invalidEvidence();
        if (outline.sources.length) {
          evidence.pin(outline.snapshotId);
          const included = evidence.add(outline.sources, { sources: 24, chars: 8000, perSourceChars: Math.floor(8000 / outline.sources.length) });
          emit(evidence.event());
          researchSelections.push({ query: region, matchedSources: outline.sources.length, includedSources: included.length, truncated: included.length < outline.sources.length || outline.sources.some(source => included.find(item => item.id === source.id)?.text.length !== source.text.length) });
          outlineLoaded = included.length > 0;
        }
      } catch (error) {
        if (signal.aborted || (error instanceof AppError && error.code === 'INVALID_EVIDENCE')) throw error;
        // Older knowledge-service versions can fall back to ranked retrieval.
      }
    }
    if (!outlineLoaded) await search(initialQuery, initialTypes, needsNarrativeContext(initialQuery));
    // An inferred scope is only a retrieval preference, not a user constraint.
    if (!evidence.sources.length && initialTypes && !input.types?.length)
      await search(initialQuery, undefined, true);
    if (!evidence.sources.length) {
      emit({
        event: "text_delta",
        data: {
          text:
            answerLanguage === "en"
              ? "No matching evidence was found in the selected snapshot. Try a different name or content filter."
              : "当前快照中未找到匹配证据。请尝试更换名称或内容筛选条件。",
        },
      });
      emit({
        event: "done",
        data: { snapshotId: evidence.snapshotId!, finishReason: "no_evidence" },
      });
      return { usedTokens: 0 };
    }
    const readSource = async (known: Citation, timeout?: number, allowance?: { sources: number; chars: number; perSourceChars?: number }) => {
      const detail = await knowledge<SourceResult>(
        `/v1/sources/${encodeURIComponent(known.id)}?snapshotId=${encodeURIComponent(evidence.snapshotId!)}`,
        { signal, timeout },
      );
      if (
        !record(detail) ||
        !record(detail.source) ||
        detail.source.id !== known.id
      )
        throw invalidEvidence();
      if (detail.context !== undefined && !Array.isArray(detail.context)) throw invalidEvidence();
      const matched = [detail.source, ...(detail.context ?? [])];
      evidence.add(matched, allowance);
      emit(evidence.event());
      const related = evidence.related(detail.related ?? []);
      const sources = evidence.sources.filter(s => matched.some(item => item.id === s.id));
      return {
        sources, related,
        selection: {
          matchedSources: matched.length, includedSources: sources.length,
          truncated: sources.length < matched.length || matched.some(item => sources.find(source => source.id === item.id)?.text.length !== item.text.length),
        },
      };
    };
    const contextReads: { operation: 'read_source' | 'read_document'; sourceId?: string; documentId?: string; status: string; related?: DocumentSummary[]; selection?: Record<string, number | boolean> }[] = [];
    if (needsNarrativeContext(initialQuery)) {
      const seen = new Set<string>();
      const candidates = evidence.sources.filter(source => {
        if (source.type === 'other' || source.metadata?.contextUnknown === true || source.metadata?.kind === 'orphan_textmap' || seen.has(source.documentId)) return false;
        seen.add(source.documentId); return true;
      }).slice(0, 2);
      if (candidates.length) emit({ event: 'status', data: { stage: 'reading' } });
      // Bound automatic reads and register through the same validated reader.
      // Further contextual reads remain available to the model.
      for (const candidate of candidates) {
        try { const detail = await readSource(candidate, 6000, { sources: 3, chars: 3000 }); contextReads.push({ operation: 'read_source', sourceId: candidate.id, status: 'read', related: detail.related, selection: detail.selection }); }
        catch (error) {
          if (signal.aborted || (error instanceof AppError && error.code === 'INVALID_EVIDENCE')) throw error;
          contextReads.push({ operation: 'read_source', sourceId: candidate.id, status: 'unavailable_this_request' });
        }
      }
    }
    const messages: Message[] = [
      {
        role: "system",
        content: loreSystemPrompt(input) + `
Research selections:
${JSON.stringify(researchSelections)}
Context preparation:
${JSON.stringify(contextReads)}
Initial evidence:
${contextPayload(evidence.sources)}`,
      },
      ...input.messages,
    ];
    // An outline establishes coverage, not enough detail to narrate the arc.
    // Keep the bounded research phase available for its important turns.
    let synthesize = false;
    const deliberateAnswer = needsNarrativeContext(initialQuery) || input.depth === 'deep';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const finalRound = synthesize || round === MAX_TOOL_ROUNDS;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      emit({ event: "status", data: { stage: "writing" } });
      const payload = JSON.stringify({
        model: config.model,
        messages: finalRound ? [
          { role: 'system', content: loreSystemPrompt(input) + `
Research is complete. Give the best supported answer to the user now. No more searches or tool calls are available. Do not output research narration or tool syntax.
Research selections:
${JSON.stringify(researchSelections)}
Context preparation:
${JSON.stringify(contextReads)}
Initial evidence:
${contextPayload(evidence.sources)}` },
          ...input.messages,
        ] : messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(config.deepseekExtensions ? { thinking: { type: finalRound && deliberateAnswer ? 'enabled' : 'disabled' } } : {}),
        ...(finalRound && deliberateAnswer && config.deepseekExtensions ? {reasoning_effort: input.depth === 'deep' ? 'high' : 'low'} : {}),
        max_tokens: outputLimit(input.depth, finalRound && deliberateAnswer && config.deepseekExtensions),
        ...(finalRound ? {} : { tools: toolDefinitions, tool_choice: "auto" }),
      });
      if (Buffer.byteLength(payload, "utf8") > requestByteLimit(input))
        throw new AppError(
          "CONTEXT_LIMIT",
          "The evidence context reached the request limit. Please narrow your question.",
          400,
        );
      dispatched = true;
      unknownBilling = true;
      let response: Response;
      try {
        response = await transport.fetch("/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.key}`,
          },
          body: payload,
          signal,
          cache: "no-store",
          redirect: "error",
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AppError(
          "MODEL_UNAVAILABLE",
          "The model provider is unavailable.",
          503,
          true,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(
          response.status === 401 || response.status === 403
            ? "MODEL_AUTH"
            : response.status === 429
              ? "MODEL_RATE_LIMIT"
              : "MODEL_UNAVAILABLE",
          response.status === 401 || response.status === 403
            ? "The model API key was not accepted."
            : response.status === 429
              ? "The model provider rate limit was reached."
              : "The model provider is unavailable.",
          response.status === 401 || response.status === 403
            ? 401
            : response.status === 429
              ? 429
              : 503,
          response.status !== 401 && response.status !== 403,
        );
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await response.body?.cancel();
        throw new AppError(
          "INVALID_MODEL_RESPONSE",
          "The model provider returned an invalid stream.",
          503,
          true,
        );
      }
      const tools = new Map<number, ToolCall>();
      let text = "";
      let finish: string | null = null;
      let streamDone = false;
      let roundUsage: Usage | null = null;
      for await (const raw of parseSSE(response.body, signal)) {
        if (raw === "[DONE]") {
          streamDone = true;
          break;
        }
        let chunk: unknown;
        try {
          chunk = JSON.parse(raw);
        } catch {
          throw new AppError(
            "INVALID_MODEL_RESPONSE",
            "The model provider returned an invalid stream.",
            503,
            true,
          );
        }
        if (!record(chunk))
          throw new AppError(
            "INVALID_MODEL_RESPONSE",
            "The model provider returned an invalid stream.",
            503,
            true,
          );
        if (
          record(chunk.usage) &&
          Number.isInteger(chunk.usage.prompt_tokens) &&
          Number.isInteger(chunk.usage.completion_tokens) &&
          Number(chunk.usage.prompt_tokens) >= 0 &&
          Number(chunk.usage.completion_tokens) >= 0
        )
          roundUsage = {
            inputTokens: Number(chunk.usage.prompt_tokens),
            outputTokens: Number(chunk.usage.completion_tokens),
          };
        if (!Array.isArray(chunk.choices) || chunk.choices.length > 1)
          throw new AppError(
            "INVALID_MODEL_RESPONSE",
            "The model provider returned an invalid stream.",
            503,
            true,
          );
        for (const choice of chunk.choices) {
          if (!record(choice))
            throw new AppError(
              "INVALID_MODEL_RESPONSE",
              "The model provider returned an invalid stream.",
              503,
              true,
            );
          if (typeof choice.finish_reason === "string")
            finish = choice.finish_reason;
          if (!record(choice.delta)) continue;
          // reasoning_content is deliberately never forwarded, recorded, or replayed.
          if (typeof choice.delta.content === "string") {
            text += choice.delta.content;
            if ((finalRound ? text.length : aggregate.length + text.length) > MAX_ANSWER_CHARS)
              throw new AppError(
                "OUTPUT_LIMIT",
                "The answer reached the safe output limit.",
              );
            // Tool-enabled rounds may contain research narration before a
            // later tool call. Commit only the final answer, not that preamble.
            if (finalRound && choice.delta.content) {
              aggregate += choice.delta.content;
              emit({
                event: "text_delta",
                data: { text: choice.delta.content },
              });
            }
          }
          if (choice.delta.tool_calls !== undefined) {
            if (!Array.isArray(choice.delta.tool_calls))
              throw new AppError(
                "INVALID_TOOL_CALL",
                "The model returned an invalid tool call.",
              );
            for (const part of choice.delta.tool_calls) {
              if (
                !record(part) ||
                !Number.isInteger(part.index) ||
                Number(part.index) < 0 ||
                Number(part.index) > 15
              )
                throw new AppError(
                  "TOOL_LIMIT",
                  "The model exceeded the allowed tool calls.",
                );
              const index = Number(part.index);
              const tool = tools.get(index) ?? {
                id: "",
                type: "function" as const,
                function: { name: "", arguments: "" },
              };
              if (typeof part.id === "string") tool.id += part.id;
              if (record(part.function)) {
                if (typeof part.function.name === "string")
                  tool.function.name += part.function.name;
                if (typeof part.function.arguments === "string")
                  tool.function.arguments += part.function.arguments;
              }
              if (
                tool.id.length > 256 ||
                tool.function.name.length > 128 ||
                tool.function.arguments.length > 4096
              )
                throw new AppError(
                  "TOOL_LIMIT",
                  "The model exceeded the allowed tool call size.",
                );
              tools.set(index, tool);
            }
          }
        }
      }
      if (!streamDone || !finish)
        throw new AppError(
          "MODEL_STREAM_INCOMPLETE",
          "The model stream ended before completion.",
          503,
          true,
        );
      if (roundUsage) {
        unknownBilling = false;
        usage = {
          inputTokens: usage.inputTokens + roundUsage.inputTokens,
          outputTokens: usage.outputTokens + roundUsage.outputTokens,
        };
        usedTokens += roundUsage.inputTokens + roundUsage.outputTokens;
      } else {
        unknownBilling = true;
        earlierUnknownBilling = true;
      }
      if (tools.size) {
        if (finalRound)
          throw new AppError(
            "TOOL_LIMIT",
            "The model reached the allowed research limit. Please narrow your question.",
          );
        if (finish !== "tool_calls")
          throw new AppError(
            "INVALID_TOOL_CALL",
            "The model returned an incomplete tool call.",
          );
        const calls = [...tools.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call);
        const ids = new Set(calls.map((c) => c.id));
        if (ids.size !== calls.length || calls.some((c) => !c.id))
          throw new AppError(
            "INVALID_TOOL_CALL",
            "The model returned an invalid tool call.",
          );
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: calls,
        });
        emit({ event: "status", data: { stage: "reading" } });
        for (const [callIndex, call] of calls.entries()) {
          const args = parseToolArgs(call);
          let result: string;
          if (callIndex >= 4) result = toolError("TOOL_BATCH_LIMIT_USE_EXISTING_EVIDENCE");
          else if (!args) result = toolError("INVALID_ARGUMENTS");
          else if (
            call.function.name === "search_corpus" &&
            Object.keys(args).every((k) => k === "query" || k === "types") &&
            (args.types === undefined || (Array.isArray(args.types) && args.types.length > 0 && args.types.length <= CONTENT_TYPES.length && args.types.every(type => CONTENT_TYPES.includes(type) && (!input.types?.length || input.types.includes(type))))) &&
            typeof args.query === "string" &&
            args.query.trim() &&
            args.query.length <= 2000
          ) {
            result = JSON.stringify(await search(args.query, args.types as ContentType[] | undefined));
          } else if (
            call.function.name === 'find_documents' &&
            Object.keys(args).every(k => k === 'query' || k === 'type') &&
            (!input.types || input.types.length <= 1 || args.type !== undefined) &&
            typeof args.query === 'string' && args.query.trim() && args.query.length <= 200 &&
            (args.type === undefined || (CONTENT_TYPES.includes(args.type as ContentType) && (!input.types?.length || input.types.includes(args.type as ContentType))))
          ) {
            const type = args.type as ContentType | undefined ?? (input.types?.length === 1 ? input.types[0] : undefined);
            const params = new URLSearchParams({ q: args.query, language: input.language, snapshotId: evidence.snapshotId!, page: '1', pageSize: '8', ...(type ? {type} : {}) });
            const detail = await knowledge<LibraryResult>(`/v1/documents?${params}`, { signal, timeout: 30000 });
            if (!record(detail) || !Array.isArray(detail.items) || !Number.isInteger(detail.total) || detail.total < 0) throw invalidEvidence();
            evidence.pin(detail.snapshotId);
            const documents = evidence.related(detail.items);
            const selection = { query: args.query, ...(type ? { types: [type] } : {}), matchedSources: detail.total, includedSources: documents.length, truncated: documents.length < detail.total };
            researchSelections.push(selection);
            result = JSON.stringify({ documents, selection, note: 'Document summaries are discovery leads. Read documents for citable evidence.' });
          } else if (
            call.function.name === "read_source" &&
            Object.keys(args).every((k) => k === "sourceId") &&
            typeof args.sourceId === "string"
          ) {
            const known = evidence.sources.find((s) => s.id === args.sourceId);
            if (!known) result = toolError("UNKNOWN_SOURCE");
            else {
              const detail = await readSource(known);
              contextReads.push({ operation: 'read_source', sourceId: known.id, status: 'read', selection: detail.selection });
              result = JSON.stringify(detail);
            }
          } else if (
            call.function.name === "read_document" &&
            Object.keys(args).every((k) => k === "documentId") &&
            typeof args.documentId === "string"
          ) {
            const known =
              evidence.sources.find((s) => s.documentId === args.documentId) ??
              (evidence.documents.has(args.documentId)
                ? { documentId: args.documentId }
                : undefined);
            if (!known) result = toolError("UNKNOWN_DOCUMENT");
            else {
              const detail = await knowledge<DocumentResult>(
                `/v1/documents/${encodeURIComponent(known.documentId)}?snapshotId=${encodeURIComponent(evidence.snapshotId!)}`,
                { signal },
              );
              if (
                !record(detail) ||
                !record(detail.document) ||
                detail.document.id !== known.documentId ||
                detail.document.language !== input.language
              )
                throw invalidEvidence();
              evidence.pin(detail.snapshotId);
              const documentEvidence = evidence.addDocument(
                detail.sources,
                known.documentId,
              );
              emit(evidence.event());
              contextReads.push({ operation: 'read_document', documentId: known.documentId, status: 'read', selection: documentEvidence.selection });
              result = JSON.stringify({
                snapshotId: evidence.snapshotId,
                ...documentEvidence,
              });
            }
          } else result = toolError("TOOL_NOT_ALLOWED");
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }
      if (!finalRound && deliberateAnswer) {
        synthesize = true;
        continue;
      }
      if (!finalRound && text) {
        aggregate += text;
        emit({ event: 'text_delta', data: { text } });
      }
      if (!aggregate.trim()) throw new AppError('EMPTY_MODEL_ANSWER', answerLanguage === 'en' ? 'The model did not produce an answer. Please try again.' : '模型本次未生成回答，请重试。', 503, true);
      const labels = [...aggregate.matchAll(/[\[［](\d+)[\]］]/g)].map((m) =>
        Number(m[1]),
      );
      const warnings = [
        ...new Set(labels.filter((n) => n < 1 || n > evidence.sources.length)),
      ].map((n) => `Unknown citation [${n}]`);
      if (evidence.sources.length && aggregate.trim() && !labels.length)
        warnings.push("The answer contains no source citations.");
      emit({
        event: "done",
        data: {
          snapshotId: evidence.snapshotId!,
          ...(unknownBilling || earlierUnknownBilling ? {} : { usage }),
          finishReason: finish,
          ...(warnings.length ? { citationWarnings: warnings } : {}),
        },
      });
      return {
        usedTokens: unknownBilling || earlierUnknownBilling ? null : usedTokens,
      };
    }
    throw new AppError(
      "TOOL_LIMIT",
      "The model reached the allowed research limit.",
    );
  } catch (error) {
    if (options.signal.aborted) return { usedTokens: dispatched ? null : 0 };
    const safe = deadline.aborted
      ? new AppError(
          "TIMEOUT",
          "The research request timed out. Please try a narrower question.",
          503,
          true,
        )
      : safeError(error);
    options.emit({
      event: "error",
      data: {
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
      },
    });
    return {
      usedTokens:
        dispatched && (unknownBilling || earlierUnknownBilling)
          ? null
          : usedTokens,
    };
  } finally { await transport?.close().catch(() => {}); }
}
