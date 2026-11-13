/**
 * Several newest-first lists from the subgraph read as one, a page at a time. Each page asks every
 * list for its items older than a time, merges them, and keeps only what is sure to be complete: a list
 * that filled its page may hold more items just past its oldest, so nothing older than the newest such
 * edge goes out yet. The next page starts at that edge. Nothing is skipped or shown twice.
 */
import type { history } from "@liberta-labs/bazaar-sdk";

export type TimeSource<T> = (opts: { first: number; to?: number }) => Promise<history.Page<T>>;

export function mergeByTime<T extends { readonly timestamp: number }>(sources: readonly TimeSource<T>[]) {
  return async ({ first, after }: { first: number; after: string | null }): Promise<history.Page<T>> => {
    const to = after === null ? undefined : Number(after);
    const pages = await Promise.all(sources.map((s) => s(to === undefined ? { first } : { first, to })));
    const all = pages.flatMap((p) => p.items).sort((a, b) => b.timestamp - a.timestamp);
    const edges = pages.filter((p) => p.next !== null && p.items.length > 0).map((p) => p.items[p.items.length - 1]!.timestamp);
    if (!edges.length) return { items: all, next: null };
    const edge = Math.max(...edges);
    const sure = all.filter((x) => x.timestamp > edge);
    // `to` is exclusive: the next page starts with the edge's own second.
    if (sure.length) return { items: sure, next: String(edge + 1) };
    // A whole page within one second: take it and move on past that second.
    return { items: all, next: String(edge) };
  };
}
