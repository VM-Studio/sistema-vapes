"use client";

import Link from "next/link";

import { useRutaPanel } from "@/components/layout/panel-context";
import { hrefCon } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";
import { formatearNumero } from "@/lib/format";
import type { MovimientoListado } from "@/server/services/movimiento.service";

import { TablaMovimientos } from "../../stock/tabla-movimientos";

/**
 * Movimientos SOLO de este producto (todos sus sabores), más nuevos primero,
 * filtrables por sabor y galpón y paginados (parámetros `msabor`, `mgalpon`,
 * `mpage` para no pisar otros de la ficha). Incluye los retiros de ventas.
 */
export function MovimientosProducto({
  productoId,
  movimientos,
  total,
  page,
  pageSize,
  sabores,
  depositos,
}: {
  productoId: string;
  movimientos: MovimientoListado[];
  total: number;
  page: number;
  pageSize: number;
  /** Sabores del producto (vacío si no tiene sabores). */
  sabores: { id: string; nombre: string }[];
  depositos: { id: string; nombre: string }[];
}) {
  const ruta = useRutaPanel();
  const { params, actualizar } = useUrlParams();
  const paginas = Math.max(1, Math.ceil(total / pageSize));
  const actuales = Object.fromEntries(params.entries());
  const PATH = ruta(`/productos/${productoId}`);
  const hrefPagina = (p: number) =>
    `${hrefCon(PATH, actuales, { mpage: p === 1 ? null : p })}#movimientos-producto`;
  const historial = new URLSearchParams({ productoId });
  if (params.get("msabor")) historial.set("varianteId", params.get("msabor")!);
  if (params.get("mgalpon")) historial.set("depositoId", params.get("mgalpon")!);

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Filtros de movimientos"
        className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center"
      >
        {sabores.length > 1 && (
          <Select
            aria-label="Sabor"
            options={[
              { value: "", label: "Todos los sabores" },
              ...sabores.map((s) => ({ value: s.id, label: s.nombre })),
            ]}
            value={params.get("msabor") ?? ""}
            onChange={(e) => actualizar({ msabor: e.target.value || null, mpage: null })}
            containerClassName="md:w-56"
          />
        )}
        {depositos.length > 1 && (
          <Select
            aria-label="Galpón"
            options={[
              { value: "", label: "Todos los galpones" },
              ...depositos.map((d) => ({ value: d.id, label: d.nombre })),
            ]}
            value={params.get("mgalpon") ?? ""}
            onChange={(e) => actualizar({ mgalpon: e.target.value || null, mpage: null })}
            containerClassName="md:w-48"
          />
        )}
      </div>
      <TablaMovimientos
        movimientos={movimientos}
        conDeposito={!params.get("mgalpon")}
        conProducto={false}
        vacio="Este producto todavía no tuvo movimientos con esos filtros"
      />
      <nav
        aria-label="Paginación de movimientos del producto"
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <p className="text-muted">
          {total > 0
            ? `Página ${page} de ${paginas} · ${formatearNumero(total)} movimientos`
            : "Sin movimientos"}{" "}
          ·{" "}
          <Link
            href={ruta(`/productos/movimientos?${historial}`)}
            className="text-foreground font-medium underline underline-offset-4"
          >
            Ver en Movimientos
          </Link>
        </p>
        {paginas > 1 && (
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={hrefPagina(page - 1)}
                scroll={false}
                className="text-foreground font-medium underline underline-offset-4"
              >
                Anteriores
              </Link>
            )}
            {page < paginas && (
              <Link
                href={hrefPagina(page + 1)}
                scroll={false}
                className="text-foreground font-medium underline underline-offset-4"
              >
                Siguientes
              </Link>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
