"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { controlClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  actualizarProveedorAction,
  buscarProductosProveedorAction,
  crearProveedorAction,
} from "@/app/(app)/p/[slug]/proveedores/actions";

import { BuscadorRemoto } from "./buscador-remoto";

export interface ProveedorEditable {
  id: string;
  nombre: string;
  nombreTienda: string;
  telefono: string | null;
  notas: string | null;
  activo: boolean;
}

interface FilaProducto {
  productoId: string;
  nombreCompleto: string;
  precio: string;
  moneda: "ARS" | "USD";
}

export const soloDecimal = (s: string) => s.replace(/[^\d.,]/g, "");

/** "+5491122334455" → "91122334455" para editar (se vuelve a normalizar al guardar). */
const telefonoEditable = (t: string | null) => (t ?? "").replace(/^\+54/, "");

/**
 * Alta/edición de proveedor. En el alta (y si quien carga ve precios) incluye
 * "Productos que vende": filas con buscador de productos del panel + precio +
 * moneda (se puede guardar sin productos). `compacto`: solo lo esencial
 * (crear rápido desde una compra).
 */
export function ProveedorForm({
  formId,
  proveedor,
  verPrecios,
  compacto = false,
  onListo,
  onEnviando,
}: {
  formId: string;
  proveedor: ProveedorEditable | null;
  verPrecios: boolean;
  compacto?: boolean;
  onListo: (p: { id: string; nombre: string; nombreTienda: string }) => void;
  onEnviando?: (e: boolean) => void;
}) {
  const toast = useToast();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [telefono, setTelefono] = useState(telefonoEditable(proveedor?.telefono ?? null));
  const [nombreTienda, setNombreTienda] = useState(proveedor?.nombreTienda ?? "");
  const [notas, setNotas] = useState(proveedor?.notas ?? "");
  const [activo, setActivo] = useState(proveedor?.activo ?? true);
  const [filas, setFilas] = useState<FilaProducto[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  useEffect(() => onEnviando?.(enviando), [enviando, onEnviando]);

  const conProductos = !proveedor && !compacto && verPrecios;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    const base = { nombre, telefono, nombreTienda, notas };
    const r = proveedor
      ? await actualizarProveedorAction({ ...base, id: proveedor.id, activo })
      : await crearProveedorAction({
          ...base,
          productos: filas.map((f) => ({
            productoId: f.productoId,
            precio: f.precio.replace(",", "."),
            moneda: f.moneda,
          })),
        });
    setEnviando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudo guardar el proveedor", r.error.message);
      return;
    }
    if (proveedor) {
      toast.success("Proveedor actualizado");
      onListo({ id: proveedor.id, nombre, nombreTienda });
    } else {
      const creado = r.data as { id: string; nombre: string; nombreTienda: string };
      toast.success("Proveedor creado", `${creado.nombre} · ${creado.nombreTienda}`);
      onListo(creado);
    }
  }

  const actualizarFila = (productoId: string, cambios: Partial<FilaProducto>) =>
    setFilas((fs) => fs.map((f) => (f.productoId === productoId ? { ...f, ...cambios } : f)));

  return (
    <form id={formId} onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-8" noValidate>
      <section
        aria-labelledby={compacto ? undefined : `${formId}-datos`}
        className="flex flex-col gap-4"
      >
        {!compacto && (
          <h3 id={`${formId}-datos`} className="text-h3 font-semibold">
            Datos del proveedor
          </h3>
        )}
        <Input
          label="Nombre"
          hint="La persona de contacto."
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          error={errores.nombre}
          autoComplete="off"
        />
        <Input
          label="Nombre de la tienda"
          required
          value={nombreTienda}
          onChange={(e) => setNombreTienda(e.target.value)}
          error={errores.nombreTienda}
          autoComplete="off"
        />
        <Input
          label="Teléfono"
          type="tel"
          inputMode="tel"
          placeholder="11 2233-4455"
          hint="Con código de área, sin 0 ni 15."
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          error={errores.telefono}
        />
        {!compacto && (
          <Textarea
            label="Notas"
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            error={errores.notas}
          />
        )}
        {proveedor && (
          <Switch
            label="Activo"
            checked={activo}
            onCheckedChange={setActivo}
            hint="Un proveedor inactivo no aparece para nuevas compras."
            error={errores.activo}
          />
        )}
      </section>

      {conProductos && (
        <section aria-labelledby={`${formId}-productos`} className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 id={`${formId}-productos`} className="text-h3 font-semibold">
              Productos que vende
            </h3>
            <p className="text-muted text-small">
              Opcional: podés cargarlos después desde su ficha.
            </p>
          </div>
          <BuscadorRemoto
            ariaLabel="Agregar producto que vende"
            placeholder="Agregar producto (marca, modelo…)"
            buscar={(q) => buscarProductosProveedorAction({ q })}
            getKey={(p) => p.id}
            render={(p) => (
              <span className="truncate">
                {p.nombreCompleto}
                {filas.some((f) => f.productoId === p.id) && (
                  <span className="text-subtle ml-2 text-xs">(ya agregado)</span>
                )}
              </span>
            )}
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
                      },
                    ],
              )
            }
          />
          {filas.length > 0 && (
            <div className="border-border bg-surface rounded-card overflow-hidden border">
              <div
                aria-hidden
                className="border-border bg-card text-muted hidden h-9 grid-cols-[minmax(0,1fr)_7rem_5.5rem_2.75rem] items-center gap-2 border-b px-3 text-xs font-medium md:grid"
              >
                <span>Producto</span>
                <span className="text-right">Precio</span>
                <span>Moneda</span>
                <span />
              </div>
              <ul className="divide-border flex flex-col divide-y">
                {filas.map((f, i) => (
                  <li
                    key={f.productoId}
                    className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_7rem_5.5rem_2.75rem]"
                  >
                    <p className="text-small min-w-0 font-medium">{f.nombreCompleto}</p>
                    <label className="flex flex-col gap-1">
                      <span className="sr-only">Precio de {f.nombreCompleto}</span>
                      <input
                        inputMode="decimal"
                        placeholder="Precio"
                        aria-label={`Precio de ${f.nombreCompleto}`}
                        value={f.precio}
                        onChange={(e) =>
                          actualizarFila(f.productoId, { precio: soloDecimal(e.target.value) })
                        }
                        aria-invalid={errores[`productos.${i}.precio`] ? true : undefined}
                        className={cn(controlClass, "h-11 px-2.5 text-right tabular-nums")}
                      />
                    </label>
                    <select
                      aria-label={`Moneda de ${f.nombreCompleto}`}
                      value={f.moneda}
                      onChange={(e) =>
                        actualizarFila(f.productoId, { moneda: e.target.value as "ARS" | "USD" })
                      }
                      className={cn(controlClass, "h-11 px-2.5")}
                    >
                      <option value="ARS">ARS</option>
                      <option value="USD">USD</option>
                    </select>
                    <IconButton
                      variant="ghost"
                      className="hover:text-danger col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto"
                      onClick={() =>
                        setFilas((fs) => fs.filter((x) => x.productoId !== f.productoId))
                      }
                      aria-label={`Quitar ${f.nombreCompleto}`}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                    {errores[`productos.${i}.precio`] && (
                      <p className="text-danger text-small col-span-2 md:col-span-4">
                        {errores[`productos.${i}.precio`]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {errores.productos && <p className="text-danger text-small">{errores.productos}</p>}
        </section>
      )}
    </form>
  );
}
