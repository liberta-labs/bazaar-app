/**
 * Coin icons from web3icons (MIT), by upper-case ticker, each a lazily loaded SVG string: its "background"
 * variant, the mark on a square of the brand's colour, which the round .asset-icon crops to a coin. Its
 * own chunk, loaded the first time a coin icon is drawn (components/AssetIcon.tsx). A coin missing here
 * keeps the letter tile.
 */

export type SvgLoader = () => Promise<string>;

/**
 * Coins web3icons draws with their network's icon rather than a token's: the "network:" entries of its
 * metadata (@web3icons/common), kept in step by test/assetIcon.test.ts.
 */
export const NETWORK_COINS: Readonly<Record<string, SvgLoader>> = {
  AME: () => import("@web3icons/core/svgs/networks/background/ame-chain.svg.js").then((m) => m.default),
  ANM: () => import("@web3icons/core/svgs/networks/background/animica.svg.js").then((m) => m.default),
  CC: () => import("@web3icons/core/svgs/networks/background/canton.svg.js").then((m) => m.default),
  CRAB: () => import("@web3icons/core/svgs/networks/background/crab.svg.js").then((m) => m.default),
  FTN: () => import("@web3icons/core/svgs/networks/background/bahamut.svg.js").then((m) => m.default),
  GUN: () => import("@web3icons/core/svgs/networks/background/gunz.svg.js").then((m) => m.default),
  HYPE: () => import("@web3icons/core/svgs/networks/background/hyper-evm.svg.js").then((m) => m.default),
  INJ: () => import("@web3icons/core/svgs/networks/background/injective.svg.js").then((m) => m.default),
  JURIS: () => import("@web3icons/core/svgs/networks/background/juris.svg.js").then((m) => m.default),
  L1: () => import("@web3icons/core/svgs/networks/background/genesis-l1.svg.js").then((m) => m.default),
  MINIMA: () => import("@web3icons/core/svgs/networks/background/minima.svg.js").then((m) => m.default),
  MON: () => import("@web3icons/core/svgs/networks/background/monad.svg.js").then((m) => m.default),
  PLS: () => import("@web3icons/core/svgs/networks/background/pulsechain.svg.js").then((m) => m.default),
  PLUME: () => import("@web3icons/core/svgs/networks/background/plume.svg.js").then((m) => m.default),
  SIS: () => import("@web3icons/core/svgs/networks/background/symbiosis.svg.js").then((m) => m.default),
  TON: () => import("@web3icons/core/svgs/networks/background/ton.svg.js").then((m) => m.default),
  UPTICK: () => import("@web3icons/core/svgs/networks/background/uptick.svg.js").then((m) => m.default),
  XPL: () => import("@web3icons/core/svgs/networks/background/plasma.svg.js").then((m) => m.default),
};

/** Every coin's icon: the token files, named by ticker, and the coins drawn with a network's icon. */
export const COIN_SVGS: Readonly<Record<string, SvgLoader>> = {
  ...Object.fromEntries(
    Object.entries(import.meta.glob<string>("/node_modules/@web3icons/core/dist/svgs/tokens/background/*.svg.js", { import: "default" })).map(([path, load]) => [
      path.slice(path.lastIndexOf("/") + 1, -".svg.js".length),
      load,
    ]),
  ),
  ...NETWORK_COINS,
};

/** This coin's icon loader, in any case; undefined when the set lacks it. */
export const coinIcon = (ticker: string): SvgLoader | undefined => {
  const key = ticker.toUpperCase();
  return Object.hasOwn(COIN_SVGS, key) ? COIN_SVGS[key] : undefined;
};
