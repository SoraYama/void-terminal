import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/lib/server/agent";
import type { ChatEvent, ChatRequest, Source } from "../src/lib/contracts";

const source = (id = "a", language = "zh-CN", snapshotId = "s1") =>
  ({
    id,
    documentId: "doc",
    title: "旅行者",
    type: "quest",
    language,
    text: "证据文本",
    path: "quest.json",
    locator: "line:1",
    sourceUrl: "https://github.com/test/repo/blob/abc/quest.json",
    snapshotId,
  }) as Source;
const request: ChatRequest = {
  messages: [{ role: "user", content: "旅行者是谁？" }],
  language: "zh-CN",
  mode: "byok",
  depth: "standard",
};
function upstream(chunks: unknown[], cancel?: () => void) {
  const bytes = new TextEncoder().encode(
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
      "data: [DONE]\n\n",
  );
  return new Response(
    new ReadableStream({
      start(c) {
        for (let n = 0; n < bytes.length; n += 3)
          c.enqueue(bytes.slice(n, n + 3));
        c.close();
      },
      cancel,
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const textChunk = (text: string, finish: string | null = null) => ({
  choices: [{ delta: { content: text }, finish_reason: finish }],
  ...(finish ? { usage: { prompt_tokens: 12, completion_tokens: 6 } } : {}),
});
const search = (sources: Source[] = [source()]) =>
  Response.json({
    sources,
    snapshotId: "s1",
    mode: "lexical",
    total: sources.length,
  });
const collect = async (input = request) => {
  const events: ChatEvent[] = [];
  await runAgent(input, {
    key: "private-test-key",
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  });
  return events;
};

describe("retrieval-first bounded agent", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
  });
  it("retrieves before provider, preserves UTF8, pins snapshot and emits safe cumulative citations", async () => {
    const requests: { url: string; body: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return String(url).includes("/v1/search")
          ? search()
          : upstream([textChunk("旅行者[1]"), textChunk("", "stop")]);
      }),
    );
    const events = await collect();
    expect(requests[0].url).toContain("/v1/search");
    expect(requests[0].body.limit).toBe(10);
    expect(requests[1].body.thinking).toEqual({ type: "disabled" });
    expect(JSON.stringify(requests[1].body)).toContain("证据文本");
    expect(
      events
        .filter((e) => e.event === "text_delta")
        .map((e) => e.data.text)
        .join(""),
    ).toBe("旅行者[1]");
    expect(events.find((e) => e.event === "sources")?.data).toMatchObject({
      snapshotId: "s1",
      sources: [{ citation: 1, id: "a" }],
    });
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { snapshotId: "s1", usage: { inputTokens: 12, outputTokens: 6 } },
    });
  });
  it("assembles multiple interleaved tool deltas and only reads known source ids", async () => {
    let calls = 0;
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        paths.push(String(url));
        if (String(url).includes("/v1/search")) return search();
        if (String(url).includes("/v1/sources/a"))
          return Response.json({
            source: source(),
            context: [source("b")],
            related: [],
          });
        calls++;
        return calls === 1
          ? upstream([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "c1",
                          function: {
                            name: "read_source",
                            arguments: '{"source',
                          },
                        },
                        {
                          index: 1,
                          id: "c2",
                          function: {
                            name: "read_source",
                            arguments: '{"sourceId":"unknown"}',
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, function: { arguments: 'Id":"a"}' } },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 3 },
              },
            ])
          : upstream([textChunk("回答[2]", "stop")]);
      }),
    );
    const events = await collect();
    expect(paths.some((p) => p.includes("unknown"))).toBe(false);
    expect(calls).toBe(2);
    expect(
      events.filter((e) => e.event === "sources").at(-1)?.data,
    ).toMatchObject({
      sources: [
        { id: "a", citation: 1 },
        { id: "b", citation: 2 },
      ],
    });
  });
  it("does not call provider when retrieval is empty", async () => {
    const fetcher = vi.fn(async () => search([]));
    vi.stubGlobal("fetch", fetcher);
    const events = await collect();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { finishReason: "no_evidence" },
    });
    expect(events.some((e) => e.event === "text_delta")).toBe(true);
  });
  it("fails closed on an unavailable knowledge service and never leaks upstream errors or key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("private-test-key stack exception", { status: 503 }),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "KNOWLEDGE_UNAVAILABLE" },
    });
    expect(JSON.stringify(events)).not.toContain("private-test-key");
  });
  it("rejects sources with a different requested language or snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => search([source("bad", "en")])),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "INVALID_EVIDENCE" },
    });
  });
  it("stops after four tool rounds plus one final provider call", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/v1/search")) return search();
        calls++;
        return upstream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `c${calls}`,
                      function: {
                        name: "search_corpus",
                        arguments: '{"query":"旅行者"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          },
        ]);
      }),
    );
    const events = await collect();
    expect(calls).toBe(5);
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "TOOL_LIMIT" },
    });
  });
  it("aborts provider consumption and reports unknown billing on cancellation", async () => {
    const controller = new AbortController();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) return search();
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const events: ChatEvent[] = [];
    const result = await runAgent(request, {
      key: "private-test-key",
      signal: controller.signal,
      emit: (e) => events.push(e),
    });
    expect(aborted).toBe(true);
    expect(result.usedTokens).toBeNull();
    expect(events.some((e) => e.event === "done")).toBe(false);
  });
  it("reports unknown citation labels instead of presenting them as supported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/v1/search")
          ? search()
          : upstream([textChunk("结论[99]", "stop")]),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { citationWarnings: ["Unknown citation [99]"] },
    });
  });
  it("retains unknown billing from an earlier tool round even if the final round reports usage", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/v1/search")) return search();
        calls++;
        return calls === 1
          ? upstream([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "c",
                          function: {
                            name: "search_corpus",
                            arguments: '{\"query\":\"test\"}',
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ])
          : upstream([textChunk("Answer[1]", "stop")]);
      }),
    );
    const events: ChatEvent[] = [];
    const result = await runAgent(request, {
      key: "private-test-key",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    expect(result.usedTokens).toBeNull();
    expect(events.at(-1)).not.toHaveProperty("data.usage");
  });
  it("preserves dialogue branch and book volume metadata in model evidence", async () => {
    let providerBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search"))
          return search([
            {
              ...source(),
              metadata: {
                conditions: ["branch A"],
                nextIds: ["n2"],
                series: "Book I",
                volume: 2,
              },
            },
          ]);
        providerBody = String(init?.body);
        return upstream([textChunk("Answer[1]", "stop")]);
      }),
    );
    await collect();
    expect(providerBody).toContain("branch A");
    expect(providerBody).toContain("Book I");
  });
  it("bounds initial retrieval query to the knowledge service maximum", async () => {
    let query = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        query = JSON.parse(String(init?.body)).query;
        return search([]);
      }),
    );
    await collect({
      ...request,
      messages: [{ role: "user", content: "长".repeat(12000) }],
    });
    expect(query.length).toBe(2000);
  });
  it("follows only discovered related documents and keeps branch conditions in tool results", async () => {
    let rounds = 0;
    let lastPayload = "";
    const ids: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (path.includes("/v1/search")) return search();
        if (path.includes("/v1/sources/"))
          return Response.json({
            source: source(),
            context: [],
            related: [
              {
                id: "branch",
                title: "Branch",
                type: "quest",
                language: "zh-CN",
                excerpt: "分支",
                snapshotId: "s1",
                metadata: { relation: { condition: "choice A" } },
              },
            ],
          });
        if (path.includes("/v1/documents/")) {
          ids.push(path);
          return Response.json({
            document: { id: "branch", language: "zh-CN" },
            sources: [{ ...source("branch-source"), documentId: "branch" }],
            snapshotId: "s1",
          });
        }
        rounds++;
        lastPayload = String(init?.body);
        if (rounds === 3) return upstream([textChunk("Answer[2]", "stop")]);
        return upstream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "c" + rounds,
                      function: {
                        name: rounds === 1 ? "read_source" : "read_document",
                        arguments:
                          rounds === 1
                            ? '{\"sourceId\":\"a\"}'
                            : '{\"documentId\":\"branch\"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          },
        ]);
      }),
    );
    const events = await collect();
    expect(ids).toHaveLength(1);
    expect(lastPayload).toContain("choice A");
    expect(events.at(-1)).toMatchObject({ event: "done" });
  });
  it("cancels a pending upstream stream reader when the browser aborts", async () => {
    const controller = new AbortController();
    let streamCancelled = false;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/v1/search")) return search();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(
                  "data: " + JSON.stringify(textChunk("partial")) + "\n\n",
                ),
              );
              started();
            },
            cancel() {
              streamCancelled = true;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }),
    );
    const events: ChatEvent[] = [];
    const running = runAgent(request, {
      key: "private-test-key",
      signal: controller.signal,
      emit: (e) => events.push(e),
    });
    await ready;
    controller.abort();
    const result = await running;
    expect(streamCancelled).toBe(true);
    expect(result.usedTokens).toBeNull();
    expect(
      events.filter((e) => e.event === "done" || e.event === "error"),
    ).toHaveLength(0);
  });
  it("pins follow-up retrieval to the initial snapshot even when the active snapshot could change", async () => {
    let round = 0;
    const snapshots: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) {
          snapshots.push(JSON.parse(String(init?.body)).snapshotId);
          return search();
        }
        round++;
        return round === 1
          ? upstream([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "c",
                          function: {
                            name: "search_corpus",
                            arguments: '{\"query\":\"more\"}',
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 5, completion_tokens: 3 },
              },
            ])
          : upstream([textChunk("Answer[1]", "stop")]);
      }),
    );
    await collect();
    expect(snapshots).toEqual([undefined, "s1"]);
  });
  it("treats an unterminated upstream stream as incomplete rather than successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/v1/search")
          ? search()
          : new Response(
              "data: " + JSON.stringify(textChunk("partial")) + "\n\n",
              { headers: { "content-type": "text/event-stream" } },
            ),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "MODEL_STREAM_INCOMPLETE" },
    });
  });
  it("returns a masked authentication error for an invalid upstream key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/v1/search")
          ? search()
          : new Response("private-test-key provider diagnostic", {
              status: 401,
            }),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "MODEL_AUTH", retryable: false },
    });
    expect(JSON.stringify(events)).not.toContain("private-test-key");
  });
  it("reports an explicitly unavailable corpus instead of fabricating sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          sources: [],
          snapshotId: null,
          mode: "lexical",
          total: 0,
        }),
      ),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "NO_SNAPSHOT" },
    });
  });
  it("enforces explicit snapshot matching on returned evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => search([source("a", "zh-CN", "s2")])),
    );
    const events = await collect({ ...request, snapshotId: "s1" });
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "INVALID_EVIDENCE" },
    });
  });
  it("returns already registered citations in a follow-up search result without renumbering", async () => {
    let round = 0;
    let lastBody: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) return search();
        round++;
        lastBody = JSON.parse(String(init?.body));
        return round === 1
          ? upstream([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "c",
                          function: {
                            name: "search_corpus",
                            arguments: '{"query":"repeat"}',
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 3 },
              },
            ])
          : upstream([textChunk("Answer[1]", "stop")]);
      }),
    );
    const events = await collect();
    const result = JSON.parse(lastBody.messages.at(-1).content);
    expect(result.sources).toMatchObject([{ id: "a", citation: 1 }]);
    expect(
      events.filter((e) => e.event === "sources").at(-1)?.data,
    ).toMatchObject({ sources: [{ id: "a", citation: 1 }] });
  });
  it("reads a valid 101-chunk document around the known hit within source and text budgets", async () => {
    const chunks = Array.from({ length: 101 }, (_, index) => ({
      ...source(`chunk-${index}`),
      text: `Passage ${index}: ` + "x".repeat(1000),
    }));
    let round = 0;
    let result: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) return search([chunks[80]]);
        if (String(url).includes("/v1/documents/"))
          return Response.json({
            document: { id: "doc", language: "zh-CN" },
            sources: chunks,
            snapshotId: "s1",
          });
        round++;
        if (round === 1)
          return upstream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "read",
                        function: {
                          name: "read_document",
                          arguments: '{"documentId":"doc"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 3 },
            },
          ]);
        result = JSON.parse(
          JSON.parse(String(init?.body)).messages.at(-1).content,
        );
        return upstream([textChunk("Answer[1]", "stop")]);
      }),
    );
    const events = await collect();
    expect(events.at(-1)).toMatchObject({ event: "done" });
    expect(round).toBe(2);
    const citations = events.filter((e) => e.event === "sources").at(-1)!.data
      .sources;
    expect(citations.length).toBeLessThanOrEqual(40);
    expect(
      citations.reduce((sum, item) => sum + item.text.length, 0),
    ).toBeLessThanOrEqual(24000);
    expect(citations[0]).toMatchObject({ id: "chunk-80", citation: 1 });
    expect(citations.some((item) => item.id === "chunk-79")).toBe(true);
    expect(citations.some((item) => item.id === "chunk-81")).toBe(true);
    expect(citations.some((item) => item.id === "chunk-0")).toBe(false);
    expect(result.selection).toMatchObject({
      totalSources: 101,
      truncated: true,
    });
  });
  it("instructs the provider to preserve unknown context and canon state for unmapped TextMap evidence", async () => {
    let instruction = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search"))
          return search([
            {
              ...source(),
              metadata: {
                kind: "orphan_textmap",
                contextUnknown: true,
                testState: "unknown",
                schemaState: "unmapped",
                sourceHash: "12345",
              },
            },
          ]);
        instruction = JSON.parse(String(init?.body)).messages[0].content;
        return upstream([textChunk("未归属原文[1]", "stop")]);
      }),
    );
    await collect();
    expect(instruction).toContain("quote as unmapped source text only");
    expect(instruction).toContain(
      "cannot establish a confirmed plot, speaker, quest, chronology, game version, publication state, or canon",
    );
    expect(instruction).toContain("orphan_textmap");
    expect(instruction).toContain("testState");
  });
  it("keeps critical orphan and relation metadata ahead of incidental metadata keys", async () => {
    let parsed: any;
    const noise = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `incidental${index}`,
        "filler",
      ]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search"))
          return search([
            {
              ...source(),
              metadata: {
                ...noise,
                kind: "orphan_textmap",
                contextUnknown: true,
                testState: "unknown",
                schemaState: "unmapped",
                sourceHash: "12345",
                contextRelation: {
                  fromDocumentId: "previous",
                  targetId: "doc",
                  kind: "next",
                  condition: "only after choice A",
                },
              },
            },
          ]);
        parsed = JSON.parse(
          JSON.parse(String(init?.body)).messages[0].content.split(
            "Initial evidence:\n",
          )[1],
        );
        return upstream([textChunk("引用[1]", "stop")]);
      }),
    );
    await collect();
    expect(parsed.sources[0].metadata).toMatchObject({
      kind: "orphan_textmap",
      contextUnknown: true,
      testState: "unknown",
      schemaState: "unmapped",
      sourceHash: "12345",
      contextRelation: { condition: "only after choice A" },
    });
  });
  it("answers in the UI language while retrieving and quoting the selected source language", async () => {
    const queries: any[] = [];
    let prompt = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) {
          queries.push(JSON.parse(String(init?.body)));
          return search();
        }
        prompt = JSON.parse(String(init?.body)).messages[0].content;
        return upstream([textChunk("Evidence [1]", "stop")]);
      }),
    );
    const events = await collect({ ...request, answerLanguage: "en" });
    expect(queries[0].language).toBe("zh-CN");
    expect(prompt).toContain("Answer in en.");
    expect(prompt).toContain("source language is zh-CN");
    expect(prompt).toContain("non-official translation");
    expect(prompt).toContain("Preserve original quotations");
    expect(prompt).toContain("证据文本");
    expect(
      events.find((e) => e.event === "sources")?.data.sources[0].language,
    ).toBe("zh-CN");
  });
  it("uses answer language for no-evidence feedback without changing retrieval language", async () => {
    let retrievalLanguage = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        retrievalLanguage = JSON.parse(String(init?.body)).language;
        return search([]);
      }),
    );
    const events = await collect({ ...request, answerLanguage: "en" });
    expect(retrievalLanguage).toBe("zh-CN");
    expect(events.find((e) => e.event === "text_delta")?.data.text).toMatch(
      /^No matching evidence/,
    );
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { finishReason: "no_evidence" },
    });
  });
  it.each([
    "她呢？",
    "那后来发生什么？",
    "What happened next?",
    "那她为什么这样？",
    "那她呢？",
    "那他呢？",
    "那它呢？",
    "那么她呢？",
  ])(
    "retrieves a referenced user topic for follow-up %s without using assistant claims",
    async (followup) => {
      let query = "";
      let modelCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url, init) => {
          if (String(url).includes("/v1/search")) {
            query = JSON.parse(String(init?.body)).query;
            return query.includes("纳西妲")
              ? search([{ ...source("nahida"), title: "纳西妲" }])
              : search([]);
          }
          if (String(url).includes("/v1/sources/")) return Response.json({source: {...source("nahida"), title: "纳西妲"}, context: [], related: []});
          modelCalls++;
          return upstream([textChunk("有来源的追问回答[1]", "stop")]);
        }),
      );
      const events = await collect({
        ...request,
        snapshotId: "s1",
        types: ["quest"],
        messages: [
          { role: "user", content: "纳西妲是谁？" },
          { role: "assistant", content: "ASSISTANT_UNSUPPORTED_CLAIM" },
          { role: "user", content: followup },
        ],
      });
      expect(query).toContain("纳西妲是谁");
      expect(query).toContain(followup);
      expect(query).not.toContain("ASSISTANT_UNSUPPORTED_CLAIM");
      expect(modelCalls).toBe(['那后来发生什么？','What happened next?','那她为什么这样？'].includes(followup) ? 2 : 1);
      expect(events.at(-1)).toMatchObject({
        event: "done",
        data: { finishReason: "stop", snapshotId: "s1" },
      });
    },
  );
  it("retains the nearest explicit topic through short follow-up chains and excludes older topics", async () => {
    let query = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        query = JSON.parse(String(init?.body)).query;
        return search([]);
      }),
    );
    await collect({
      ...request,
      messages: [
        { role: "user", content: "钟离是谁？" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "纳西妲是谁？" },
        { role: "assistant", content: "回答" },
        { role: "user", content: "她呢？" },
        { role: "assistant", content: "继续回答" },
        { role: "user", content: "那后来发生什么？" },
      ],
    });
    expect(query).toContain("纳西妲是谁");
    expect(query).toContain("那后来发生什么");
    expect(query).not.toContain("钟离");
    expect(query.length).toBeLessThanOrEqual(2000);
  });
  it.each(["那维莱特是谁？", "Who is Zhongli?"])(
    "keeps a self-contained new topic independent of earlier user questions: %s",
    async (topic) => {
      let query = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          query = JSON.parse(String(init?.body)).query;
          return search([]);
        }),
      );
      await collect({
        ...request,
        messages: [
          { role: "user", content: "纳西妲是谁？" },
          { role: "assistant", content: "回答" },
          { role: "user", content: topic },
        ],
      });
      expect(query).toBe(topic);
    },
  );
  it("does not dispatch a model when history-aware retrieval still has no actual evidence", async () => {
    const urls: string[] = [];
    let query = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        urls.push(String(url));
        query = JSON.parse(String(init?.body)).query;
        return search([]);
      }),
    );
    const events = await collect({
      ...request,
      messages: [
        { role: "user", content: "不存在的角色 void-unknown-7823 是谁？" },
        { role: "assistant", content: "纳西妲 ASSISTANT_FABRICATION" },
        { role: "user", content: "她呢？" },
      ],
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/v1/search");
    expect(query).toContain("void-unknown-7823");
    expect(query).not.toContain("纳西妲");
    expect(query).not.toContain("ASSISTANT_FABRICATION");
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { finishReason: "no_evidence" },
    });
  });
  it("gives only search calls thirty-second headroom while retaining read timeouts and caller cancellation", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    let modelCalls = 0;
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url).includes("/v1/search")) {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          return search();
        }
        if (String(url).includes("/v1/sources/")) {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
          });
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        }
        modelCalls++;
        return upstream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "read",
                      function: {
                        name: "read_source",
                        arguments: '{"sourceId":"a"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3 },
          },
        ]);
      }),
    );
    try {
      const result = await runAgent(request, {
        key: "private-test-key",
        signal: controller.signal,
        emit: () => {},
      });
      expect(timeout.mock.calls.map((args) => args[0])).toEqual([
        180000, 30000, 12000,
      ]);
      expect(aborted).toBe(true);
      expect(modelCalls).toBe(1);
      expect(result.usedTokens).toBeNull();
    } finally {
      timeout.mockRestore();
    }
  });
  it("bounds contextual questions and preserves search filters when caller aborts initial retrieval", async () => {
    const controller = new AbortController();
    let body: any;
    let aborted = false;
    const followup = "她的经历" + "后来".repeat(190);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        body = JSON.parse(String(init?.body));
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const events: ChatEvent[] = [];
    const result = await runAgent(
      {
        ...request,
        snapshotId: "s1",
        types: ["quest"],
        messages: [
          {
            role: "user",
            content: "问题开头" + "x".repeat(11000) + "纳西妲是谁？",
          },
          { role: "assistant", content: "UNTRUSTED_ASSISTANT" },
          { role: "user", content: followup },
        ],
      },
      {
        key: "private-test-key",
        signal: controller.signal,
        emit: (event) => events.push(event),
      },
    );
    expect(body).toMatchObject({
      snapshotId: "s1",
      language: "zh-CN",
      types: ["quest"],
      limit: 10,
    });
    expect(body.query.length).toBeLessThanOrEqual(2000);
    expect(body.query).toContain("问题开头");
    expect(body.query).toContain("纳西妲是谁");
    expect(body.query.endsWith(followup)).toBe(true);
    expect(body.query).not.toContain("UNTRUSTED_ASSISTANT");
    expect(aborted).toBe(true);
    expect(result.usedTokens).toBe(0);
    expect(events.some((event) => event.event === "done")).toBe(false);
  });
  it("does not expose reasoning deltas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/v1/search")
          ? search()
          : upstream([
              {
                choices: [
                  {
                    delta: { reasoning_content: "private thoughts" },
                    finish_reason: null,
                  },
                ],
              },
              textChunk("回答[1]", "stop"),
            ]),
      ),
    );
    expect(JSON.stringify(await collect())).not.toContain("private thoughts");
  });
});

describe('lore explanation evidence preparation', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'); });
  const toolRound = (args: Record<string, unknown>) => upstream([{
    choices: [{delta: {tool_calls: [{index: 0, id: 'search', function: {name: 'search_corpus', arguments: JSON.stringify(args)}}]}, finish_reason: 'tool_calls'}],
    usage: {prompt_tokens: 10, completion_tokens: 3},
  }]);
  it('finds reviewed nicknames without treating the nickname as proof of identity', async () => {
    let query = '';
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/v1/search')) {
        query = JSON.parse(String(init?.body)).query;
        return query.includes('炽烈的炎之魔女') ? search() : search([]);
      }
      return upstream([textChunk('相关套装原文[1]', 'stop')]);
    }));
    const events = await collect({...request, messages: [{role: 'user', content: '魔女套'}]});
    expect(query).toContain('魔女套');
    expect(events.at(-1)).toMatchObject({event: 'done', data: {finishReason: 'stop'}});
  });
  it('reads mapped narrative context before generation, once per document and at most two documents', async () => {
    const paths: string[] = []; let modelBody: any; let searchBody: any;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      paths.push(String(url));
      if (String(url).includes('/v1/search')) {
        searchBody = JSON.parse(String(init?.body));
        return search([source('a'), source('duplicate-document'), {...source('b'), documentId:'doc2'}, {...source('c'), documentId:'doc3'}]);
      }
      if (String(url).includes('/v1/sources/')) {
        const id = String(url).includes('/a?') ? 'a' : 'b';
        return Response.json({source: {...source(id), documentId: id === 'a' ? 'doc' : 'doc2'}, context: [{...source('context-'+id), text:'有分支条件的上下文', metadata:{contextRelation:{kind:'next',condition:'quest == 3'}}}], related:[]});
      }
      modelBody=JSON.parse(String(init?.body));return upstream([textChunk('故事解释[1]', 'stop')]);
    }));
    await collect({...request, messages:[{role:'user',content:'请梳理须弥魔神任务的剧情脉络'}]});
    expect(searchBody.types).toEqual(['quest','dialogue']);
    expect(paths.filter(p=>p.includes('/v1/sources/'))).toHaveLength(2);
    expect(paths.at(-1)).toContain('/chat/completions');
    expect(JSON.stringify(modelBody.messages)).toContain('有分支条件的上下文');
    expect(JSON.stringify(modelBody.messages)).toContain('quest == 3');
    expect(paths.filter(p=>p.includes('/v1/sources/')).every(p=>p.includes('snapshotId=s1'))).toBe(true);
  });
  it('does not prefetch unmapped text as narrative context', async () => {
    const paths: string[]=[];
    vi.stubGlobal('fetch',vi.fn(async url=>{
      paths.push(String(url));
      return String(url).includes('/v1/search') ? search([{...source(),metadata:{contextUnknown:true,kind:'orphan_textmap'}}]) : upstream([textChunk('无法确认上下文[1]','stop')]);
    }));
    await collect({...request,messages:[{role:'user',content:'讲讲这个故事'}]});
    expect(paths.some(p=>p.includes('/v1/sources/'))).toBe(false);
  });
  it('rejects a context read from another snapshot before generation', async () => {
    let modelCalls=0;
    vi.stubGlobal('fetch',vi.fn(async url=>{
      if(String(url).includes('/v1/search'))return search();
      if(String(url).includes('/v1/sources/'))return Response.json({source:source('a','zh-CN','wrong-snapshot'),context:[],related:[]});
      modelCalls++;return upstream([textChunk('bad','stop')]);
    }));
    const events=await collect({...request,messages:[{role:'user',content:'讲讲旅行者的故事'}]});
    expect(events.at(-1)).toMatchObject({event:'error',data:{code:'INVALID_EVIDENCE'}});
    expect(modelCalls).toBe(0);
  });
  it.each([{types:['dialogue'],allowed:true},{types:['book'],allowed:false}])('tool search respects selected content filters: $types',async ({types,allowed})=>{
    const queries:any[]=[];let round=0;let lastBody:any;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){queries.push(JSON.parse(String(init?.body)));return search([{...source(),type:'dialogue'}]);}
      lastBody=JSON.parse(String(init?.body));round++;
      return round===1?toolRound({query:'相关对白',types}):upstream([textChunk('解释[1]','stop')]);
    }));
    await collect({...request,types:['quest','dialogue']});
    if(allowed){
      expect(queries).toHaveLength(2);expect(queries[1].types).toEqual(['dialogue']);
    }else{
      expect(queries).toHaveLength(1);expect(lastBody.messages.at(-1).content).toContain('TOOL_NOT_ALLOWED');
    }
  });
  it('reports matched evidence omitted by the citation budget instead of claiming the corpus has no results',async()=>{
    let searches=0,round=0,lastBody:any;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){
        searches++;return search(Array.from({length:10},(_,i)=>source(`batch-${searches}-${i}`)));
      }
      round++;lastBody=JSON.parse(String(init?.body));
      return round<=4?toolRound({query:`more ${round}`}):upstream([textChunk('已有资料[1]','stop')]);
    }));
    await collect();
    const selections=JSON.parse(lastBody.messages[0].content.split('Research selections:\n')[1].split('\nContext preparation:')[0]);
    expect(selections.at(-1)).toMatchObject({matchedSources:10,includedSources:0,truncated:true});
    expect(lastBody.tools).toBeUndefined();
    expect(lastBody.messages.some((m:any)=>m.role==='tool')).toBe(false);
    const evidence=JSON.parse(lastBody.messages[0].content.split('Initial evidence:\n')[1]);
    expect(evidence.sources).toHaveLength(40);
  });
});

describe('inferred lore search scope',()=>{
  it('falls back within the pinned snapshot when the inferred narrative category is empty',async()=>{
    vi.unstubAllEnvs();const queries:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){
        const query=JSON.parse(String(init?.body));queries.push(query);
        return query.types?search([]):search([{...source(),type:'other',metadata:{contextUnknown:true}}]);
      }
      return upstream([textChunk('找到的原文[1]','stop')]);
    }));
    const events=await collect({...request,messages:[{role:'user',content:'魔女套的故事'}]});
    expect(queries).toHaveLength(2);expect(queries[0].types).toEqual(['artifact']);
    expect(queries[1].types).toBeUndefined();expect(queries[1].snapshotId).toBe('s1');
    expect(events.at(-1)).toMatchObject({event:'done',data:{finishReason:'stop'}});
  });
});

describe('research and answer separation',()=>{
  it('discards tool-round narration and its citation labels from the final answer',async()=>{
    vi.unstubAllEnvs();let round=0;
    vi.stubGlobal('fetch',vi.fn(async(url)=>{
      if(String(url).includes('/v1/search'))return search();
      round++;
      return round===1?upstream([textChunk('我先补几次检索。[999]'),{choices:[{delta:{tool_calls:[{index:0,id:'lookup',function:{name:'search_corpus',arguments:'{"query":"旅行者"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('旅行者的故事[1]','stop')]);
    }));
    const events=await collect();
    expect(events.filter(e=>e.event==='text_delta').map(e=>e.data.text).join('')).toBe('旅行者的故事[1]');
    expect(events.at(-1)?.data).not.toHaveProperty('citationWarnings');
  });
  it('leaves evidence headroom after large automatic context reads and reports omitted context',async()=>{
    vi.unstubAllEnvs();let searches=0,round=0,lastBody:any;
    const large=(id:string)=>({...source(id),documentId:id,text:'x'.repeat(1000)});
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){
        searches++;return search(searches===1?Array.from({length:10},(_,i)=>large('initial-'+i)):[large('focused')]);
      }
      if(String(url).includes('/v1/sources/')){
        const id=String(url).includes('initial-0?')?'initial-0':'initial-1';
        return Response.json({source:large(id),context:Array.from({length:20},(_,i)=>large(id+'-context-'+i)),related:[]});
      }
      round++;lastBody=JSON.parse(String(init?.body));
      return round===1?upstream([{choices:[{delta:{tool_calls:[{index:0,id:'focused',function:{name:'search_corpus',arguments:'{"query":"更具体的剧情"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('解释[1]','stop')]);
    }));
    await collect({...request,messages:[{role:'user',content:'梳理这个故事'}]});
    const finalEvidence=JSON.parse(lastBody.messages[0].content.split('Initial evidence:\n')[1]);
    expect(finalEvidence.sources.some((source:any)=>source.id==='focused')).toBe(true);
    const preparation=JSON.parse(lastBody.messages[0].content.split('Context preparation:\n')[1].split('\nInitial evidence:')[0]);
    expect(preparation.every((r:any)=>r.selection.truncated)).toBe(true);
  });
});

describe('final synthesis coverage metadata',()=>{
  it('retains read_document truncation after discarding research tool transcripts',async()=>{
    vi.unstubAllEnvs();let round=0,lastBody:any;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search'))return search();
      if(String(url).includes('/v1/documents/'))return Response.json({document:{id:'doc',language:'zh-CN'},snapshotId:'s1',sources:Array.from({length:101},(_,i)=>({...source(i===0?'a':'chunk-'+i),text:'x'.repeat(1000)}))});
      round++;lastBody=JSON.parse(String(init?.body));
      const call=round===1?{name:'read_document',arguments:'{"documentId":"doc"}'}:{name:'search_corpus',arguments:'{"query":"another aspect"}'};
      return round<=4?upstream([{choices:[{delta:{tool_calls:[{index:0,id:'call-'+round,function:call}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('有来源的讲解[1]','stop')]);
    }));
    await collect();
    const reads=JSON.parse(lastBody.messages[0].content.split('Context preparation:\n')[1].split('\nInitial evidence:')[0]);
    expect(reads).toContainEqual(expect.objectContaining({operation:'read_document',documentId:'doc',selection:expect.objectContaining({totalSources:101,truncated:true})}));
    expect(lastBody.messages.some((m:any)=>m.role==='tool')).toBe(false);
  });
});

describe('partial search evidence',()=>{
  it('marks text clipped by the context allowance as truncated even when every result has a citation',async()=>{
    vi.unstubAllEnvs();let searches=0,round=0,lastBody:any;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){
        searches++;return search(searches===1?Array.from({length:10},(_,i)=>({...source('initial-'+i),text:'x'.repeat(2300)})):[{...source('partial'),text:'y'.repeat(2000)}]);
      }
      round++;lastBody=JSON.parse(String(init?.body));
      return round===1?upstream([{choices:[{delta:{tool_calls:[{index:0,id:'partial',function:{name:'search_corpus',arguments:'{"query":"focused passage"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('解释[1]','stop')]);
    }));
    await collect();
    const result=JSON.parse(lastBody.messages.at(-1).content);
    expect(result.sources[0].text).toHaveLength(1000);
    expect(result.selection).toMatchObject({matchedSources:1,includedSources:1,truncated:true});
  });
});

describe('literal document discovery',()=>{
  it('discovers exact-phrase documents inside the selected scope and permits reading the discovered document',async()=>{
    vi.unstubAllEnvs();let round=0;const paths:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      paths.push(String(url));
      if(String(url).includes('/v1/search'))return search();
      if(String(url).includes('/v1/documents?'))return Response.json({snapshotId:'s1',items:[{id:'chapter',title:'目标章节',type:'quest',language:'zh-CN',excerpt:'章节正文',snapshotId:'s1'}],total:1,page:1,pageSize:8});
      if(String(url).includes('/v1/documents/chapter?'))return Response.json({document:{id:'chapter',language:'zh-CN'},sources:[{...source('chapter-source'),documentId:'chapter',text:'目标章节的原文'}],snapshotId:'s1'});
      round++;
      const call=round===1?{name:'find_documents',arguments:'{"query":"目标章节","type":"quest"}'}:{name:'read_document',arguments:'{"documentId":"chapter"}'};
      return round<3?upstream([{choices:[{delta:{tool_calls:[{index:0,id:'find-'+round,function:call}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('讲解[2]','stop')]);
    }));
    const events=await collect({...request,types:['quest'],snapshotId:'s1'});
    const path=new URL(paths.find(p=>p.includes('/v1/documents?'))!);
    expect(path.searchParams.get('q')).toBe('目标章节');expect(path.searchParams.get('language')).toBe('zh-CN');expect(path.searchParams.get('snapshotId')).toBe('s1');expect(path.searchParams.get('type')).toBe('quest');
    expect(events.filter(e=>e.event==='sources').at(-1)?.data.sources.some(s=>s.text==='目标章节的原文')).toBe(true);
  });
  it('does not treat full-width numeric citations as missing citations',async()=>{
    vi.unstubAllEnvs();vi.stubGlobal('fetch',vi.fn(async url=>String(url).includes('/v1/search')?search():upstream([textChunk('知识讲解［1］','stop')])));
    const events=await collect();expect(events.at(-1)?.data).not.toHaveProperty('citationWarnings');
  });
});

describe('bounded oversized research batches',()=>{
  it('executes at most four calls from an oversized valid batch and still produces an answer',async()=>{
    vi.unstubAllEnvs();let searches=0,round=0,lastBody:any;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).includes('/v1/search')){searches++;return search();}
      round++;lastBody=JSON.parse(String(init?.body));
      return round===1?upstream([{choices:[{delta:{tool_calls:Array.from({length:5},(_,index)=>({index,id:'lookup-'+index,function:{name:'search_corpus',arguments:JSON.stringify({query:'topic '+index})}}))},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3}}]):upstream([textChunk('回答[1]','stop')]);
    }));
    const events=await collect();
    expect(searches).toBe(5);
    expect(lastBody.messages.at(-1).content).toContain('TOOL_BATCH_LIMIT');
    expect(events.at(-1)).toMatchObject({event:'done'});
  });
});

describe('deliberate narrative synthesis',()=>{
 it('synthesizes a narrative answer without tools or research chatter and never exposes reasoning',async()=>{
  vi.unstubAllEnvs();const bodies:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
   if(String(url).includes('/v1/search'))return search();
   if(String(url).includes('/v1/sources/'))return Response.json({source:source(),context:[],related:[]});
   const body=JSON.parse(String(init?.body));bodies.push(body);
   return bodies.length===1?upstream([textChunk('暂定整理草稿[1]','stop')]):upstream([{choices:[{delta:{reasoning_content:'private synthesis'},finish_reason:null}]},textChunk('完整讲解[1]','stop')]);
  }));
  const events=await collect({...request,messages:[{role:'user',content:'讲讲旅行者的故事'}]});
  expect(bodies).toHaveLength(2);expect(bodies[0].thinking).toEqual({type:'disabled'});
  expect(bodies[1].thinking).toEqual({type:'enabled'});expect(bodies[1].tools).toBeUndefined();
  expect(JSON.stringify(bodies[1])).not.toContain('暂定整理草稿');
  expect(events.filter(e=>e.event==='text_delta').map(e=>e.data.text).join('')).toBe('完整讲解[1]');
  expect(JSON.stringify(events)).not.toContain('private synthesis');
 });
});

describe('empty synthesis protection',()=>{
 it('reports an explicit retryable error when thinking exhausts the budget without producing an answer',async()=>{
  vi.unstubAllEnvs();let round=0;
  vi.stubGlobal('fetch',vi.fn(async url=>{
   if(String(url).includes('/v1/search'))return search();
   if(String(url).includes('/v1/sources/'))return Response.json({source:source(),context:[],related:[]});
   round++;return round===1?upstream([textChunk('暂定草稿[1]','stop')]):upstream([{choices:[{delta:{reasoning_content:'private thoughts'},finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:4096}}]);
  }));
  const events=await collect({...request,messages:[{role:'user',content:'解释这段故事'}]});
  expect(events.at(-1)).toMatchObject({event:'error',data:{code:'EMPTY_MODEL_ANSWER',retryable:true}});
  expect(events.some(e=>e.event==='done')).toBe(false);
 });
});

describe('regional quest overview grounding',()=>{
 it('can research a turning point after loading the outline, before the final narrated answer',async()=>{
  vi.unstubAllEnvs();const bodies:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
   if(String(url).includes('/v1/quest-outline?'))return search([{...source(),text:'花神诞祭的任务摘要',metadata:{outline:{chapterId:1302,role:'quest-summary'}}}]);
   if(String(url).includes('/v1/search'))return search([{...source('detail'),text:'经过调查，旅行者确认了循环的线索。'}]);
   if(String(url).includes('/v1/sources/'))return Response.json({source:source(),context:[],related:[]});
   const body=JSON.parse(String(init?.body));bodies.push(body);
   if(bodies.length===1)return upstream([{choices:[{delta:{tool_calls:[{index:0,id:'turning-point',type:'function',function:{name:'search_corpus',arguments:JSON.stringify({query:'花神诞祭 循环',types:['quest']})}}]},finish_reason:'tool_calls'}]}]);
   return upstream([textChunk('祭典起初看似平常。调查让旅行者发现事情另有隐情。[1]','stop')]);
  }));
  const events=await collect({...request,messages:[{role:'user',content:'梳理须弥魔神任务的主要脉络'}]});
  expect(bodies[0].tools?.length).toBeGreaterThan(0);
  expect(bodies.at(-1).tools).toBeUndefined();
  expect(bodies.at(-1).messages[0].content).toContain('循环的线索');
  expect(events.at(-1)).toMatchObject({event:'done'});
 });
 it('starts an overview from declared chapter membership before broad keyword matches',async()=>{
  vi.unstubAllEnvs();const paths:string[]=[];let prompt='';
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
   paths.push(String(url));
   if(String(url).includes('/v1/quest-outline?'))return search([{...source('act-one'),text:'第一幕的实际任务摘要',metadata:{outline:{chapterId:1301,role:'quest-summary'}}},{...source('act-five'),documentId:'act-five',text:'第五幕的实际任务摘要',metadata:{outline:{chapterId:1305,role:'quest-summary'}}}]);
   if(String(url).includes('/v1/sources/')){const id=String(url).includes('act-one')?'act-one':'act-five';return Response.json({source:{...source(id),documentId:id==='act-one'?'doc':'act-five'},context:[],related:[]});}
   prompt=JSON.parse(String(init?.body)).messages[0].content;return upstream([textChunk('有章节依据的梳理[1]','stop')]);
  }));
  const events=await collect({...request,types:['quest'],messages:[{role:'user',content:'梳理须弥魔神任务主线'}]});
  expect(paths[0]).toContain('/v1/quest-outline?');expect(new URL(paths[0]).searchParams.get('includeChapters')).toBe('false');
  expect(paths.some(p=>p.includes('/v1/search'))).toBe(false);
  expect(prompt).toContain('第一幕的实际任务摘要');expect(prompt).toContain('第五幕的实际任务摘要');
  expect(events.at(-1)).toMatchObject({event:'done'});
 });
});

describe('outline chapter coverage under context limits',()=>{
 it('keeps a grounded excerpt for every chapter rather than filling the budget from the first acts',async()=>{
  vi.unstubAllEnvs();const items=Array.from({length:16},(_,i)=>({...source('outline-'+i),documentId:'outline-'+i,text:'x'.repeat(1000),metadata:{outline:{chapterId:Math.floor(i/2)+1,role:'quest-summary'}}}));
  vi.stubGlobal('fetch',vi.fn(async url=>{
   if(String(url).includes('/v1/quest-outline?'))return search(items);
   if(String(url).includes('/v1/sources/')){const id=decodeURIComponent(String(url).split('/v1/sources/')[1].split('?')[0]);return Response.json({source:items.find(s=>s.id===id),context:[],related:[]});}
   return upstream([textChunk('章节梳理[1]','stop')]);
  }));
  const events=await collect({...request,types:['quest'],messages:[{role:'user',content:'梳理须弥魔神任务主线'}]});
  const citations=events.filter(e=>e.event==='sources').at(-1)!.data.sources;
  expect(new Set(citations.map(s=>(s.metadata?.outline as any).chapterId)).size).toBe(8);
  expect(citations.reduce((n,s)=>n+s.text.length,0)).toBeLessThanOrEqual(8000);
 });
});
