import type { ChatEvent, ChatRequest, Citation, Usage } from "../contracts";
import { MAX_TOOL_ROUNDS, outputLimit, requestByteLimit } from "./config";
import { AppError, safeError } from "./errors";
import {
  openProviderTransport,
  resolveProvider,
  type ResolvedProvider,
  type ProviderTransport,
} from "./provider";
import { loreSystemPrompt, needsNarrativeContext } from "./lore-policy";
import { prepareResearch, modelSource, contextPayload } from "./research";
import { runDshResearch } from "./dsh-runtime";
import type { ModelBody } from "./model-bridge";
import { buildAnswerCards } from "./answer-cards";
import { citationLabels } from "./citation-labels";
import {MAP_RESEARCH_POLICY} from './map-research';

const MAX_ANSWER_CHARS = 120000;
type Options = {
  key: string;
  signal: AbortSignal;
  emit: (event: ChatEvent) => void;
  provider?: ResolvedProvider;
};

/** Genshin evidence policy around the official DSH execution runtime. */
export async function runAgent(
  input: ChatRequest,
  options: Options,
): Promise<{ usedTokens: number | null; outcome: "completed" | "released" }> {
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
  let aggregate = "",
    roundText = "";
  let transport: ProviderTransport | undefined;
  try {
    const config =
      options.provider ??
      (await resolveProvider(input.mode, input.provider, signal));
    transport = openProviderTransport(config, signal);
    const prepared = await prepareResearch(input, signal, emit);
    if (!prepared) return { usedTokens: 0, outcome: "released" };
    const { evidence, researchSelections, contextReads, initialQuery, maps } =
      prepared;
    const deliberateAnswer =
      needsNarrativeContext(initialQuery) || input.depth === "deep";
    const byteLimit = requestByteLimit(input);
    let calls = 0,
      finalRound = false,
      synthesize = false,
      seenUsage = false;
    let answerSources: Citation[] | undefined;
    let pendingUsage: Usage | undefined;
    const confirmUsage = () => {
      if (!pendingUsage || seenUsage) return;
      usage = {
        inputTokens: usage.inputTokens + pendingUsage.inputTokens,
        outputTokens: usage.outputTokens + pendingUsage.outputTokens,
      };
      usedTokens += pendingUsage.inputTokens + pendingUsage.outputTokens;
      seenUsage = true;
      unknownBilling = false;
      pendingUsage = undefined;
    };
    const instructions =
      loreSystemPrompt(input) + MAP_RESEARCH_POLICY + `\nVerified map results:\n${maps.context()}` +
      `
Research selections:
${JSON.stringify(researchSelections)}
Context preparation:
${JSON.stringify(contextReads)}
Initial evidence:
${contextPayload(evidence.sources)}`;
    const finalBody = (
      sources: Citation[],
      excerptChars: number,
    ): ModelBody => {
      const selected = sources.map((source) =>
        modelSource(source, excerptChars),
      );
      const truncated =
        sources.length < evidence.sources.length ||
        selected.some((source) => source.textTruncated);
      return {
        messages: [
          {
            role: "system",
            content:
              loreSystemPrompt(input) + MAP_RESEARCH_POLICY + `\nVerified map results:\n${maps.context()}` +
              `
Research is complete. Give the best supported answer to the user now. No more searches or tool calls are available. Do not output research narration or tool syntax.
If selection.truncated is true, excerpts or sources were omitted to fit this request, not because the corpus lacks evidence. Only cite sources included below; keep all uncertainty and branch conditions.
Research selections:
${JSON.stringify(researchSelections.map((selection) => ({ ...selection, query: selection.query.slice(0, 200) })))}
Context preparation:
${JSON.stringify(contextReads.map(({ related: _related, ...read }) => read))}
Initial evidence:
${JSON.stringify({ snapshotId: evidence.snapshotId, sources: selected, selection: { availableSources: evidence.sources.length, includedSources: selected.length, truncated } })}`,
          },
          ...input.messages,
        ],
      };
    };
    const envelope = (body: ModelBody, final: boolean): ModelBody => {
      const result = {
        ...body,
        model: config.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: outputLimit(
          input.depth,
          final && deliberateAnswer && config.deepseekExtensions,
        ),
      };
      delete (result as ModelBody).max_completion_tokens;
      if (final) {
        delete (result as ModelBody).tools;
        delete (result as ModelBody).tool_choice;
      }
      if (config.deepseekExtensions) {
        (result as ModelBody).thinking = {
          type: final && deliberateAnswer ? "enabled" : "disabled",
        };
        if (final && deliberateAnswer)
          (result as ModelBody).reasoning_effort =
            input.depth === "deep" ? "high" : "low";
      }
      return result;
    };
    const synthesisPayload = () => {
      for (const excerptChars of [2400, 1200, 600, 300]) {
        const payload = envelope(
          finalBody(evidence.sources, excerptChars),
          true,
        );
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= byteLimit) {
          answerSources = evidence.sources;
          return payload;
        }
      }
      for (let count = evidence.sources.length - 1; count > 0; count--) {
        const sources = evidence.sources.slice(0, count),
          payload = envelope(finalBody(sources, 300), true);
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= byteLimit) {
          answerSources = sources;
          return payload;
        }
      }
      throw new AppError(
        "CONTEXT_LIMIT",
        "The evidence context reached the request limit. Please narrow your question.",
        400,
      );
    };
    const result = await runDshResearch({
      instructions,
      messages: input.messages,
      signal,
      maxOutputTokens: outputLimit(input.depth, true),
      tools: prepared.tools.map((tool) => ({
        ...tool,
        execute: async (args: Record<string, unknown>) => {
          emit({ event: "status", data: { stage: "reading" } });
          return prepared.execute(tool.name, args);
        },
      })),
      canCompact: () => calls < MAX_TOOL_ROUNDS - 1,
      needsFinalAnswer: () => {
        if (!finalRound && deliberateAnswer && calls <= MAX_TOOL_ROUNDS) {
          synthesize = true;
          return true;
        }
        return false;
      },
      async dispatch(body, callSignal, context) {
        if (calls > MAX_TOOL_ROUNDS)
          throw new AppError(
            "TOOL_LIMIT",
            "The model reached the allowed research limit.",
          );
        finalRound =
          !context.compaction && (synthesize || calls === MAX_TOOL_ROUNDS);
        let payload = envelope(body, finalRound);
        if (
          !context.compaction &&
          (finalRound ||
            Buffer.byteLength(JSON.stringify(payload), "utf8") > byteLimit)
        ) {
          finalRound = true;
          payload = synthesisPayload();
        }
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") > byteLimit)
          throw new AppError(
            "CONTEXT_LIMIT",
            "The evidence context reached the request limit.",
            400,
          );
        calls++;
        if (dispatched && !seenUsage) earlierUnknownBilling = true;
        dispatched = true;
        unknownBilling = true;
        seenUsage = false;
        pendingUsage = undefined;
        emit({ event: "status", data: { stage: "writing" } });
        let response: Response;
        try {
          response = await transport!.fetch("/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${options.key}`,
            },
            body: JSON.stringify(payload),
            signal: callSignal,
            cache: "no-store",
            redirect: "error",
          });
        } catch (error) {
          if (signal.aborted || callSignal.aborted) throw error;
          throw new AppError(
            "MODEL_UNAVAILABLE",
            "The model provider is unavailable.",
            503,
            true,
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          const auth = response.status === 401 || response.status === 403,
            rate = response.status === 429;
          throw new AppError(
            auth
              ? "MODEL_AUTH"
              : rate
                ? "MODEL_RATE_LIMIT"
                : "MODEL_UNAVAILABLE",
            auth
              ? "The model API key was not accepted."
              : rate
                ? "The model provider rate limit was reached."
                : "The model provider is unavailable.",
            auth ? 401 : rate ? 429 : 503,
            !auth,
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
        return response;
      },
      onEvent(event) {
        if (event.type === "start") roundText = "";
        else if (event.type === "compaction")
          emit({ event: "status", data: { stage: "reading" } });
        else if (event.type === "text") {
          roundText += event.text;
          if (roundText.length > MAX_ANSWER_CHARS)
            throw new AppError(
              "OUTPUT_LIMIT",
              "The answer reached the safe output limit.",
            );
          if (finalRound) {
            aggregate += event.text;
            emit({ event: "text_delta", data: { text: event.text } });
          }
        } else if (event.type === "usage") {
          // DSH counters are disjoint: ordinary input plus cache reads/writes.
          // The adapter normalizes absent counters to zero. For this nonempty
          // text/tool workload zero ordinary input or output cannot establish
          // complete billing, even when it may represent a fully cached prompt.
          const counts = [
            event.inputTokens,
            event.cacheReadTokens ?? 0,
            event.cacheWriteTokens ?? 0,
            event.outputTokens,
          ];
          if (
            counts.every((n) => Number.isSafeInteger(n) && n >= 0) &&
            event.inputTokens > 0 &&
            event.outputTokens > 0
          ) {
            pendingUsage = {
              inputTokens: counts[0] + counts[1] + counts[2],
              outputTokens: event.outputTokens,
            };
            // A compaction summary event exists only after the official
            // summarizer has accepted its completed output.
            if (event.complete) confirmUsage();
          }
        } else if (event.type === "finish") {
          if (["stop", "tool-calls", "max-tokens"].includes(event.kind))
            confirmUsage();
          if (!seenUsage) {
            unknownBilling = true;
            earlierUnknownBilling = true;
          }
          if (event.kind === "max-tokens")
            throw new AppError(
              roundText.trim() ? "OUTPUT_LIMIT" : "EMPTY_MODEL_ANSWER",
              roundText.trim()
                ? "The answer reached the output limit."
                : "The model did not produce an answer. Please try again.",
              503,
              true,
            );
          if (!finalRound && !deliberateAnswer && event.kind === "stop") {
            aggregate = roundText;
            if (roundText)
              emit({ event: "text_delta", data: { text: roundText } });
          }
        }
      },
    });
    if (!aggregate.trim())
      throw new AppError(
        "EMPTY_MODEL_ANSWER",
        (input.answerLanguage ?? input.language) === "en"
          ? "The model did not produce an answer. Please try again."
          : "模型本次未生成回答，请重试。",
        503,
        true,
      );
    const labels = citationLabels(aggregate);
    const citedEvidence = answerSources ?? evidence.sources;
    const provided = new Set(citedEvidence.map((source) => source.citation));
    const warnings = [...new Set(labels.filter((n) => !provided.has(n)))].map(
      (n) => `Unknown citation [${n}]`,
    );
    if (evidence.sources.length && !labels.length)
      warnings.push("The answer contains no source citations.");
    const cards = evidence.snapshotId && citedEvidence.length ? await buildAnswerCards(initialQuery, citedEvidence, labels,
      evidence.snapshotId, input.answerLanguage ?? input.language, signal).catch(() => []) : [];
    // Archive lookups share the deadline, but a finished generation can
    // still be delivered if only the optional decoration was interrupted.
    if (!options.signal.aborted) options.emit({
      event: "done",
      data: {
        ...(evidence.snapshotId ? {snapshotId: evidence.snapshotId} : {}),
        ...(maps.snapshotId ? {mapSnapshotId: maps.snapshotId, maps: maps.cards} : {}),
        ...(unknownBilling || earlierUnknownBilling ? {} : { usage }),
        finishReason: result.finishReason,
        ...(warnings.length ? { citationWarnings: warnings } : {}),
        ...(cards.length ? { cards } : {}),
      },
    });
    return {
      usedTokens: unknownBilling || earlierUnknownBilling ? null : usedTokens,
      outcome: options.signal.aborted ? "released" : "completed",
    };
  } catch (error) {
    if (options.signal.aborted) return { usedTokens: dispatched ? null : 0, outcome: "released" };
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
      outcome: "released",
      usedTokens:
        dispatched && (unknownBilling || earlierUnknownBilling)
          ? null
          : usedTokens,
    };
  } finally {
    await transport?.close().catch(() => {});
  }
}
