import Link from "next/link";

import {
  esNumerica,
  formatearCelda,
  type FilaReporte,
  type SeccionReporte,
} from "@/lib/reportes/documento";
import { cn } from "@/lib/utils";

/** Una sección de un DocumentoReporte: la misma tabla que sale en PDF y Excel. */
export function TablaReporte({ seccion, max }: { seccion: SeccionReporte; max?: number }) {
  const s = seccion;
  const filas = max ? s.filas.slice(0, max) : s.filas;
  const celda = (f: FilaReporte, clave: string, i: number) => {
    const col = s.columnas[i]!;
    const texto =
      f[col.clave] === undefined && f._estilo ? "" : formatearCelda(f[col.clave] ?? null, col.tipo);
    const href = col.enlace ? f[col.enlace] : undefined;
    const negativo = col.tipo === "moneda" && Number(f[col.clave]) < 0;
    return (
      <td
        key={clave}
        className={cn(
          "px-3 py-2 whitespace-nowrap",
          esNumerica(col.tipo) && "text-right tabular-nums",
          negativo && "text-danger",
        )}
      >
        {typeof href === "string" && texto !== "—" ? (
          <Link href={href} className="text-primary hover:underline">
            {texto}
          </Link>
        ) : (
          texto
        )}
      </td>
    );
  };
  return (
    <section aria-labelledby={`sec-${s.id}`} className="flex min-w-0 flex-col gap-2">
      <div>
        <h3 id={`sec-${s.id}`} className="font-semibold">
          {s.titulo}
        </h3>
        {s.descripcion && <p className="text-muted text-sm">{s.descripcion}</p>}
      </div>
      <div className="border-border bg-surface overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              {s.columnas.map((c) => (
                <th
                  key={c.clave}
                  scope="col"
                  className={cn(
                    "px-3 py-2.5 font-medium whitespace-nowrap",
                    esNumerica(c.tipo) && "text-right",
                  )}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {filas.length === 0 && (
              <tr>
                <td colSpan={s.columnas.length} className="text-muted px-3 py-6 text-center">
                  {s.vacio ?? "Sin datos para este período."}
                </td>
              </tr>
            )}
            {filas.map((f, i) => (
              <tr
                key={i}
                className={cn(
                  f._estilo === "grupo" && "bg-surface-2 font-semibold",
                  f._estilo === "subtotal" && "bg-surface-2/50 font-semibold",
                  f._alerta === "danger" && "text-danger",
                  f._alerta === "warning" && "bg-warning-soft/40",
                )}
              >
                {s.columnas.map((c, j) => celda(f, c.clave, j))}
              </tr>
            ))}
          </tbody>
          {s.totales && (
            <tfoot className="border-foreground/60 border-t-2 font-semibold">
              <tr>{s.columnas.map((c, j) => celda(s.totales!, c.clave, j))}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {max && s.filas.length > max && (
        <p className="text-muted text-xs">
          Mostrando {max} de {s.filas.length}. La exportación incluye todo.
        </p>
      )}
    </section>
  );
}
