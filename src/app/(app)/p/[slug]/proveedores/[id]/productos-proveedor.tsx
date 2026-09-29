"use client";

import { Check, Package, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BuscadorRemoto } from "@/components/compras/buscador-remoto";
import { formatearMonto } from "@/components/compras/formato";
import { soloDecimal } from "@/components/compras/proveedor-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFecha } from "@/lib/utils";
import type { ProductoDeProveedorDTO } from "@/server/services/proveedor.service";

import {
  asignarProductoAction,
  buscarProductosProveedorAction,
  quitarProductoAction,
} from "../actions";

type Moneda = "ARS" | "USD";

interface Fila {
  productoId: string;
  nombreCompleto: string;
  precio: string;
  moneda: Moneda;
  actualizadoAt: Date | null;
  /** Precio guardado (para saber si cambió). null = fila nueva, sin guardar. */
  guardado: { precio: string; moneda: Moneda } | null;
}

const aFila = (p: ProductoDeProveedorDTO): Fila => ({
  productoId: p.productoId,
  nombreCompleto: p.nombreCompleto,
  precio: p.precio === null ? "" : String(Number(p.precio)),
  moneda: p.moneda ?? "ARS",
  actualizadoAt: p.actualizadoAt,
  guardado:
    p.precio === null ? null : { precio: String(Number(p.precio)), moneda: p.moneda ?? "ARS" },
});

/**
 * Productos que vende el proveedor. Con precios visibles y permiso de
 * edición: tabla editable inline (guardar fija actualizadoAt = ahora),
 * agregar y quitar. Sin precios: solo la lista de productos.
 */
export function ProductosProveedor({
  proveedorId,
  productos,
  verPrecios,
  puedeEditar,
}: {
  proveedorId: string;
  productos: ProductoDeProveedorDTO[];
  verPrecios: boolean;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[]>(() => productos.map(aFila));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const editable = verPrecios && puedeEditar;

  const [previos, setPrevios] = useState(productos);
  if (previos !== productos) {
    // Llegaron datos nuevos del servidor: conservar lo editado sin guardar y las filas nuevas.
    setPrevios(productos);
    setFilas((fs) => [
      ...productos.map((p) => {
        const fila = aFila(p);
        const local = fs.find((f) => f.productoId === p.productoId);
        const editada =
          local?.guardado &&
          (local.precio !== local.guardado.precio || local.moneda !== local.guardado.moneda);
        return local && editada ? { ...fila, precio: local.precio, moneda: local.moneda } : fila;
      }),
      ...fs.filter(
        (f) => f.guardado === null && !productos.some((p) => p.productoId === f.productoId),
      ),
    ]);
  }

  const actualizar = (productoId: string, cambios: Partial<Fila>) =>
    setFilas((fs) => fs.map((f) => (f.productoId === productoId ? { ...f, ...cambios } : f)));

  async function guardar(f: Fila) {
    setGuardando(f.productoId);
    setErrores((e) => ({ ...e, [f.productoId]: "" }));
    const r = await asignarProductoAction({
      proveedorId,
      productoId: f.productoId,
      precio: f.precio.replace(",", "."),
      moneda: f.moneda,
    });
    setGuardando(null);
    if (!r.ok) {
      const msj = r.error.fields?.precio?.[0] ?? r.error.message;
      setErrores((e) => ({ ...e, [f.productoId]: msj }));
      return;
    }
    toast.success("Precio guardado", f.nombreCompleto);
    router.refresh();
  }

  async function quitar(f: Fila) {
    if (f.guardado === null) {
      setFilas((fs) => fs.filter((x) => x.productoId !== f.productoId));
      return;
    }
    setGuardando(f.productoId);
    const r = await quitarProductoAction({ proveedorId, productoId: f.productoId });
    setGuardando(null);
    if (!r.ok) return toast.error("No se pudo quitar", r.error.message);
    setFilas((fs) => fs.filter((x) => x.productoId !== f.productoId));
    toast.success("Producto quitado", f.nombreCompleto);
    router.refresh();
  }

  const columnasDesktop = editable
    ? "md:grid-cols-[minmax(0,1fr)_9rem_6rem_7.5rem_2.5rem]"
    : puedeEditar
      ? "md:grid-cols-[minmax(0,1fr)_auto_2.5rem]"
      : "md:grid-cols-[minmax(0,1fr)_auto]";

  return (
    <SectionCard
      title="Productos y precios"
      description={
        editable ? "Editá el precio y guardalo: queda registrada la fecha de hoy." : undefined
      }
      contentClassName="flex flex-col gap-4"
    >
      {filas.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Todavía no tiene productos cargados"
          className="bg-surface py-10 md:py-12"
        />
      ) : (
        <div className="border-border bg-surface rounded-card overflow-hidden border">
          <div
            aria-hidden
            className={cn(
              "border-border bg-card text-muted hidden h-10 items-center gap-3 border-b px-4 text-xs font-medium md:grid",
              columnasDesktop,
            )}
          >
            <span>Producto</span>
            {editable ? (
              <>
                <span className="text-right">Precio</span>
                <span>Moneda</span>
                <span />
              </>
            ) : (
              verPrecios && <span className="text-right">Precio</span>
            )}
            {puedeEditar && <span />}
          </div>
          <ul aria-label="Productos del proveedor" className="divide-border flex flex-col divide-y">
            {filas.map((f) => {
              const cambio =
                f.guardado === null ||
                f.guardado.precio !== String(Number(f.precio.replace(",", "."))) ||
                f.guardado.moneda !== f.moneda;
              return (
                <li
                  key={f.productoId}
                  className={cn(
                    "grid items-center gap-x-3 gap-y-2 px-4 py-3",
                    editable
                      ? "grid-cols-[minmax(0,1fr)_5.5rem_auto]"
                      : "grid-cols-[minmax(0,1fr)_auto_auto]",
                    columnasDesktop,
                  )}
                >
                  <div className={cn("min-w-0", editable && "col-span-2 md:col-span-1")}>
                    <p className="font-medium">{f.nombreCompleto}</p>
                    {verPrecios && (
                      <p className="text-subtle text-xs">
                        {f.actualizadoAt
                          ? `Actualizado ${formatearFecha(f.actualizadoAt)}`
                          : "Sin guardar"}
                      </p>
                    )}
                    {errores[f.productoId] && (
                      <p className="text-danger text-xs">{errores[f.productoId]}</p>
                    )}
                  </div>
                  {editable ? (
                    <>
                      <input
                        inputMode="decimal"
                        aria-label={`Precio de ${f.nombreCompleto}`}
                        placeholder="Precio"
                        value={f.precio}
                        onChange={(e) =>
                          actualizar(f.productoId, { precio: soloDecimal(e.target.value) })
                        }
                        className={cn(controlClass, "h-11 text-right tabular-nums md:h-10")}
                      />
                      <select
                        aria-label={`Moneda de ${f.nombreCompleto}`}
                        value={f.moneda}
                        onChange={(e) =>
                          actualizar(f.productoId, { moneda: e.target.value as Moneda })
                        }
                        className={cn(controlClass, "h-11 md:h-10")}
                      >
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                      <Button
                        size="sm"
                        variant={cambio && f.precio !== "" ? "primary" : "secondary"}
                        className="max-md:h-11"
                        disabled={!cambio || f.precio === ""}
                        loading={guardando === f.productoId}
                        onClick={() => void guardar(f)}
                        aria-label={`Guardar precio de ${f.nombreCompleto}`}
                      >
                        <Check strokeWidth={1.75} /> Guardar
                      </Button>
                    </>
                  ) : (
                    verPrecios && (
                      <span className="text-right font-semibold tabular-nums">
                        {formatearMonto(f.guardado?.precio, f.guardado?.moneda)}
                      </span>
                    )
                  )}
                  {puedeEditar && (
                    <IconButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar ${f.nombreCompleto}`}
                      className={cn(
                        "text-muted hover:text-danger justify-self-end max-md:size-11",
                        editable && "col-start-3 row-start-1 md:col-start-auto md:row-start-auto",
                      )}
                      disabled={guardando === f.productoId}
                      onClick={() => void quitar(f)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {editable && (
        <BuscadorRemoto
          ariaLabel="Agregar producto que vende"
          placeholder="Agregar producto (marca, modelo…)"
          buscar={(q) => buscarProductosProveedorAction({ q })}
          getKey={(p) => p.id}
          render={(p) => <span className="truncate">{p.nombreCompleto}</span>}
          onSelect={(p) =>
            setFilas((fs) =>
              fs.some((f) => f.productoId === p.id)
                ? fs
                : [
                    ...fs,
                    {
                      productoId: p.id,
                      nombreCompleto: p.nombreCompleto,
                      precio: "",
                      moneda: "ARS",
                      actualizadoAt: null,
                      guardado: null,
                    },
                  ],
            )
          }
        />
      )}
    </SectionCard>
  );
}
