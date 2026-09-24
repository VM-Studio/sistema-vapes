import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Oculta la columna en la card mobile por defecto (cuando no hay renderMobile). */
  ocultarEnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Cómo se ve cada fila en mobile. Si falta, se arma una card con "columna: valor". */
  renderMobile?: (row: T) => ReactNode;
  empty?: ReactNode;
  className?: string;
  caption?: string;
}

/**
 * Tabla responsive: <table> en desktop (≥768px) y lista de cards en mobile.
 * Sin estado propio: se puede usar desde Server o Client Components.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  renderMobile,
  empty,
  className,
  caption,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={className}>
      {/* Desktop */}
      <div className="border-border bg-surface hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3 font-medium", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr key={getRowKey(row)} className="hover:bg-surface-2/40">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={getRowKey(row)}>
            {renderMobile ? (
              renderMobile(row)
            ) : (
              <div className="border-border bg-surface rounded-xl border p-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {columns
                    .filter((c) => !c.ocultarEnMobile)
                    .map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-muted">{c.header}</dt>
                        <dd className="text-right">{c.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
