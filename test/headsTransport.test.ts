import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SocketLike, headsTransport } from "../src/lib/headsTransport";

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  head() {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", method: "eth_subscription", params: { subscription: "0xs", result: {} } }) });
  }
}

function setup(wsUrls = ["wss://a", "wss://b"]) {
  const sockets: FakeSocket[] = [];
  const http = { request: vi.fn(async () => "0x1") };
  const openSocket = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  const t = headsTransport({ http, wsUrls, openSocket });
  const rings: string[] = [];
  t.on("message", (m) => rings.push((m as { data: { subscription: string } }).data.subscription));
  return { t, http, sockets, rings };
}

describe("headsTransport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends every request but a subscription over HTTP", async () => {
    const { t, http } = setup();
    await t.request({ method: "eth_blockNumber" });
    expect(http.request).toHaveBeenCalledWith({ method: "eth_blockNumber" });
  });

  it("rings every second until a socket delivers a block, then passes blocks on at most twice a second", async () => {
    const { t, sockets, rings } = setup();
    const id = (await t.request({ method: "eth_subscribe", params: ["newHeads"] })) as string;
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(rings).toEqual([id, id, id]);

    rings.length = 0;
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({ method: "eth_subscribe", params: ["newHeads"] });
    // Four blocks a second for two seconds: rung twice a second, the timer quiet.
    for (let i = 0; i < 8; i++) {
      sockets[0]!.head();
      vi.advanceTimersByTime(250);
    }
    expect(t.live).toBe(true);
    expect(rings.length).toBeGreaterThanOrEqual(4);
    expect(rings.length).toBeLessThanOrEqual(5);
  });

  it("never drops the newest block: one inside the gap rings at its end", async () => {
    const { t, sockets, rings } = setup();
    await t.request({ method: "eth_subscribe", params: ["newHeads"] });
    sockets[0]!.open();
    sockets[0]!.head();
    expect(rings).toHaveLength(1);
    vi.advanceTimersByTime(100);
    sockets[0]!.head();
    expect(rings).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(rings).toHaveLength(2);
  });

  it("falls back to the timer when the socket closes, and tries the next address", async () => {
    const { t, sockets, rings } = setup();
    await t.request({ method: "eth_subscribe", params: ["newHeads"] });
    sockets[0]!.open();
    sockets[0]!.head();
    rings.length = 0;
    sockets[0]!.onclose?.();
    expect(t.live).toBe(false);
    vi.advanceTimersByTime(1000);
    // The timer rang, and a new socket was opened on the second address.
    expect(rings.length).toBeGreaterThanOrEqual(1);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toBe("wss://b");
  });

  it("treats a socket with no block for 4 seconds as dead, and rings by timer again", async () => {
    const { t, sockets, rings } = setup();
    await t.request({ method: "eth_subscribe", params: ["newHeads"] });
    sockets[0]!.open();
    sockets[0]!.head();
    expect(t.live).toBe(true);
    vi.advanceTimersByTime(3_999);
    expect(t.live).toBe(true);
    vi.advanceTimersByTime(1);
    expect(t.live).toBe(false);
    expect(sockets[0]!.closed).toBe(true);
    rings.length = 0;
    vi.advanceTimersByTime(1_000);
    expect(rings.length).toBe(1);
  });

  it("rings for every follower, and closes down once the last unsubscribes", async () => {
    const { t, sockets, rings } = setup();
    const a = (await t.request({ method: "eth_subscribe", params: ["newHeads"] })) as string;
    const b = (await t.request({ method: "eth_subscribe", params: ["newHeads"] })) as string;
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    sockets[0]!.head();
    expect(rings).toEqual([a, b]);

    await t.request({ method: "eth_unsubscribe", params: [a] });
    await t.request({ method: "eth_unsubscribe", params: [b] });
    expect(sockets[0]!.closed).toBe(true);
    rings.length = 0;
    vi.advanceTimersByTime(5000);
    expect(rings).toEqual([]);
  });

  it("with no socket addresses, just rings every second", async () => {
    const { t, sockets, rings } = setup([]);
    await t.request({ method: "eth_subscribe", params: ["newHeads"] });
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(0);
    expect(rings).toHaveLength(2);
  });
});
