import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A dialog centered on the screen. It renders into document.body, so a parent that makes its own
 * frame for fixed elements (the header's backdrop-filter blur, say) cannot pin it to that parent.
 */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 640 } : undefined}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
