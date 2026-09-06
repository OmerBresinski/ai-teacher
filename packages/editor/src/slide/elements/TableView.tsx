import type { TableElement } from "@tj/domain/documents";
import type { CSSProperties } from "react";
import { type ElementViewProps, resolveFontSize, withAlpha } from "./kit";

export function TableView({ element, theme }: ElementViewProps<TableElement>) {
  const rows = element.rows ?? [];
  const header = element.header !== false && rows.length > 0;
  const headRow = header ? rows[0] : null;
  const bodyRows = header ? rows.slice(1) : rows;
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const fontSize = resolveFontSize(theme, "small", element.fontSize);
  const padY = Math.round(fontSize * 0.42);
  const padX = Math.round(fontSize * 0.6);

  const widths =
    element.colWidths && element.colWidths.length === cols
      ? element.colWidths
      : Array.from({ length: cols }, () => 1 / Math.max(1, cols));

  const cell: CSSProperties = {
    padding: `${padY}px ${padX}px`,
    textAlign: "left",
    verticalAlign: "top",
    color: theme.colors.ink,
    borderBottom: `1px solid ${theme.colors.line}`,
  };

  return (
    <div
      style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: theme.radius / 2 }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontFamily: theme.fonts.body,
          fontSize,
          lineHeight: 1.35,
          fontWeight: theme.weights.body,
        }}
      >
        <colgroup>
          {widths.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
            <col key={i} style={{ width: `${w * 100}%` }} />
          ))}
        </colgroup>
        {headRow ? (
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, i) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                  key={i}
                  style={{
                    ...cell,
                    fontFamily: theme.fonts.title,
                    fontWeight: theme.weights.heading,
                    letterSpacing: theme.titleTracking,
                    borderBottom: `2px solid ${theme.colors.accent}`,
                  }}
                >
                  {headRow[i] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
              key={ri}
              style={
                element.stripe && ri % 2 === 1
                  ? { background: withAlpha(theme.colors.accent2, 0.06) }
                  : undefined
              }
            >
              {Array.from({ length: cols }, (_, ci) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: table cells are positional; a `string[][]` has no ids
                  key={ci}
                  style={ri === bodyRows.length - 1 ? { ...cell, borderBottom: "none" } : cell}
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
