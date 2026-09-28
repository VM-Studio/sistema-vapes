import { cn } from "@/lib/utils";
import type { MatrizStockProducto } from "@/server/services/inventario.service";

/** Grilla compacta sabores × depósitos: cuántos Mango Ice hay en cada galpón de un vistazo. */
export function MatrizStock({ matriz }: { matriz: MatrizStockProducto }) {
  const { depositos, filas, totalesPorDeposito, total } = matriz;
  return (
    <section
      aria-labelledby="matriz"
      className="border-border bg-surface mb-4 rounded-xl border p-3 md:p-4"
    >
      <h2 id="matriz" className="mb-2 text-sm font-semibold">
        Stock por sabor y depósito
      </h2>
      <div className="-mx-3 overflow-x-auto px-3">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="text-muted text-xs">
              <th scope="col" className="py-1.5 pr-3 text-left font-medium">
                Sabor
              </th>
              {depositos.map((d) => (
                <th key={d.id} scope="col" className="px-2 py-1.5 text-center font-medium">
                  {d.nombre}
                </th>
              ))}
              <th scope="col" className="text-foreground py-1.5 pl-2 text-center font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.varianteId}>
                <th scope="row" className="max-w-40 truncate py-1 pr-3 text-left font-medium">
                  {f.variante}
                </th>
                {depositos.map((d) => {
                  const n = f.porDeposito[d.id] ?? 0;
                  return (
                    <td key={d.id} className="px-1 py-1">
                      <span
                        className={cn(
                          "flex h-9 min-w-12 items-center justify-center rounded-md font-semibold tabular-nums",
                          n === 0
                            ? "bg-surface-2 text-muted"
                            : "bg-primary-soft text-primary-soft-foreground",
                        )}
                      >
                        {n}
                      </span>
                    </td>
                  );
                })}
                <td className="py-1 pl-1">
                  <span
                    className={cn(
                      "flex h-9 min-w-12 items-center justify-center rounded-md border font-bold tabular-nums",
                      f.estado === "SIN_STOCK"
                        ? "border-danger/40 text-danger"
                        : f.estado === "BAJO"
                          ? "border-warning-soft-foreground/40 text-warning-soft-foreground"
                          : "border-border",
                    )}
                    title={`Mínimo: ${f.stockMinimo}`}
                  >
                    {f.total}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-muted text-xs">
              <th scope="row" className="pt-2 pr-3 text-left font-medium">
                Total
              </th>
              {depositos.map((d) => (
                <td
                  key={d.id}
                  className="text-foreground pt-2 text-center font-semibold tabular-nums"
                >
                  {totalesPorDeposito[d.id] ?? 0}
                </td>
              ))}
              <td className="text-foreground pt-2 text-center text-base font-bold tabular-nums">
                {total}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
