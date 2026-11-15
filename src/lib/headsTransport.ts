/**
 * The read connection's transport: every request over HTTP (the SDK's own JSON-RPC client, with its rate
 * limit and retries), and new blocks pushed over a free public WebSocket, used only as a doorbell.
 *
 * The SDK's log follower (`readBz.live`) subscribes to "newHeads" when its transport can deliver messages,
 * and reads the chain each time one arrives, instead of polling every second. Here that subscription is
 * answered locally: one WebSocket per page, shared by every follower, whose block notices are passed on
 * at most once per `minGapMs`. So a market page sees a trade within about half a second, while its reads
 * stay on the app's HTTP RPC at no more than two a second, and the WebSocket endpoint only ever carries
 * one subscription per visitor, far inside any free plan's limits.
 *
 * When no socket works (refused, dropped, or silent for `staleMs`), a timer rings every `fallbackMs`
 * instead, the SDK's own polling pace: without it, a follower that believes it is subscribed only checks
 * every ten seconds. The socket is retried with backoff through `wsUrls` in turn, and closed while nothing
 * is subscribed (the market page stops its watch while the page is idle).
 */
import type { RequestArgs, Transport } from "@liberta-labs/bazaar-sdk";

type Listener = (message: unknown) => void;
/** A JSON-RPC answer or subscription notice from the socket. */
type SocketMessage = { readonly id?: unknown; readonly error?: unknown; readonly method?: unknown };

/** The bits of the browser's WebSocket used here, so a test can stand one in. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface HeadsTransportOptions {
  /** Where every request goes: the SDK's JsonRpc for the app's HTTP RPC. */
  readonly http: Transport;
  /** WebSocket RPCs to learn of new blocks from, in order of preference. Empty: the timer alone. */
  readonly wsUrls: readonly string[];
  /** The least time between notices passed on (ms). Default 500: at most two reads a second. */
  readonly minGapMs?: number;
  /** The timer's pace while no socket works (ms). Default 1000, as the SDK polls on its own. */
  readonly fallbackMs?: number;
  /**
   * A connected socket with no block for this long is treated as dead (ms). Default 4000: Arbitrum makes
   * about four blocks a second, so a silence this long means the socket, not the chain, has stopped.
   */
  readonly staleMs?: number;
  /** The longest wait between attempts to connect (ms). Default 30000. */
  readonly maxBackoffMs?: number;
  readonly openSocket?: (url: string) => SocketLike;
}

export interface HeadsTransport extends Transport {
  on(event: "message", listener: Listener): void;
  removeListener(event: "message", listener: Listener): void;
  /** Whether block notices are coming from a socket now, rather than the timer. */
  readonly live: boolean;
}

export function headsTransport(opts: HeadsTransportOptions): HeadsTransport {
  const minGapMs = opts.minGapMs ?? 500;
  const fallbackMs = opts.fallbackMs ?? 1000;
  const staleMs = opts.staleMs ?? 4_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const openSocket = opts.openSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);

  const listeners = new Set<Listener>();
  const subs = new Set<string>();
  let nextSub = 1;

  let socket: SocketLike | null = null;
  let live = false;
  let urlAt = 0;
  let failures = 0;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let fallback: ReturnType<typeof setInterval> | null = null;
  let stale: ReturnType<typeof setTimeout> | null = null;
  let lastRing = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  /** Tell every follower a block arrived. */
  const ring = () => {
    lastRing = Date.now();
    for (const id of subs) {
      const message = { type: "eth_subscription", data: { subscription: id, result: null } };
      for (const l of [...listeners]) {
        try {
          l(message);
        } catch {
          // a listener's failure is its own
        }
      }
    }
  };

  /** A block from the socket: rung now, or at the end of the gap, so the newest is never dropped. */
  const onHead = () => {
    if (pending) return;
    const wait = lastRing + minGapMs - Date.now();
    if (wait <= 0) ring();
    else
      pending = setTimeout(() => {
        pending = null;
        ring();
      }, wait);
  };

  const startFallback = () => {
    if (fallback === null && subs.size > 0) fallback = setInterval(ring, fallbackMs);
  };
  const stopFallback = () => {
    if (fallback !== null) clearInterval(fallback);
    fallback = null;
  };

  const watchStale = () => {
    if (stale !== null) clearTimeout(stale);
    stale = setTimeout(() => drop(), staleMs);
  };

  /** Lose the socket: the timer takes over, and a new one is tried after a backoff. */
  const drop = () => {
    const s = socket;
    socket = null;
    live = false;
    if (stale !== null) clearTimeout(stale);
    stale = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        // already closed
      }
    }
    if (subs.size === 0) return;
    startFallback();
    failures += 1;
    urlAt = (urlAt + 1) % Math.max(1, opts.wsUrls.length);
    if (reconnect === null) {
      const wait = Math.min(maxBackoffMs, 1000 * 2 ** Math.min(failures - 1, 5));
      reconnect = setTimeout(() => {
        reconnect = null;
        connect();
      }, wait);
    }
  };

  const connect = () => {
    if (socket || subs.size === 0 || opts.wsUrls.length === 0) return;
    let s: SocketLike;
    try {
      s = openSocket(opts.wsUrls[urlAt % opts.wsUrls.length]!);
    } catch {
      drop();
      return;
    }
    socket = s;
    s.onopen = () => {
      s.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      watchStale();
    };
    s.onmessage = (ev) => {
      let m: SocketMessage | null;
      try {
        m = JSON.parse(String(ev.data)) as SocketMessage | null;
      } catch {
        return;
      }
      if (m?.id === 1 && m.error !== undefined) return drop();
      if (m?.method !== "eth_subscription") return;
      // A block: the socket works, so the timer can rest.
      if (!live) {
        live = true;
        failures = 0;
        stopFallback();
      }
      watchStale();
      onHead();
    };
    s.onerror = () => drop();
    s.onclose = () => drop();
  };

  /** Nothing subscribed: close everything down. */
  const shutDown = () => {
    stopFallback();
    if (reconnect !== null) clearTimeout(reconnect);
    reconnect = null;
    if (pending !== null) clearTimeout(pending);
    pending = null;
    const s = socket;
    socket = null;
    live = false;
    if (stale !== null) clearTimeout(stale);
    stale = null;
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        // already closed
      }
    }
  };

  return {
    get live() {
      return live;
    },
    async request(args: RequestArgs): Promise<unknown> {
      if (args.method === "eth_subscribe") {
        if (args.params?.[0] !== "newHeads") throw new Error(`Only newHeads can be subscribed to here, not ${String(args.params?.[0])}`);
        const id = `0x${(nextSub++).toString(16).padStart(32, "0")}`;
        subs.add(id);
        // The timer rings until a socket proves itself.
        if (!live) startFallback();
        connect();
        return id;
      }
      if (args.method === "eth_unsubscribe") {
        const had = subs.delete(String(args.params?.[0]));
        if (subs.size === 0) shutDown();
        return had;
      }
      return opts.http.request(args);
    },
    on(_event: "message", listener: Listener) {
      listeners.add(listener);
    },
    removeListener(_event: "message", listener: Listener) {
      listeners.delete(listener);
    },
  };
}
