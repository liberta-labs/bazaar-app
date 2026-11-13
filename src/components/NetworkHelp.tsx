/**
 * How to put a wallet on the app's network. The app asks a newly connected wallet to switch, and the
 * wrong-network banner offers it after that, but a wallet that has never seen Arbitrum Sepolia must
 * add it first, and some only add a network from their own settings. This offers the one-click route
 * (`ensureChain`: `wallet_switchEthereumChain`, adding the network with `wallet_addEthereumChain` when
 * the wallet does not know it) and the manual one, with each field to copy.
 */
import { useState } from "react";
import { ACTIVE } from "../config/networks";
import { useWallet } from "../state/connection";
import { Modal } from "./Modal";

/** One network setting with a button that copies it. */
function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <>
      <span>{label}</span>
      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <code className="mono small" style={{ overflowWrap: "anywhere", flex: 1, minWidth: 0 }}>
          {value}
        </code>
        <button className="small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    </>
  );
}

function Guide({ onClose }: { onClose: () => void }) {
  const w = useWallet();
  const [state, setState] = useState<null | "adding" | "done" | "declined" | "failed">(null);
  const onNetwork = !!w.address && !w.wrongChain;

  const add = async () => {
    if (!w.provider) return w.openConnect();
    setState("adding");
    try {
      await w.ensureChain();
      setState("done");
    } catch (e) {
      setState((e as { code?: number })?.code === 4001 ? "declined" : "failed");
    }
  };

  return (
    <Modal title={`Add ${ACTIVE.name} to your wallet`} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          Bazaar runs on {ACTIVE.name}
          {ACTIVE.testnet ? ", Arbitrum's test network" : ""}. Your wallet has to be on it to deposit and trade. Most wallets switch when Bazaar asks; if yours doesn't know the network yet, add it once.
        </p>

        {onNetwork ? (
          <div className="small up">{state === "done" ? "Done. Your wallet is on" : "Your wallet is already on"} {ACTIVE.name}.</div>
        ) : (
          <button className="primary" onClick={() => void add()} disabled={state === "adding"}>
            {state === "adding" ? "Check your wallet…" : w.address ? `Add ${ACTIVE.name} to my wallet` : "Connect wallet to add it"}
          </button>
        )}
        {state === "declined" && <div className="small muted">You cancelled in your wallet. You can try again, or add it by hand below.</div>}
        {state === "failed" && <div className="small accent">Your wallet couldn't add it automatically. Add it by hand with the settings below.</div>}

        <details className="panel" open={state === "failed"}>
          <summary className="small" style={{ cursor: "pointer" }}>
            Add it by hand
          </summary>
          <p className="small" style={{ margin: "10px 0" }}>
            In your wallet, open the network list and choose <b>Add network</b> (in MetaMask: the network menu, then <b>Add a custom network</b>). Enter these settings, save, then select{" "}
            {ACTIVE.name}.
          </p>
          <div className="kv small">
            <Field label="Network name" value={ACTIVE.name} />
            <Field label="RPC URL" value={ACTIVE.rpcUrl} />
            <Field label="Chain ID" value={String(ACTIVE.chainId)} />
            <Field label="Currency symbol" value={ACTIVE.nativeCurrency.symbol} />
            <Field label="Block explorer" value={ACTIVE.explorer} />
          </div>
        </details>
      </div>
    </Modal>
  );
}

/** A link that opens the guide. */
export function NetworkHelpLink({ label = `How do I add ${ACTIVE.name}?` }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link small" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <Guide onClose={() => setOpen(false)} />}
    </>
  );
}
