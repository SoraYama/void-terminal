import { randomUUID } from "node:crypto";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime, {
  createUserMessage,
  createAssistantMessage,
  AssistantStreamAccumulator,
  LlmError,
  type ToolSchema,
} from "@deepseek-ai/dsh-llm";
import SessionStore, {
  Session,
  SessionId,
  SessionSeq,
} from "@deepseek-ai/dsh-session";
import SessionProjection from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import AgentRegistry, { type Agent } from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import * as PiAi from "@deepseek-ai/dsh-llm-pi-ai";
import TokenMeter from "@deepseek-ai/dsh-token-meter";
import BasicCompaction from "@deepseek-ai/dsh-compaction-basic";
import { createLaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { openModelBridge, type ModelDispatch } from "./model-bridge";
import { AppError } from "./errors";

export type RuntimeEvent =
  | { type: "start" }
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; kind: string }
  | { type: "compaction" };
export type ResearchTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<string>;
};
export type DshResearchOptions = {
  instructions: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal: AbortSignal;
  tools: ResearchTool[];
  dispatch: (
    body: Parameters<ModelDispatch>[0],
    signal: AbortSignal,
    context: { compaction: boolean },
  ) => Promise<Response>;
  onEvent: (event: RuntimeEvent) => void;
  canCompact?: () => boolean;
  needsFinalAnswer?: () => boolean;
  maxOutputTokens?: number;
  contextWindow?: number;
};

/** The only DSH integration seam. No ambient home, disk log, host tools or telemetry. */
export async function runDshResearch(options: DshResearchOptions) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  let compacting = false;
  const bridge = await openModelBridge({
    signal,
    dispatch: (body, callSignal) =>
      options.dispatch(body, callSignal, { compaction: compacting }),
  });
  const ctx = new Context();
  let agent: Agent | undefined;
  let error: unknown;
  let finishReason = "";
  const publish = (event: RuntimeEvent) => {
    try {
      options.onEvent(event);
    } catch (failure) {
      error ??= failure;
      lifetime.abort();
    }
  };
  const onAbort = () => agent?.cancel({ kind: "user" });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    ctx.provide(
      "launchEnvironment",
      createLaunchEnvironmentSnapshot([
        {
          source: "process",
          values: { VOID_MODEL_BRIDGE_TOKEN: bridge.token },
        },
      ]),
    );
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjection);
    await ctx.plugin(SystemPrompt, {
      personaPrefix: options.instructions,
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
    });
    await ctx.plugin(ToolRuntime, { mode: "native" });
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    await ctx.plugin(PiAi, {
      providers: {
        "void-terminal": {
          api: "openai-completions",
          baseURL: bridge.baseURL,
          apiKeyEnv: "VOID_MODEL_BRIDGE_TOKEN",
          models: [
            {
              id: "void-model",
              contextWindow: options.contextWindow ?? 65536,
              maxTokens: options.maxOutputTokens ?? 8192,
            },
          ],
          transport: "sse",
          retryPolicy: { mode: "normal", maxRetries: 0 },
          streamIdleTimeoutMs: 30_000,
        },
      },
    });
    await ctx.plugin(TokenMeter);
    await ctx.plugin(BasicCompaction, {
      thresholdRatio: 0.8,
      headroomTokens: 4096,
      retainTokens: 4096,
      maxTokens: Math.min(4096, options.maxOutputTokens ?? 4096),
      compactionRetries: 0,
      maxOverflowRetries: 0,
      auto: false,
    });
    ctx.on(
      "agent/pre-step",
      async ({ agent: subject, signal: stepSignal }, next) => {
        if (!stepSignal.aborted && (options.canCompact?.() ?? true)) {
          compacting = true;
          try {
            await ctx.compaction.compactIfNeeded(
              subject,
              "pressure",
              stepSignal,
            );
          } finally {
            compacting = false;
          }
        }
        return next();
      },
    );
    let stepTools = 0;
    for (const tool of options.tools) {
      ctx.tools.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as ToolSchema["parameters"],
        output: {
          schema: { type: "string" },
          render: (_args, value) => [{ type: "text", text: String(value) }],
        },
        async execute(args, exec) {
          if (++stepTools > 4)
            return '{"error":"TOOL_BATCH_LIMIT_USE_EXISTING_EVIDENCE"}';
          options.signal.throwIfAborted();
          if (!args || typeof args !== "object" || Array.isArray(args))
            return '{"error":"INVALID_ARGUMENTS"}';
          try {
            return await tool.execute(
              args as Record<string, unknown>,
              exec.signal,
            );
          } catch (failure) {
            error ??= failure;
            lifetime.abort();
            throw failure;
          }
        },
      });
    }
    ctx.on("agent/error", (event) => {
      error ??= event.error;
    });
    ctx.on("agent/assistant-stream", ({ frame }) => {
      if (frame.type === "start") {
        stepTools = 0;
        publish({ type: "start" });
      }
      if (frame.type !== "chunk") return;
      const chunk = frame.chunk;
      if (chunk.type === "text-delta")
        publish({ type: "text", text: chunk.text });
      else if (chunk.type === "usage")
        publish({
          type: "usage",
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
        });
      else if (chunk.type === "finish") {
        finishReason = chunk.reason.kind;
        publish({ type: "finish", kind: finishReason });
      }
    });
    ctx.on("session/event", (_session, event) => {
      if (event.type === "compaction/start") publish({ type: "compaction" });
      else if (event.type === "compaction/summary" && event.data.usage)
        publish({
          type: "usage",
          inputTokens: event.data.usage.inputTokens,
          outputTokens: event.data.usage.outputTokens,
        });
    });
    ctx.on("agent/turn-stopping", ({ agent: subject }) => {
      if (options.needsFinalAnswer?.())
        subject.steer(
          createUserMessage({
            content: [
              {
                type: "text",
                text: "Research is complete. Answer the original user question using the evidence now.",
              },
            ],
            source: { kind: "user" },
          }),
        );
    });
    const sessionId = SessionId(randomUUID());
    const history = Session.create(sessionId);
    let turn = 0;
    for (const message of options.messages.slice(0, -1)) {
      if (!message.content.trim()) continue;
      if (message.role === "user")
        history.append(
          "user/message",
          createUserMessage({
            content: [{ type: "text", text: message.content }],
            source: { kind: "user" },
          }),
          { surfaceOp: "append" },
        );
      else {
        history.append("turn/start", { turn: ++turn });
        history.append("step/start", { turn, step: 1 });
        const content = [{ type: "text" as const, text: message.content }];
        const stream = new AssistantStreamAccumulator();
        stream.push({
          time: 0,
          chunk: { type: "block-start", index: 0, blockType: "text" },
        });
        stream.push({
          time: 0,
          chunk: { type: "text-delta", index: 0, text: message.content },
        });
        stream.push({
          time: 0,
          chunk: { type: "block-end", index: 0, block: content[0] },
        });
        stream.push({
          time: 0,
          chunk: { type: "finish", reason: { kind: "stop" } },
        });
        history.append(
          "assistant/message",
          {
            turn,
            step: 1,
            message: createAssistantMessage({
              content,
              source: { provider: "void-terminal", model: "void-model" },
            }),
            stream: [...stream.snapshot()],
          },
          { surfaceOp: "append" },
        );
        history.append("step/end", { turn, step: 1 });
        history.append("turn/end", { turn, reason: { kind: "completed" } });
      }
    }
    const handle = await ctx.agents.create({
      sessionId,
      seed: Array.from(
        { length: history.seq },
        (_, index) => history.eventAt(SessionSeq(index))!,
      ),
      agentOptions: {
        provider: "void-terminal",
        model: "void-model",
        maxTokens: options.maxOutputTokens ?? 8192,
      },
      signal,
    });
    agent = handle.agent;
    signal.throwIfAborted();
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: options.messages.at(-1)!.content }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    if (error || bridge.error) throw bridge.error ?? error;
    options.signal.throwIfAborted();
    if (!finishReason)
      throw new AppError(
        "MODEL_STREAM_INCOMPLETE",
        "The model stream ended before completion.",
        503,
        true,
      );
    return { runtime: "dsh" as const, finishReason };
  } catch (failure) {
    if (failure instanceof LlmError) {
      if (failure.code === "TRANSPORT" || failure.code === "STREAM_CLOSED")
        throw new AppError(
          "MODEL_STREAM_INCOMPLETE",
          "The model stream ended before completion.",
          503,
          true,
        );
      if (failure.code === "TIMEOUT")
        throw new AppError(
          "TIMEOUT",
          "The model response timed out.",
          503,
          true,
        );
      if (failure.code === "CONTEXT_WINDOW_EXCEEDED")
        throw new AppError(
          "CONTEXT_LIMIT",
          "The model context is full. Please narrow your question.",
          400,
          true,
        );
      if (failure.code === "EMPTY_RESPONSE")
        throw new AppError(
          "EMPTY_MODEL_ANSWER",
          "The model did not produce an answer. Please try again.",
          503,
          true,
        );
      throw new AppError(
        "MODEL_UNAVAILABLE",
        "The model provider is unavailable.",
        503,
        true,
      );
    }
    throw failure;
  } finally {
    signal.removeEventListener("abort", onAbort);
    lifetime.abort();
    await bridge.close();
    await ctx.fiber.dispose();
  }
}
