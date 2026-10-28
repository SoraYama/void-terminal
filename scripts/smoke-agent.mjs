#!/usr/bin/env node
/**
 * Real knowledge catalog -> production web API -> controlled HTTPS model fixture.
 * Requires a built Next standalone app, a ready knowledge service, and openssl CLI.
 * No paid provider is contacted; all model output is fixture-authored.
 * Run: node scripts/smoke-agent.mjs
 * Optional: KNOWLEDGE_URL, KNOWLEDGE_API_TOKEN, SMOKE_QUERY, SMOKE_WEB_PORT,
 * SMOKE_MODEL_PORT, SMOKE_LANGUAGE, SMOKE_ANSWER_LANGUAGE, SMOKE_STANDALONE_ENTRY.
 */
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeUrl = (
  process.env.KNOWLEDGE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const webPort = Number(process.env.SMOKE_WEB_PORT || 3001);
const modelPort = Number(process.env.SMOKE_MODEL_PORT || 9443);
const webUrl = `http://127.0.0.1:${webPort}`;
const modelUrl = `https://localhost:${modelPort}`;
const language = process.env.SMOKE_LANGUAGE || "zh-CN";
const answerLanguage = process.env.SMOKE_ANSWER_LANGUAGE || "en";
const query = process.env.SMOKE_QUERY || "纳西妲";
const syntheticKey = "void-live-smoke-synthetic-key-no-paid-provider";
const entry =
  process.env.SMOKE_STANDALONE_ENTRY ||
  path.join(root, "apps/web/.next/standalone/apps/web/server.js");
const reportBase = path.join(root, "artifacts/reports/agent-live-smoke");
const startedAt = new Date().toISOString();
const report = {
  startedAt,
  evidenceBoundary:
    "Real imported knowledge catalog; controlled local HTTPS model fixture; no paid model generation.",
  knowledgeUrl,
  webUrl,
  modelUrl,
  question: query,
  language,
  answerLanguage,
  checks: [],
  passed: false,
};
let fixture;
let child;
let scratch;
let webLog = "";
let scenario = "success";
let round = 0;
let firstSource;
let upstreamClosed;
let upstreamStarted;
const fixtureFailures = [];
const observations = {
  modelListings: 0,
  successModelCalls: 0,
  toolResultSourceCount: 0,
  cancellationObserved: false,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const defer = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const knowledgeHeaders = process.env.KNOWLEDGE_API_TOKEN
  ? { "X-Knowledge-Token": process.env.KNOWLEDGE_API_TOKEN }
  : {};
function redact(value) {
  let safe = value.replaceAll(syntheticKey, "[synthetic-key]");
  if (process.env.KNOWLEDGE_API_TOKEN)
    safe = safe.replaceAll(
      process.env.KNOWLEDGE_API_TOKEN,
      "[knowledge-token]",
    );
  return safe;
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(15000),
  });
  assert(response.ok, `HTTP ${response.status} from ${new URL(url).pathname}`);
  return response.json();
}
async function verifyRealSource(source) {
  assert(
    source && typeof source.id === "string" && typeof source.text === "string",
    "Model evidence must contain an actual source",
  );
  assert.equal(
    source.language,
    language,
    "Evidence language must match the request",
  );
  assert.equal(
    source.snapshotId,
    report.corpus.snapshotId,
    "Evidence must use the active real snapshot",
  );
  const real = await jsonFetch(
    `${knowledgeUrl}/v1/sources/${encodeURIComponent(source.id)}?snapshotId=${encodeURIComponent(source.snapshotId)}`,
    { headers: knowledgeHeaders },
  );
  assert.equal(
    real.source.id,
    source.id,
    "Source ID must match the real catalog",
  );
  assert.equal(
    real.source.snapshotId,
    source.snapshotId,
    "Source snapshot must match the real catalog",
  );
  assert.equal(
    real.source.language,
    source.language,
    "Source locale must match the real catalog",
  );
  assert.equal(
    real.source.documentId,
    source.documentId,
    "Document ID must match the real source",
  );
  assert.equal(
    real.source.sourceUrl,
    source.sourceUrl,
    "Source provenance must match the real catalog",
  );
  assert.equal(
    real.source.text.slice(0, source.text.length),
    source.text,
    "Model evidence text must be an exact excerpt of the real catalog source",
  );
  assert(source.text.trim(), "Real evidence must not be empty");
}
function fixtureAnswerText() {
  const quote = Array.from(firstSource.text).slice(0, 12).join("");
  return answerLanguage === "en"
    ? `Controlled HTTPS fixture cites real corpus [1]. Original quote: 「${quote}」.`
    : `受控 HTTPS 模型夹具引用真实语料 [1]。原文：「${quote}」。`;
}
function chunk(delta, finishReason = null, usage) {
  return {
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}
async function writeSSE(response, chunks) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.flushHeaders();
  const bytes = Buffer.from(
    chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
      "data: [DONE]\n\n",
  );
  // Intentionally fragment UTF-8 and tool argument bytes across writes.
  for (let offset = 0; offset < bytes.length; offset += 3) {
    if (response.destroyed) return;
    response.write(bytes.subarray(offset, offset + 3));
    if (offset % 45 === 0) await delay(1);
  }
  response.end();
}
async function fixtureHandler(request, response) {
  try {
    assert.equal(
      request.headers.authorization,
      `Bearer ${syntheticKey}`,
      "Fixture must receive only the synthetic test credential",
    );
    if (request.method === "GET" && request.url === "/models") {
      observations.modelListings++;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            {
              id: "deepseek-flash",
              object: "model",
              owned_by: "local-fixture",
            },
          ],
        }),
      );
      return;
    }
    assert.equal(
      request.method,
      "POST",
      "Fixture only permits expected methods",
    );
    assert.equal(
      request.url,
      "/chat/completions",
      "Fixture only permits expected paths",
    );
    const requestChunks = [];
    let requestBytes = 0;
    for await (const bytes of request) {
      requestBytes += bytes.length;
      assert(requestBytes <= 400000, "Provider request must stay bounded");
      requestChunks.push(bytes);
    }
    const payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(requestChunks),
      ),
    );
    assert.equal(payload.stream, true);
    assert.equal(payload.thinking.type, "disabled");
    assert(
      payload.messages[0].content.includes("orphan_textmap") &&
        payload.messages[0].content.includes("unknown context"),
      "The production build must preserve unmapped-source uncertainty instructions",
    );
    assert(
      payload.messages[0].content.includes(`Answer in ${answerLanguage}.`) &&
        payload.messages[0].content.includes(`source language is ${language}`),
      "Provider instructions must separate answer and source languages",
    );
    assert(
      payload.messages[0].content.includes("non-official translation"),
      "Provider translations must be labeled unofficial",
    );
    const initial = payload.messages[0].content.split("Initial evidence:\n")[1];
    assert(
      initial,
      "Mandatory retrieval evidence must precede provider generation",
    );
    const evidence = JSON.parse(initial);
    assert(
      evidence.sources.length > 0,
      "Real retrieval must supply at least one source",
    );
    assert.equal(evidence.snapshotId, report.corpus.snapshotId);
    if (!firstSource) {
      firstSource = evidence.sources[0];
      await verifyRealSource(firstSource);
    }
    if (scenario === "auth" || scenario === "rate") {
      response.writeHead(scenario === "auth" ? 401 : 429, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          error: { message: `RAW_FIXTURE_DIAGNOSTIC ${syntheticKey}` },
        }),
      );
      return;
    }
    if (scenario === "cancel") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
      });
      response.flushHeaders();
      response.write(
        `data: ${JSON.stringify(chunk({ content: "cancellation fixture waiting" }))}\n\n`,
      );
      const heartbeat = setInterval(() => {
        if (!response.destroyed) response.write(": waiting\n\n");
      }, 200);
      response.once("close", () => {
        clearInterval(heartbeat);
        observations.cancellationObserved = true;
        upstreamClosed.resolve();
      });
      upstreamStarted.resolve();
      return;
    }
    round++;
    observations.successModelCalls++;
    if (round === 1) {
      const args = JSON.stringify({ sourceId: firstSource.id });
      const half = Math.floor(args.length / 2);
      await writeSSE(response, [
        chunk({ reasoning_content: "PRIVATE_FIXTURE_REASONING_NEVER_EXPOSE" }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "fixture-read",
              type: "function",
              function: { name: "read_", arguments: args.slice(0, half) },
            },
          ],
        }),
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                function: { name: "source", arguments: args.slice(half) },
              },
            ],
          },
          "tool_calls",
          { prompt_tokens: 123, completion_tokens: 10 },
        ),
      ]);
    } else {
      assert.equal(
        round,
        2,
        "Success smoke should require exactly one real tool round",
      );
      const last = payload.messages.at(-1);
      assert.equal(last.role, "tool");
      assert.equal(last.tool_call_id, "fixture-read");
      const result = JSON.parse(last.content);
      assert(
        result.sources.some((source) => source.id === firstSource.id),
        "read_source tool result must include the discovered real source",
      );
      observations.toolResultSourceCount = result.sources.length;
      for (const source of result.sources) await verifyRealSource(source);
      const answer = fixtureAnswerText();
      const midpoint = Math.floor(answer.length / 2);
      await writeSSE(response, [
        chunk({ content: answer.slice(0, midpoint) }),
        chunk({ content: answer.slice(midpoint) }),
        chunk({}, "stop", { prompt_tokens: 200, completion_tokens: 20 }),
      ]);
    }
  } catch (error) {
    fixtureFailures.push(
      error instanceof Error ? error.message : "Fixture assertion failed",
    );
    if (!response.headersSent)
      response.writeHead(500, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: { message: "Local fixture assertion failed" } }),
    );
  }
}
async function* browserEvents(body) {
  assert(body, "Chat must have a streaming response body");
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const name = frame
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.slice(7);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (name && data) yield { event: name, data: JSON.parse(data) };
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function chatRequest(signal) {
  const response = await fetch(`${webUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Model-Api-Key": syntheticKey,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      language,
      answerLanguage,
      depth: "standard",
      mode: "byok",
      snapshotId: report.corpus.snapshotId,
    }),
    signal: signal || AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, "Chat API must open an SSE response");
  assert(response.headers.get("content-type")?.includes("text/event-stream"));
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const events = [];
  for await (const event of browserEvents(response.body)) {
    events.push(event);
    if (event.event === "done" || event.event === "error") break;
  }
  return events;
}
async function waitWeb() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert(
      child.exitCode === null,
      "Isolated production web server exited before readiness",
    );
    try {
      const status = await jsonFetch(`${webUrl}/api/status`, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(6000, deadline - Date.now())),
        ),
      });
      if (
        status.ready &&
        status.activeSnapshot?.id === report.corpus.snapshotId
      )
        return status;
    } catch {
      /* bounded startup polling */
    }
    await delay(250);
  }
  throw new Error(
    "Isolated production web server did not become ready in 30 seconds",
  );
}

try {
  await mkdir(path.dirname(reportBase), { recursive: true });
  await access(entry);
  report.runtime = {
    node: process.version,
    standaloneEntry: path.relative(root, entry),
    buildId: (
      await readFile(path.join(root, "apps/web/.next/BUILD_ID"), "utf8")
    ).trim(),
  };
  const status = await jsonFetch(`${knowledgeUrl}/v1/status`, {
    headers: knowledgeHeaders,
  });
  assert(
    status.ready &&
      status.activeSnapshot?.state === "ready" &&
      status.documentCount > 0 &&
      status.chunkCount > 0,
    "A ready imported real knowledge catalog is required",
  );
  report.corpus = {
    snapshotId: status.activeSnapshot.id,
    sourceRepo: status.activeSnapshot.sourceRepo,
    sourceCommit: status.activeSnapshot.sourceCommit,
    gameVersion: status.activeSnapshot.gameVersion ?? null,
    storageAdapter: status.storage?.adapter ?? null,
    retrieval: status.retrieval,
    documentCount: status.documentCount,
    chunkCount: status.chunkCount,
    languages: status.languages,
  };
  scratch = await mkdtemp(path.join(tmpdir(), "void-agent-smoke-"));
  const cert = path.join(scratch, "fixture.crt");
  const key = path.join(scratch, "fixture.key");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ],
    { stdio: "ignore" },
  );
  fixture = createServer(
    { cert: await readFile(cert), key: await readFile(key) },
    (request, response) => {
      void fixtureHandler(request, response);
    },
  );
  fixture.listen(modelPort, "localhost");
  await once(fixture, "listening");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(webPort),
    KNOWLEDGE_URL: knowledgeUrl,
    DEEPSEEK_BASE_URL: modelUrl,
    DEEPSEEK_ALLOWED_BASE_URLS: modelUrl,
    DEEPSEEK_MODEL: "deepseek-flash",
    DEEPSEEK_API_KEY: "",
    SHARED_MODE_ENABLED: "false",
    PUBLIC_APP_ORIGIN: "",
    NODE_EXTRA_CA_CERTS: cert,
  };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.NODE_DEBUG;
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const pipe of [child.stdout, child.stderr])
    pipe.on("data", (data) => {
      webLog = (webLog + data.toString()).slice(-30000);
    });
  await waitWeb();
  report.checks.push({
    name: "production-web-and-real-catalog-ready",
    passed: true,
  });
  const connection = await jsonFetch(`${webUrl}/api/models/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Model-Api-Key": syntheticKey,
    },
    body: JSON.stringify({ mode: "byok" }),
  });
  assert.equal(connection.ok, true);
  assert.equal(observations.modelListings, 1);
  assert.equal(round, 0);
  report.checks.push({
    name: "https-model-listing-with-private-test-ca-no-generation",
    passed: true,
  });
  const events = await chatRequest();
  assert.equal(fixtureFailures.length, 0, fixtureFailures.join("; "));
  assert.equal(round, 2);
  assert(
    events.some(
      (event) => event.event === "status" && event.data.stage === "searching",
    ),
    "Browser SSE must report mandatory retrieval",
  );
  assert(
    events.some(
      (event) => event.event === "status" && event.data.stage === "reading",
    ),
    "Browser SSE must report a real tool read",
  );
  assert.equal(events.at(-1)?.event, "done");
  assert.equal(events.at(-1).data.snapshotId, report.corpus.snapshotId);
  assert.equal(events.at(-1).data.finishReason, "stop");
  assert(
    !events.at(-1).data.citationWarnings?.length,
    "Known fixture citation must not produce citation warnings",
  );
  assert.deepEqual(events.at(-1).data.usage, {
    inputTokens: 323,
    outputTokens: 30,
  });
  assert.equal(
    events
      .filter((event) => event.event === "text_delta")
      .map((event) => event.data.text)
      .join(""),
    fixtureAnswerText(),
  );
  assert(
    !JSON.stringify(events).includes("PRIVATE_FIXTURE_REASONING_NEVER_EXPOSE"),
  );
  let previous = [];
  for (const event of events.filter((event) => event.event === "sources")) {
    assert.equal(event.data.snapshotId, report.corpus.snapshotId);
    assert.deepEqual(
      event.data.sources.slice(0, previous.length),
      previous,
      "Sources must remain cumulative and immutable",
    );
    previous = event.data.sources;
  }
  assert(previous.length > 0 && previous[0].citation === 1);
  report.citation = {
    id: firstSource.id,
    documentId: firstSource.documentId,
    title: firstSource.title,
    type: firstSource.type,
    language: firstSource.language,
    sourceUrl: firstSource.sourceUrl,
    snapshotId: firstSource.snapshotId,
    matchedExcerptUtf8Bytes: Buffer.byteLength(firstSource.text),
    matchedExcerptSha256: createHash("sha256")
      .update(firstSource.text)
      .digest("hex"),
  };
  report.checks.push({
    name: "real-retrieval-read-source-tool-round-and-cited-browser-sse",
    passed: true,
    eventNames: events.map((event) => event.event),
    sourceCount: previous.length,
    fixtureReportedUsage: events.at(-1).data.usage,
  });
  const browserSource = await jsonFetch(
    `${webUrl}/api/sources/${encodeURIComponent(firstSource.id)}?snapshotId=${encodeURIComponent(firstSource.snapshotId)}`,
  );
  assert.equal(browserSource.source.id, firstSource.id);
  assert.equal(browserSource.source.snapshotId, firstSource.snapshotId);
  assert.equal(
    browserSource.source.text.slice(0, firstSource.text.length),
    firstSource.text,
  );
  assert.equal(browserSource.source.sourceUrl, firstSource.sourceUrl);
  report.checks.push({
    name: "browser-citation-source-proxy-matches-real-catalog",
    passed: true,
  });
  for (const [fixtureScenario, expectedCode] of [
    ["auth", "MODEL_AUTH"],
    ["rate", "MODEL_RATE_LIMIT"],
  ]) {
    scenario = fixtureScenario;
    const failed = await chatRequest();
    assert.equal(failed.at(-1)?.event, "error");
    assert.equal(failed.at(-1).data.code, expectedCode);
    assert.equal(failed.at(-1).data.retryable, fixtureScenario === "rate");
    assert(!JSON.stringify(failed).includes(syntheticKey));
    assert(!JSON.stringify(failed).includes("RAW_FIXTURE_DIAGNOSTIC"));
    report.checks.push({
      name: `masked-upstream-${fixtureScenario === "auth" ? "401" : "429"}`,
      passed: true,
      code: expectedCode,
    });
  }
  scenario = "cancel";
  upstreamClosed = defer();
  upstreamStarted = defer();
  const controller = new AbortController();
  const response = await fetch(`${webUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Model-Api-Key": syntheticKey,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      language,
      answerLanguage,
      depth: "standard",
      mode: "byok",
      snapshotId: report.corpus.snapshotId,
    }),
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const consume = (async () => {
    try {
      for await (const event of browserEvents(response.body)) {
        if (event.event === "text_delta") {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  await withTimeout(
    upstreamStarted.promise,
    15000,
    "Cancellation fixture was not contacted",
  );
  await consume;
  assert(
    controller.signal.aborted,
    "Browser must abort after receiving the fixture text delta",
  );
  await withTimeout(
    upstreamClosed.promise,
    8000,
    "Browser abort did not close the upstream HTTPS stream",
  );
  assert(observations.cancellationObserved);
  report.checks.push({
    name: "browser-abort-closes-upstream-https-stream",
    passed: true,
  });
  assert.equal(fixtureFailures.length, 0, fixtureFailures.join("; "));
  report.observations = observations;
  report.passed = true;
} catch (error) {
  report.failure = redact(
    error instanceof Error ? error.message : "Smoke test failed",
  ).slice(0, 2000);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (fixture) {
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
  if (scratch) await rm(scratch, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(`${reportBase}.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${reportBase}.web.log`, redact(webLog));
  const lines = [
    "# Agent HTTP smoke",
    "",
    `Result: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    report.evidenceBoundary,
    "",
    `Knowledge: ${knowledgeUrl}`,
    `Web: ${webUrl}`,
    `Local fixture: ${modelUrl}`,
    `Source language: ${language}; answer language: ${answerLanguage}.`,
    "",
    ...(report.corpus
      ? [
          `Real snapshot: ${report.corpus.snapshotId}`,
          `Documents: ${report.corpus.documentCount}; chunks: ${report.corpus.chunkCount}`,
          `Source commit: ${report.corpus.sourceCommit}`,
          "",
        ]
      : []),
    ...report.checks.map((check) => `- PASS ${check.name}`),
    ...(report.failure ? ["", `Failure: ${report.failure}`] : []),
    "",
    "TLS validation stayed enabled. A fresh temporary certificate was trusted by the isolated child only through NODE_EXTRA_CA_CERTS; fixture certificate/key were removed on cleanup. This does not demonstrate real DeepSeek generation, production proxy acceptance, or semantic retrieval quality.",
    "",
    `Detailed evidence: ${path.relative(root, reportBase)}.json`,
    "",
  ];
  await writeFile(`${reportBase}.md`, lines.join("\n"));
  process.stdout.write(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      report: path.relative(root, `${reportBase}.md`),
      ...(report.failure ? { failure: report.failure } : {}),
    }) + "\n",
  );
}
