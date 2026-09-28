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
import { useToast } from "@/components/ui/toast";
import { formatearFecha } from "@/lib/utils";
import { cn } from "@/lib/utils";
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

  return (
    <section aria-labelledby="productos-proveedor" className="flex flex-col gap-3">
      <h2 id="productos-proveedor" className="text-lg font-semibold">
        Productos y precios
      </h2>
      {filas.length === 0 ? (
        <EmptyState icon={Package} title="Todavía no tiene productos cargados" />
      ) : (
        <ul
          aria-label="Productos del proveedor"
          className="divide-border border-border bg-surface shadow-card flex flex-col divide-y rounded-2xl border"
        >
          {filas.map((f) => {
            const cambio =
              f.guardado === null ||
              f.guardado.precio !== String(Number(f.precio.replace(",", "."))) ||
              f.guardado.moneda !== f.moneda;
            return (
              <li
                key={f.productoId}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[1fr_8rem_6rem_7rem_auto]"
              >
                <div className="min-w-0">
                  <p className="font-medium">{f.nombreCompleto}</p>
                  {verPrecios && (
                    <p className="text-muted text-xs">
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
                      className={cn(
                        controlClass,
                        "col-start-1 h-11 text-right tabular-nums md:col-start-auto",
                      )}
                    />
                    <select
                      aria-label={`Moneda de ${f.nombreCompleto}`}
                      value={f.moneda}
                      onChange={(e) =>
                        actualizar(f.productoId, { moneda: e.target.value as Moneda })
                      }
                      className={cn(controlClass, "h-11")}
                    >
                      <option value="ARS">ARS</option>
                      <option value="USD">USD</option>
                    </select>
                    <Button
                      size="sm"
                      className="min-h-11"
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
                    <span className="font-semibold tabular-nums">
                      {formatearMonto(f.guardado?.precio, f.guardado?.moneda)}
                    </span>
                  )
                )}
                {puedeEditar && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-danger justify-self-end"
                    disabled={guardando === f.productoId}
                    onClick={() => void quitar(f)}
                    aria-label={`Quitar ${f.nombreCompleto}`}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
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
    </section>
  );
}
