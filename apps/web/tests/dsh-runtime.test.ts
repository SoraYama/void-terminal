import { describe, it, expect } from "vitest";
import { request as httpRequest } from "node:http";
import { openModelBridge } from "../src/lib/server/model-bridge";
import {
  runDshResearch,
  type RuntimeEvent,
} from "../src/lib/server/dsh-runtime";

function completion(text: string, tool = false) {
  const delta = tool
    ? {
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: {
              name: "search_corpus",
              arguments: '{"query":"纳西妲"}',
            },
          },
        ],
      }
    : { content: text };
  return new Response(
    "data: " +
      JSON.stringify({
        id: "fixture",
        object: "chat.completion.chunk",
        model: "fixture",
        choices: [
          { index: 0, delta, finish_reason: tool ? "tool_calls" : "stop" },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      }) +
      "\n\ndata: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("private model transport bridge", () => {
  it("authenticates capability and restricts path/method before dispatch", async () => {
    let calls = 0;
    const bridge = await openModelBridge({
      signal: new AbortController().signal,
      dispatch: async () => {
        calls++;
        return completion("ok");
      },
    });
    try {
      const auth = {
        authorization: `Bearer ${bridge.token}`,
        "content-type": "application/json",
      };
      expect(
        (
          await fetch(bridge.baseURL + "/chat/completions", {
            method: "POST",
            body: "{}",
          })
        ).status,
      ).toBe(401);
      expect(
        (await fetch(bridge.baseURL + "/models", { headers: auth })).status,
      ).toBe(404);
      expect(
        (await fetch(bridge.baseURL + "/chat/completions", { headers: auth }))
          .status,
      ).toBe(405);
      const result = await fetch(bridge.baseURL + "/chat/completions", {
        method: "POST",
        headers: auth,
        body: '{"model":"fixture"}',
      });
      expect(await result.text()).toContain("ok");
      expect(calls).toBe(1);
    } finally {
      await bridge.close();
    }
    await expect(fetch(bridge.baseURL + "/chat/completions")).rejects.toThrow();
  });
  it("accepts SDK metadata headers without dropping the authorization capability", async () => {
    let dispatched = false;
    const bridge = await openModelBridge({
      signal: new AbortController().signal,
      dispatch: async () => {
        dispatched = true;
        return completion("ok");
      },
    });
    try {
      const headers = Object.fromEntries(
        Array.from({ length: 24 }, (_, i) => [
          "x-sdk-metadata-" + i,
          "fixture",
        ]),
      );
      headers["Authorization"] = `Bearer ${bridge.token}`;
      headers["Content-Type"] = "application/json";
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          bridge.baseURL + "/chat/completions",
          { method: "POST", headers },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        req.end("{}");
      });
      expect(status).toBe(200);
      expect(dispatched).toBe(true);
    } finally {
      await bridge.close();
    }
  });
  it("isolates concurrent bridge capabilities and request state", async () => {
    const controller = new AbortController();
    const a = await openModelBridge({
      signal: controller.signal,
      dispatch: async () => completion("tenant-A"),
    });
    const b = await openModelBridge({
      signal: controller.signal,
      dispatch: async () => completion("tenant-B"),
    });
    try {
      expect(a.token).not.toBe(b.token);
      const cross = await fetch(a.baseURL + "/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${b.token}` },
        body: "{}",
      });
      expect(cross.status).toBe(401);
      const results = await Promise.all(
        [a, b].map(async (item) => {
          const response = await fetch(item.baseURL + "/chat/completions", {
            method: "POST",
            headers: { authorization: `Bearer ${item.token}` },
            body: "{}",
          });
          return response.text();
        }),
      );
      expect(results[0]).toContain("tenant-A");
      expect(results[0]).not.toContain("tenant-B");
      expect(results[1]).toContain("tenant-B");
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

describe("official DSH execution", () => {
  it("executes a corpus tool and continues through the real DSH loop and model adapter", async () => {
    const bodies: Record<string, any>[] = [];
    const queries: string[] = [];
    const events: RuntimeEvent[] = [];
    const result = await runDshResearch({
      instructions: "Only use supplied evidence.",
      messages: [{ role: "user", content: "纳西妲是谁" }],
      signal: new AbortController().signal,
      tools: [
        {
          name: "search_corpus",
          description: "Search evidence",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: async (args) => {
            queries.push(args.query as string);
            return '{"sources":[{"citation":1,"text":"小吉祥草王"}]}';
          },
        },
      ],
      dispatch: async (body) => {
        bodies.push(body);
        return bodies.length === 1
          ? completion("", true)
          : completion("她是小吉祥草王。[1]");
      },
      onEvent: (event) => events.push(event),
    });
    expect(queries).toEqual(["纳西妲"]);
    expect(bodies[0].tools.map((tool: any) => tool.function.name)).toEqual([
      "search_corpus",
    ]);
    expect(bodies).toHaveLength(2);
    expect(
      bodies[1].messages.some(
        (m: any) =>
          m.role === "tool" && String(m.content).includes("小吉祥草王"),
      ),
    ).toBe(true);
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe("她是小吉祥草王。[1]");
    expect(result.finishReason).toBe("stop");
    expect(result.runtime).toBe("dsh");
  });
  it("restores original user and assistant history without executing previous turns", async () => {
    let body: any;
    await runDshResearch({
      instructions: "原文",
      messages: [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
        { role: "user", content: "接着讲" },
      ],
      signal: new AbortController().signal,
      tools: [],
      dispatch: async (value) => {
        body = value;
        return completion("继续回答");
      },
      onEvent: () => {},
    });
    expect(
      body.messages
        .slice(-3)
        .map((m: any) => ({ role: m.role, content: m.content })),
    ).toEqual([
      { role: "user", content: "旧问题" },
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "接着讲" },
    ]);
  });
});

describe("DSH isolation and lifecycle regressions", () => {
  it("keeps concurrent runtime history, tools and model traffic separate", async () => {
    const run = async (label: string) => {
      const bodies: Record<string, any>[] = [];
      const events: RuntimeEvent[] = [];
      await runDshResearch({
        instructions: `Evidence ${label}`,
        messages: [{ role: "user", content: `Question ${label}` }],
        signal: new AbortController().signal,
        tools: [
          {
            name: "search_corpus",
            description: "Search",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
            execute: async () => `Evidence result ${label}`,
          },
        ],
        dispatch: async (body) => {
          bodies.push(body);
          return bodies.length === 1
            ? completion("", true)
            : completion(`Answer ${label}`);
        },
        onEvent: (event) => events.push(event),
      });
      return {
        wire: JSON.stringify(bodies),
        text: events
          .filter((e) => e.type === "text")
          .map((e) => e.text)
          .join(""),
      };
    };
    const [a, b] = await Promise.all([run("TENANT_ALPHA"), run("TENANT_BETA")]);
    expect(a.text).toBe("Answer TENANT_ALPHA");
    expect(b.text).toBe("Answer TENANT_BETA");
    expect(a.wire).not.toContain("TENANT_BETA");
    expect(b.wire).not.toContain("TENANT_ALPHA");
  });
  it("aborts pending model transport and closes its private listener", async () => {
    const controller = new AbortController();
    let aborted = false;
    let bridgeURL = "";
    const original = globalThis.fetch;
    globalThis.fetch = ((
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      if (String(url).includes("127.0.0.1")) bridgeURL = String(url);
      return original(url, init);
    }) as typeof fetch;
    try {
      await expect(
        runDshResearch({
          instructions: "Evidence",
          messages: [{ role: "user", content: "Question" }],
          signal: controller.signal,
          tools: [],
          dispatch: async (_body, signal) =>
            new Promise<Response>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(signal.reason);
                },
                { once: true },
              );
              controller.abort();
            }),
          onEvent: () => {},
        }),
      ).rejects.toThrow();
      expect(aborted).toBe(true);
      expect(bridgeURL).toContain("127.0.0.1");
      await expect(original(bridgeURL)).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
  it("propagates application event limits without an unhandled observer exception", async () => {
    const marker = new Error("application output cap");
    await expect(
      runDshResearch({
        instructions: "Evidence",
        messages: [{ role: "user", content: "Question" }],
        signal: new AbortController().signal,
        tools: [],
        dispatch: async () => completion("Answer"),
        onEvent: (event) => {
          if (event.type === "text") throw marker;
        },
      }),
    ).rejects.toBe(marker);
  });
  it("uses official compaction between research steps and resumes with its checkpoint", async () => {
    const calls: { body: any; compaction: boolean }[] = [];
    const events: RuntimeEvent[] = [];
    await runDshResearch({
      instructions: "Only supplied evidence.",
      messages: [
        {
          role: "user",
          content: "OLD_CONTEXT_MARKER " + "old detail ".repeat(4000),
        },
        { role: "assistant", content: "Previous account." },
        { role: "user", content: "Continue the story." },
      ],
      signal: new AbortController().signal,
      contextWindow: 16000,
      maxOutputTokens: 1024,
      tools: [
        {
          name: "search_corpus",
          description: "Search",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
          execute: async () => "Related evidence " + "new detail ".repeat(1700),
        },
      ],
      canCompact: () => calls.length < 3,
      dispatch: async (body, _signal, context) => {
        calls.push({ body, compaction: context.compaction });
        if (context.compaction)
          return completion("A compact summary of previous account.");
        if (calls.length === 1) {
          const first = completion("", true);
          return new Response(
            (await first.text()).replace(
              '\"prompt_tokens\":12',
              '\"prompt_tokens\":10000',
            ),
            { headers: first.headers },
          );
        }
        return completion("Continued answer.");
      },
      onEvent: (event) => events.push(event),
    });
    expect(
      calls.some((c) => c.compaction),
      JSON.stringify(
        calls.map((c) => ({
          compaction: c.compaction,
          messages: JSON.stringify(c.body.messages).length,
        })),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "compaction")).toBe(true);
    expect(events.filter((e) => e.type === "usage")).toHaveLength(calls.length);
    expect(JSON.stringify(calls.at(-1)!.body)).toContain("compact summary");
    expect(JSON.stringify(calls.at(-1)!.body)).not.toContain(
      "OLD_CONTEXT_MARKER",
    );
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe("Continued answer.");
  });
});
