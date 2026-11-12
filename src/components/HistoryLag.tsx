import { useState } from "react";
import { duration } from "../lib/format";
import { useRead } from "../state/connection";
import { usePoll } from "../state/poll";

/**
 * How often the subgraph's lag is checked. A notice a few minutes late does no harm, and each check
 * counts against the subgraph query URL's cap.
 */
const LAG_EVERY_MS = 3 * 60_000;

/** "History is N seconds behind" while the subgraph trails the chain. */
export function HistoryLag() {
  const { readBz } = useRead();
  const [text, setText] = useState<string | null>(null);
  usePoll(
    async (isDead) => {
      if (!readBz) return;
      try {
        const l = await readBz.history.subgraphLag();
        if (isDead()) return;
        if (l.hasIndexingErrors) setText("History has stopped updating for now; recent activity may be missing.");
        else if (l.blocksBehind > 20) setText(`History is ${l.secondsBehind !== null ? duration(l.secondsBehind) : `${l.blocksBehind} blocks`} behind; your latest activity may not show yet.`);
        else setText(null);
      } catch {
        if (!isDead()) setText("History is unavailable right now.");
      }
    },
    LAG_EVERY_MS,
    [readBz],
    Boolean(readBz),
  );
  return text ? <div className="banner warn small">{text}</div> : null;
}
