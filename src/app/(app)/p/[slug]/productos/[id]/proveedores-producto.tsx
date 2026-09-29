import { Store } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatearPesos } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";
import type { ProveedorDeProducto } from "@/server/services/proveedor.service";

const precio = (p: ProveedorDeProducto) =>
  p.moneda === "USD" ? `US$ ${Number(p.precio).toLocaleString("es-AR")}` : formatearPesos(p.precio);

/** "Proveedores que lo venden", del más barato al más caro (solo dueños o quien ve Compras/Proveedores). */
export function ProveedoresProducto({
  proveedores,
  baseProveedores,
}: {
  proveedores: ProveedorDeProducto[];
  baseProveedores: string;
}) {
  return (
    <section aria-labelledby="proveedores" className="mt-6">
      <h2 id="proveedores" className="mb-3 text-lg font-semibold">
        Proveedores que lo venden
      </h2>
      {proveedores.length === 0 ? (
        <p className="border-border text-muted rounded-card border border-dashed px-4 py-6 text-center text-sm">
          Todavía ningún proveedor tiene precio para este producto.
        </p>
      ) : (
        <ol className="border-border bg-surface divide-border divide-y rounded-card border">
          {proveedores.map((p, i) => (
            <li key={p.proveedorId}>
              <Link
                href={`${baseProveedores}/${p.proveedorId}`}
                className="hover:bg-surface-2/50 flex items-center gap-3 px-4 py-3"
              >
                <Store className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.nombreTienda}
                    {i === 0 && proveedores.length > 1 && (
                      <Badge variant="success" className="ml-2">
                        Más barato
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted block truncate text-xs">
                    {[p.nombre, p.telefono].filter(Boolean).join(" · ")} · actualizado{" "}
                    {formatearFecha(p.actualizadoAt)}
                  </span>
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums">{precio(p)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
