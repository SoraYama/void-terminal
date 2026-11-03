import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "../src/app/api/items/route";
import { GET as detail } from "../src/app/api/items/[id]/route";
import { GET as coverage } from "../src/app/api/items/coverage/route";
import { contextPayload, modelJson, prepareResearch } from "../src/lib/server/research";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (query = "") => new Request(`http://localhost/api/items${query}`);

describe("item proxy boundaries", () => {
  it.each(["?q=a&q=b", "?unknown=x", "?page=100001", "?pageSize=101", "?rarity=0", "?category=furniture", "?language=fr", "?sort=random", "?includeInternal=1", "?weaponType=" + "x".repeat(101), "?snapshotId=" + "x".repeat(201)])(
    "rejects invalid list queries before fetching %s", async (query) => {
      const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      const response = await list(request(query));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("omits blank optional filters and sends credentials only upstream", async () => {
    vi.stubEnv("KNOWLEDGE_API_TOKEN", "private-item-key");
    vi.stubEnv("KNOWLEDGE_URL", "http://knowledge.internal");
    const fetcher = vi.fn(async (url, options) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/v1/items");
      expect(parsed.searchParams.toString()).toBe("q=Staff+of+Homa&language=zh-CN&pageSize=48");
      expect(new Headers(options?.headers).get("X-Knowledge-Token")).toBe("private-item-key");
      return Response.json({ items: [], total: 0, page: 1, pageSize: 48, snapshotId: "s1", ready: true, counts: {} });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await list(request("?q=Staff%20of%20Homa&category=&rarity=&weaponType=%20&snapshotId=&language=zh-CN&pageSize=48"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private-item-key");
  });
  it("awaits detail params, encodes identity and pins locale/snapshot", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toContain("/v1/items/artifact%3A15001%3Aflower?language=en&snapshotId=s1");
      return Response.json({ item: { id: "artifact:15001:flower" }, snapshotId: "s1" });
    });
    const response = await detail(request("?language=en&snapshotId=s1"), { params: Promise.resolve({ id: "artifact:15001:flower" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).snapshotId).toBe("s1");
  });
  it("rejects duplicate/detail-only and coverage-only query violations", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const query of ["?q=x", "?language=en&language=en", "?snapshotId=a&snapshotId=b"])
      expect((await detail(request(query), { params: Promise.resolve({ id: "weapon:13501" }) })).status).toBe(400);
    expect((await coverage(request("?language=en"))).status).toBe(400);
    expect((await detail(request(), { params: Promise.resolve({ id: "../coverage?url=https://example.com" }) })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds upstream payloads and hides upstream errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("x".repeat(2_000_001)));
    expect((await list(request())).status).toBe(503);
    vi.stubGlobal("fetch", async () => new Response("private-token-or-db-url", { status: 500 }));
    const response = await coverage(request("?snapshotId=s1"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-token-or-db-url");
  });
});

describe("bounded item metadata for research", () => {
  it("projects endpoint stats and coverage without raw or growth arrays", () => {
    const metadata = JSON.parse(modelJson({ metadata: { itemSummary: {
      id: "weapon:13501", category: "weapon", subtype: "长柄武器", rarity: 5, state: "source-record",
      weaponType: "WEAPON_POLE", coverage: { stats: "complete" },
      endpointStats: [{ level: 90, ascension: 6, stats: [{ key: "CRITICAL_HURT", label: "暴击伤害", value: 66.1536, unit: "%" }] }],
      refinementRanks: [1, 2, 3, 4, 5], attributes: [{ label: "效果", value: "生命值提升" }],
      raw: { secret: "never" }, levels: Array(1000).fill("growth"), story: "full-story",
    }, raw: { arbitrary: "private-source" } } })).metadata;
    expect(metadata.itemSummary.endpointStats[0].stats[0].value).toBe(66.1536);
    expect(metadata.itemSummary.coverage.stats).toBe("complete");
    const encoded = JSON.stringify(metadata);
    for (const forbidden of ["secret", "growth", "full-story", "private-source"])
      expect(encoded).not.toContain(forbidden);
    expect(encoded.length).toBeLessThan(4000);
  });
  it("omits a shared supplemental artifact-set summary with arbitrary slot attribution", () => {
    const projected = JSON.parse(modelJson({ metadata: {
      category: "artifacts", itemSummary: { id: "artifact:15001:flower", category: "artifact", setId: 15001, slot: "flower" },
    } })).metadata;
    expect(projected.itemSummary).toBeUndefined();
  });
  it("bounds oversized summary fields and strips nonfinite stats", () => {
    const metadata = JSON.parse(modelJson({ metadata: { itemSummary: {
      id: "weapon:1", category: "weapon", subtype: "x".repeat(10000),
      attributes: Array(1000).fill({ label: "l".repeat(1000), value: "v".repeat(10000) }),
      endpointStats: [{ level: 90, ascension: 6, stats: [{ key: "ATK", label: "ATK", value: Infinity, unit: "" }] }],
    } } })).metadata;
    expect(JSON.stringify(metadata).length).toBeLessThan(4000);
    expect(metadata.itemSummary.endpointStats[0].stats).toEqual([]);
  });
  it("keeps bounded item evidence through research and suppresses shared set attribution", async () => {
    const base = {
      id: "source", documentId: "agd:zh-CN:weapon:Weapon:13501", title: "护摩之杖", type: "weapon",
      language: "zh-CN", text: "护摩之杖的记载。", path: "ExcelBinOutput/Weapon.json", locator: "/0",
      sourceUrl: "https://example.com/source", snapshotId: "s1",
    };
    vi.stubGlobal("fetch", async () => Response.json({ sources: [{ ...base, metadata: {
      itemSummary: { id: "weapon:13501", category: "weapon", rarity: 5, attributes: Array(12).fill({ label: "属性", value: "x".repeat(500) }) },
    } }, { ...base, id: "set", documentId: "gdb:zh-CN:artifact:artifacts:15001", type: "artifact", metadata: {
      itemSummary: { id: "artifact:15001:flower", category: "artifact", slot: "flower" },
    } }], snapshotId: "s1", mode: "lexical", total: 2 }));
    const result = await prepareResearch({ messages: [{ role: "user", content: "护摩之杖" }], language: "zh-CN", mode: "byok", depth: "standard" }, new AbortController().signal, () => {});
    if (!result) throw new Error("Expected research evidence");
    const payload = JSON.parse(contextPayload(result.evidence.sources));
    expect(payload.sources[0].metadata.itemSummary.id).toBe("weapon:13501");
    expect(JSON.stringify(payload.sources[0].metadata).length).toBeLessThan(4000);
    expect(payload.sources[1].metadata.itemSummary).toBeUndefined();
  });
});
