/**
 * A table's tools (Export CSV, Close all, filters and the like). Under the account's tabs they sit on
 * the tab bar's own row, at its right, so the table starts right under the tabs; anywhere else they get
 * a row of their own above the table.
 */
import { type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

/** Where tools go: the tab bar's slot, or null for a row above the table. */
export const TableToolsSlot = createContext<HTMLElement | null>(null);

export function TableTools({ children }: { children: ReactNode }) {
  const slot = useContext(TableToolsSlot);
  return slot ? createPortal(children, slot) : <div className="table-tools">{children}</div>;
}
