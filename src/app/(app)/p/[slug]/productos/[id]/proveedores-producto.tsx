import { ChevronRight, Store } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { formatearMonto } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";
import type { ProveedorDeProducto } from "@/server/services/proveedor.service";

const precio = (p: ProveedorDeProducto) => formatearMonto(p.precio, p.moneda);

/** "Proveedores que lo venden", del más barato al más caro (solo dueños o quien ve Compras/Proveedores). */
export function ProveedoresProducto({
  proveedores,
  baseProveedores,
}: {
  proveedores: ProveedorDeProducto[];
  baseProveedores: string;
}) {
  return (
    <SectionCard
      title="Proveedores que lo venden"
      description="Ordenados del más barato al más caro."
    >
      {proveedores.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Store className="text-subtle/70 size-10" strokeWidth={1.25} aria-hidden />
          <p className="text-muted text-sm">
            Todavía ningún proveedor tiene precio para este producto.
          </p>
        </div>
      ) : (
        <ol className="border-border bg-surface divide-border rounded-card divide-y overflow-hidden border">
          {proveedores.map((p, i) => (
            <li key={p.proveedorId}>
              <Link
                href={`${baseProveedores}/${p.proveedorId}`}
                className="hover:bg-card/60 flex min-h-14 items-center gap-3 px-4 py-3 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{p.nombreTienda}</span>
                    {i === 0 && proveedores.length > 1 && (
                      <Badge variant="success">Más barato</Badge>
                    )}
                  </span>
                  <span className="text-muted text-small block truncate">
                    {[p.nombre, p.telefono].filter(Boolean).join(" · ")} · actualizado{" "}
                    {formatearFecha(p.actualizadoAt)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{precio(p)}</span>
                <ChevronRight
                  className="text-subtle size-5 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
