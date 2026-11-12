import { useEffect, useState } from "react";
import { duration } from "../lib/format";
import { useRead } from "../state/connection";

/** "History is N seconds behind" while the subgraph trails the chain. */
export function HistoryLag() {
  const { readBz } = useRead();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!readBz) return;
    let dead = false;
    const check = async () => {
      try {
        const l = await readBz.history.subgraphLag();
        if (dead) return;
        if (l.hasIndexingErrors) setText("History has stopped updating for now; recent activity may be missing.");
        else if (l.blocksBehind > 20) setText(`History is ${l.secondsBehind !== null ? duration(l.secondsBehind) : `${l.blocksBehind} blocks`} behind; your latest activity may not show yet.`);
        else setText(null);
      } catch {
        if (!dead) setText("History is unavailable right now.");
      }
    };
    void check();
    const t = setInterval(check, 30_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [readBz]);
  return text ? <div className="banner warn small">{text}</div> : null;
}
