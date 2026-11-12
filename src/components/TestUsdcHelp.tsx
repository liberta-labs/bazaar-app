/**
 * How to see the test USDC in a wallet. Wallets only list tokens they know, and Bazaar's test USDC
 * is its own token on Arbitrum Sepolia, so a new user sees nothing after claiming it. This offers the
 * one-click route (EIP-747 `wallet_watchAsset`, which MetaMask, Rabby, Coinbase Wallet and most
 * WalletConnect wallets support) and the manual one, with the address to copy.
 */
import { type ReactNode, useState } from "react";
import type { Address } from "viem";
import { ACTIVE } from "../config/networks";
import { shortAddr } from "../lib/format";
import { useRead, useWallet } from "../state/connection";
import { Modal } from "./Modal";

/** What the token reports itself as (TestnetUSDC: symbol "USDC", 6 decimals). */
const SYMBOL = "USDC";
const DECIMALS = 6;

function Guide({ usdc, onClose, banner }: { usdc: Address; onClose: () => void; banner?: ReactNode }) {
  const w = useWallet();
  const [state, setState] = useState<null | "adding" | "added" | "declined" | "unsupported">(null);
  const [copied, setCopied] = useState(false);

  const add = async () => {
    if (!w.provider) return w.openConnect();
    setState("adding");
    try {
      await w.ensureChain();
      const ok = await w.provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: usdc, symbol: SYMBOL, decimals: DECIMALS } },
      });
      setState(ok === false ? "declined" : "added");
    } catch (e) {
      const code = (e as { code?: number })?.code;
      setState(code === 4001 ? "declined" : "unsupported");
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(usdc).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal title="See test USDC in your wallet" onClose={onClose}>
      <div className="stack">
        {banner}
        <p className="small muted" style={{ margin: 0 }}>
          Wallets only show tokens they know about. Bazaar's test USDC is its own token on {ACTIVE.name}, so you add it to your wallet once to see your balance.
        </p>

        <button className="primary" onClick={() => void add()} disabled={state === "adding"}>
          {state === "adding" ? "Check your wallet…" : w.address ? "Add test USDC to my wallet" : "Connect wallet to add it"}
        </button>
        {state === "added" && <div className="small up">Done. Test USDC now shows in your wallet's token list on {ACTIVE.name}.</div>}
        {state === "declined" && <div className="small muted">You cancelled in your wallet. You can try again, or add it by hand below.</div>}
        {state === "unsupported" && <div className="small accent">Your wallet couldn't add it automatically. Add it by hand with the steps below.</div>}

        <details className="panel" open={state === "unsupported"}>
          <summary className="small" style={{ cursor: "pointer" }}>
            Add it by hand
          </summary>
          <ol className="small" style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Switch your wallet to the {ACTIVE.name} network.</li>
            <li>
              Find <b>Import tokens</b> or <b>Add custom token</b> (in MetaMask: the Tokens tab, then <b>Import tokens</b>; in phone wallets it's usually under <b>Manage tokens</b>).
            </li>
            <li>
              Paste the token address:
              <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "nowrap" }}>
                <code className="mono small" style={{ overflowWrap: "anywhere", flex: 1, minWidth: 0 }}>
                  {usdc}
                </code>
                <button className="small" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </li>
            <li>
              If your wallet asks, the symbol is <b>{SYMBOL}</b> and decimals are <b>{DECIMALS}</b>.
            </li>
          </ol>
        </details>

        {w.address && (
          <a className="small" href={`${ACTIVE.explorer}/token/${usdc}?a=${w.address}`} target="_blank" rel="noopener noreferrer">
            Or check your test USDC balance on Arbiscan ↗
          </a>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Test USDC has no real value and exists only on {ACTIVE.name}. It's a different token from real USDC ({shortAddr(usdc)}).
        </p>
      </div>
    </Modal>
  );
}

/** The guide on its own, opened by the caller: after the faucet sends test USDC, say. Testnet only. */
export function TestUsdcGuide({ onClose, banner }: { onClose: () => void; banner?: ReactNode }) {
  const { readBz } = useRead();
  if (!ACTIVE.testnet || !readBz) return null;
  return <Guide usdc={readBz.deployment.usdc} onClose={onClose} banner={banner} />;
}

/** A link that opens the guide. Testnet only. */
export function TestUsdcHelpLink({ label = "How do I see it in my wallet?" }: { label?: string }) {
  const { readBz } = useRead();
  const [open, setOpen] = useState(false);
  if (!ACTIVE.testnet || !readBz) return null;
  return (
    <>
      <button className="link small" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <Guide usdc={readBz.deployment.usdc} onClose={() => setOpen(false)} />}
    </>
  );
}
