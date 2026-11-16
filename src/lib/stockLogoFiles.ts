// Written by scripts/fetch-stock-logos.mjs: run it (npm run logos) rather than editing this by hand.
// The stock logos downloaded from Logo.dev into public/stock-logos, by ticker: the version's etag, and
// whether the logo has a transparent background.

export interface StockLogoFile {
  readonly etag: string;
  readonly transparent: boolean;
}

export const STOCK_LOGO_FILES: Readonly<Record<string, StockLogoFile>> = {
  "APP": { etag: "3369fbab5542c7974e72f050f27b9fd2fc20bedb369b771bf674465e4c0f31c0", transparent: false },
  "KMX": { etag: "3874e4e6e77adadbc949c68238b9f41340842677d679b6087029c142a72e834e", transparent: true },
  "NVDA": { etag: "671900f7917cef842144172afb1d40e9ced7d721dcb5204287b47ab6dd8da024", transparent: false },
  "OKLO": { etag: "fb802049f9b6831fc2d7bd4c00b37062d675d865624535e1aab61139e07f5c21", transparent: true },
  "QQQ": { etag: "aac0f90b3027754c9a4a0c2e950b874f8eb9c30ad5df63fdffe863ba7ad75353", transparent: true },
  "SBUX": { etag: "6b2d51a6bb207ffdcdaa8855c2bda8c542624ab18a98f417d00fde81bd81e86f", transparent: true },
  "SKHY": { etag: "0932c4f2bb0b0304e3e2ac01c8c3577d0b68399fcabe4d6cfd2b2d37d20c7799", transparent: true },
  "SOFI": { etag: "2cee592206b26337d7518c5f398a113f8a504f572d2e5226d7b33c63b5471ccb", transparent: true },
  "SPCX": { etag: "a7cbf443bad524bdd8bc5a75bbaeb3af471d6b1e1392d63ef406a066f4298f6f", transparent: false },
  "SPY": { etag: "bcaddd63a37e66081f50210542f3e2ba58adb37fdb13ad10e37e3594425d6b72", transparent: false },
  "TSLA": { etag: "3f50a2fd43648e2c7ddad5e2c7a68aac5e2783ab165d0e13c1ab3dfb2b5a8fed", transparent: true },
  "TSM": { etag: "8b6c571d4f6f57db0b5a1d5fa758a0718e8c76f3935ee45401ae62e554208c17", transparent: false },
};
