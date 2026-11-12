/**
 * Where the page's history comes from. Bazaar's history lives in its subgraph, and the page asks the
 * service for it (POST /subgraph/<chainId>), not the subgraph itself: the service answers everyone
 * from one short cache, so the subgraph's load does not grow with the number of visitors, and the key
 * to a production subgraph stays on the server. The page holds no key.
 *
 * The subgraph's own public URL, when there is one, is only the fallback: for a service that does not
 * answer history (an older one, or one set up without a subgraph) or cannot be reached.
 */
import { history, officialNetwork } from "@liberta-labs/bazaar-sdk";

/** A GraphQL endpoint serving Bazaar's subgraph, as the SDK reads one. */
export type SubgraphSource = ReturnType<typeof history.httpSubgraph>;

/** How long the fallback is used once the service has said it answers no history for the chain. */
export const NOT_OFFERED_MS = 5 * 60_000;
/** How long the fallback is used after the service failed to answer, before it is tried again. */
export const SERVICE_DOWN_MS = 30_000;

/** The HTTP status a failed query carried: null when the endpoint was unreachable, undefined for another error. */
function statusOf(e: unknown): number | null | undefined {
  return e instanceof history.SubgraphError ? e.status : undefined;
}

/**
 * `service` first, `direct` when the service cannot answer. A query the subgraph itself refused
 * (answered, with GraphQL errors) or the service found malformed is not retried: it would fail the
 * same way anywhere. After a failure the fallback is used for a while, so a service that is down does
 * not cost every query a failed request first.
 */
export function withFallback(service: SubgraphSource, direct: SubgraphSource | null, now: () => number = () => Date.now()): SubgraphSource {
  let directUntil = 0;
  return {
    async query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
      if (direct !== null && now() < directUntil) return direct.query<T>(query, variables);
      try {
        return await service.query<T>(query, variables);
      } catch (e) {
        const status = statusOf(e);
        if (direct === null || status === undefined || status === 200 || status === 400 || status === 413) throw e;
        directUntil = now() + (status === 404 || status === 405 ? NOT_OFFERED_MS : SERVICE_DOWN_MS);
        return direct.query<T>(query, variables);
      }
    },
  };
}

/**
 * The app's subgraph for `chainId`: the service's history route, falling back to `directUrl` (or,
 * without one, the official deployment's public subgraph, when the chain has one).
 */
export function appSubgraph(serviceUrl: string, chainId: number, directUrl: string | null = null, fetchImpl?: typeof fetch): SubgraphSource {
  const opts = fetchImpl ? { fetch: fetchImpl } : {};
  const url = directUrl ?? officialNetwork(chainId)?.subgraphUrl ?? null;
  return withFallback(history.httpSubgraph(`${serviceUrl}/subgraph/${chainId}`, null, opts), url === null ? null : history.httpSubgraph(url, null, opts));
}

/** What the page says about its history's state, or null when there is nothing to say. */
export function historyNotice(
  s: { readonly reachable?: boolean; readonly blocksBehind: number | null; readonly secondsBehind: number | null; readonly hasIndexingErrors: boolean },
  duration: (seconds: number) => string,
): string | null {
  if (s.reachable === false) return "History is unavailable right now.";
  if (s.hasIndexingErrors) return "History has stopped updating for now; recent activity may be missing.";
  if (s.blocksBehind !== null && s.blocksBehind > 20) {
    return `History is ${s.secondsBehind !== null ? duration(s.secondsBehind) : `${s.blocksBehind} blocks`} behind; your latest activity may not show yet.`;
  }
  return null;
}
