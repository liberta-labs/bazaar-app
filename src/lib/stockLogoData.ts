/**
 * Company logos for stock markets, by ticker, in one chunk loaded the first time a stock icon is drawn
 * (components/AssetIcon.tsx): the logos downloaded from Logo.dev (stockLogoFiles.ts) first, then each
 * brand's mark from simple-icons (CC0), one SVG path on a 24×24 grid with its brand colour. A ticker in
 * neither keeps the generic tile.
 */
export { STOCK_LOGO_FILES, type StockLogoFile } from "./stockLogoFiles";
import { siAirbnb, siAlibabadotcom, siAmd, siAmericanexpress, siApple, siArm, siAtandt, siAtlassian, siBaidu, siBoeing, siBookingdotcom, siBroadcom, siCisco, siCloudflare, siCocacola, siCoinbase, siDatadog, siDell, siDoordash, siDuolingo, siEa, siEbay, siEricsson, siEtsy, siExpedia, siFord, siFortinet, siGeneralmotors, siGoogle, siHilton, siHp, siIntel, siIntuit, siLyft, siMarriott, siMastercard, siMcdonalds, siMeta, siMicrostrategy, siMongodb, siNetflix, siNike, siNokia, siNvidia, siOkta, siPalantir, siPaloaltonetworks, siPaypal, siPinterest, siQualcomm, siReddit, siRobinhood, siRoblox, siSap, siShopify, siSnapchat, siSnowflake, siSony, siSpotify, siStarbucks, siSupermicro, siTesla, siToyota, siUber, siUnity, siVerizon, siVisa, siZoom } from "simple-icons";

export interface StockLogo {
  readonly path: string;
  /** The brand colour, six hex digits without the #. */
  readonly hex: string;
}

export const STOCK_LOGOS: Readonly<Record<string, StockLogo>> = {
  NVDA: siNvidia,
  MSTR: siMicrostrategy,
  AAPL: siApple,
  TSLA: siTesla,
  GOOGL: siGoogle,
  GOOG: siGoogle,
  META: siMeta,
  NFLX: siNetflix,
  AMD: siAmd,
  INTC: siIntel,
  COIN: siCoinbase,
  HOOD: siRobinhood,
  PLTR: siPalantir,
  ARM: siArm,
  AVGO: siBroadcom,
  CSCO: siCisco,
  QCOM: siQualcomm,
  PYPL: siPaypal,
  UBER: siUber,
  ABNB: siAirbnb,
  SHOP: siShopify,
  SPOT: siSpotify,
  V: siVisa,
  MA: siMastercard,
  NKE: siNike,
  SBUX: siStarbucks,
  MCD: siMcdonalds,
  KO: siCocacola,
  BABA: siAlibabadotcom,
  SNOW: siSnowflake,
  F: siFord,
  BA: siBoeing,
  SMCI: siSupermicro,
  DELL: siDell,
  HPQ: siHp,
  SONY: siSony,
  TM: siToyota,
  SAP: siSap,
  RDDT: siReddit,
  SNAP: siSnapchat,
  PINS: siPinterest,
  RBLX: siRoblox,
  EA: siEa,
  ZM: siZoom,
  NET: siCloudflare,
  DDOG: siDatadog,
  MDB: siMongodb,
  TEAM: siAtlassian,
  INTU: siIntuit,
  T: siAtandt,
  VZ: siVerizon,
  PANW: siPaloaltonetworks,
  EBAY: siEbay,
  ETSY: siEtsy,
  DASH: siDoordash,
  LYFT: siLyft,
  BIDU: siBaidu,
  AXP: siAmericanexpress,
  GM: siGeneralmotors,
  U: siUnity,
  OKTA: siOkta,
  FTNT: siFortinet,
  DUOL: siDuolingo,
  NOK: siNokia,
  ERIC: siEricsson,
  BKNG: siBookingdotcom,
  EXPE: siExpedia,
  MAR: siMarriott,
  HLT: siHilton,
};
