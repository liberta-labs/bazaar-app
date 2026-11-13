import { history } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { NOT_OFFERED_MS, SERVICE_DOWN_MS, type SubgraphSource, appSubgraph, historyNotice, withFallback } from "../src/lib/subgraph";

/** A source that answers `data` or throws `failure`, counting its queries. */
function source(data: unknown) {
  const s = {
    asked: 0,
    failure: null as Error | null,
    query: async <T>(): Promise<T> => {
      s.asked += 1;
      if (s.failure) throw s.failure;
      return data as T;
    },
  };
  return s;
}

const failed = (status: number | null) => new history.SubgraphError(`HTTP ${status}`, status);

describe("withFallback", () => {
  it("asks the service, and never the fallback while the service answers", async () => {
    const service = source({ from: "service" });
    const direct = source({ from: "direct" });
    const sg = withFallback(service as SubgraphSource, direct as SubgraphSource);
    expect(await sg.query("{ a }")).toEqual({ from: "service" });
    expect([service.asked, direct.asked]).toEqual([1, 0]);
  });

  it("uses the fallback for five minutes once the service says it answers no history", async () => {
    const service = source({ from: "service" });
    const direct = source({ from: "direct" });
    let now = 1_000_000;
    const sg = withFallback(service as SubgraphSource, direct as SubgraphSource, () => now);
    service.failure = failed(404);
    expect(await sg.query("{ a }")).toEqual({ from: "direct" });
    expect(await sg.query("{ a }")).toEqual({ from: "direct" });
    expect([service.asked, direct.asked]).toEqual([1, 2]);

    service.failure = null;
    now += NOT_OFFERED_MS - 1;
    await sg.query("{ a }");
    expect(service.asked).toBe(1);
    now += 1;
    expect(await sg.query("{ a }")).toEqual({ from: "service" });
  });

  it("uses the fallback for a while when the service is unreachable, busy or failing", async () => {
    for (const status of [null, 429, 500, 503]) {
      const service = source({ from: "service" });
      const direct = source({ from: "direct" });
      let now = 0;
      const sg = withFallback(service as SubgraphSource, direct as SubgraphSource, () => now);
      service.failure = failed(status);
      expect(await sg.query("{ a }")).toEqual({ from: "direct" });
      service.failure = null;
      now = SERVICE_DOWN_MS - 1;
      expect(await sg.query("{ a }")).toEqual({ from: "direct" });
      now = SERVICE_DOWN_MS;
      expect(await sg.query("{ a }")).toEqual({ from: "service" });
    }
  });

  it("does not retry a query the subgraph refused or the service found malformed, or an unknown failure", async () => {
    for (const failure of [failed(200), failed(400), failed(413), new Error("a bug")]) {
      const service = source(null);
      const direct = source({ from: "direct" });
      service.failure = failure;
      await expect(withFallback(service as SubgraphSource, direct as SubgraphSource).query("{ a }")).rejects.toBe(failure);
      expect(direct.asked).toBe(0);
    }
  });

  it("fails as the service failed when there is no fallback", async () => {
    const service = source(null);
    service.failure = failed(503);
    await expect(withFallback(service as SubgraphSource, null).query("{ a }")).rejects.toBe(service.failure);
  });
});

describe("appSubgraph", () => {
  it("posts queries to the service's route for the chain, falling back to the direct URL", async () => {
    const asked: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      asked.push(String(input));
      if (String(input).startsWith("https://service.example")) return new Response("not found\n", { status: 404 });
      return new Response('{"data":{"ok":true}}', { status: 200, headers: { "content-type": "application/json" } });
    };
    const sg = appSubgraph("https://service.example", 421614, "https://subgraph.example/query", fetchImpl);
    expect(await sg.query("{ ok }")).toEqual({ ok: true });
    expect(asked).toEqual(["https://service.example/subgraph/421614", "https://subgraph.example/query"]);
  });
});

describe("historyNotice", () => {
  const d = (s: number) => `${s} s`;
  it("says when history is unavailable, stuck or behind, and nothing when it is level", () => {
    expect(historyNotice({ reachable: false, blocksBehind: 3, secondsBehind: 1, hasIndexingErrors: false }, d)).toBe("History is unavailable right now.");
    expect(historyNotice({ reachable: true, blocksBehind: 3, secondsBehind: 1, hasIndexingErrors: true }, d)).toBe("History has stopped updating for now; recent activity may be missing.");
    expect(historyNotice({ blocksBehind: 900, secondsBehind: 240, hasIndexingErrors: false }, d)).toBe("History is 240 s behind; your latest activity may not show yet.");
    expect(historyNotice({ blocksBehind: 900, secondsBehind: null, hasIndexingErrors: false }, d)).toBe("History is 900 blocks behind; your latest activity may not show yet.");
    expect(historyNotice({ reachable: true, blocksBehind: 20, secondsBehind: 5, hasIndexingErrors: false }, d)).toBeNull();
    expect(historyNotice({ reachable: true, blocksBehind: null, secondsBehind: null, hasIndexingErrors: false }, d)).toBeNull();
  });

  it("stays quiet through the normal few seconds of lag, up to a minute", () => {
    // A few seconds behind is normal: 28 blocks is 7 s on Arbitrum.
    expect(historyNotice({ reachable: true, blocksBehind: 28, secondsBehind: 7, hasIndexingErrors: false }, d)).toBeNull();
    expect(historyNotice({ reachable: true, blocksBehind: 240, secondsBehind: 60, hasIndexingErrors: false }, d)).toBeNull();
    expect(historyNotice({ reachable: true, blocksBehind: 244, secondsBehind: 61, hasIndexingErrors: false }, d)).toBe("History is 61 s behind; your latest activity may not show yet.");
    // The time decides when it is known, whatever the block count says.
    expect(historyNotice({ reachable: true, blocksBehind: 400, secondsBehind: 30, hasIndexingErrors: false }, d)).toBeNull();
    // Without a time, a minute's worth of blocks.
    expect(historyNotice({ reachable: true, blocksBehind: 240, secondsBehind: null, hasIndexingErrors: false }, d)).toBeNull();
    expect(historyNotice({ reachable: true, blocksBehind: 241, secondsBehind: null, hasIndexingErrors: false }, d)).toBe("History is 241 blocks behind; your latest activity may not show yet.");
  });
});
