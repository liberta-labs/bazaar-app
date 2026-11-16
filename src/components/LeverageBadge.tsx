/** A market's max leverage as a badge beside its name, in the markets table and the market switcher's list. */
import type { markets } from "@liberta-labs/bazaar-sdk";
import { leverageShort } from "../lib/format";
import { Tip } from "./ui";

/**
 * Nothing until the market's snapshot is read, or while its initial margin reads 0. `tip` off for a badge
 * inside a button (the switcher's rows), where a focusable tip can't go; it says the same in a title.
 */
export function LeverageBadge({ snap, tip = true }: { snap: markets.MarketSnapshot | undefined; tip?: boolean }) {
  const max = snap?.margin.maxLeverage ?? null;
  if (max === null) return null;
  const text = `Max leverage: the most a new position can take now.${snap?.warmup?.active ? " Capped while the market is new." : ""}`;
  if (!tip) {
    return (
      <span className="badge" title={text}>
        {leverageShort(max)}
      </span>
    );
  }
  return (
    <Tip text={text}>
      <span className="badge">{leverageShort(max)}</span>
    </Tip>
  );
}
