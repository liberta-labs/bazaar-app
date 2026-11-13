import { useState } from "react";
import { duration } from "../lib/format";
import { historyNotice } from "../lib/subgraph";
import { useBoard, useRead } from "../state/connection";
import { usePoll } from "../state/poll";

/**
 * How often the page checks the subgraph's lag itself, when the board does not publish it. A notice a
 * few minutes late does no harm, and each check is a query.
 */
const LAG_EVERY_MS = 3 * 60_000;

/**
 * "History is N seconds behind" while the subgraph trails the chain by more than a minute (lib/subgraph.ts
 * `historyNotice`); the few seconds it normally trails say nothing. The service checks every two
 * minutes and publishes what it found on the board, so the page usually asks nothing. It checks for itself only
 * with a service that does not read the chain's history, or with no board at all.
 */
export function HistoryLag() {
  const { readBz } = useRead();
  const { prices, error: boardError } = useBoard();
  const published = prices?.subgraph() ?? null;
  const [own, setOwn] = useState<string | null>(null);
  usePoll(
    async (isDead) => {
      if (!readBz) return;
      try {
        const l = await readBz.history.subgraphLag();
        if (!isDead()) setOwn(historyNotice(l, duration));
      } catch {
        if (!isDead()) setOwn("History is unavailable right now.");
      }
    },
    LAG_EVERY_MS,
    [readBz],
    // Wait for the first board before checking: it usually carries the answer.
    Boolean(readBz) && published === null && (prices !== null || boardError !== null),
  );
  // Before the service's first check there is nothing to say yet.
  const text = published === null ? own : published.checkedAt === null ? null : historyNotice(published, duration);
  return text ? <div className="banner warn small">{text}</div> : null;
}
