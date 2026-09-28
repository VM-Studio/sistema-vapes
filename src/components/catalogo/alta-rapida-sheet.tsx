"use client";

import { Modulo } from "@prisma/client";
import { CircleCheck, PackagePlus, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  altaRapidaAction,
  buscarProductosAltaAction,
  productoPorClaveAction,
} from "@/app/(app)/p/[slug]/productos/actions";
import { usePanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductoParaAlta } from "@/server/services/producto.service";

interface Datos {
  marca: string;
  modelo: string;
  especificacion: string;
  sabor: string;
  precio: string;
}

const VACIO: Datos = { marca: "", modelo: "", especificacion: "", sabor: "", precio: "" };
/** "10.000" / "10000,50" / "10000.5" → monto con punto decimal. */
export function aMonto(s: string): string {
  const t = s.trim();
  if (t.includes(",")) return t.replace(/\./g, "").replace(",", ".");
  return /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
}

/**
 * Alta rápida de un código desconocido: marca (con autocompletar; si no
 * existe se crea), modelo, especificación (con la etiqueta del panel), sabor y
 * precio. Si marca + modelo + especificación ya existe lo detecta y solo pide
 * el sabor (y el precio, solo si difiere). Al guardar devuelve el sabor listo
 * para la lista.
 */
export function AltaRapidaSheet({
  codigo,
  abierto,
  onCerrar,
  onCreada,
}: {
  codigo: string | null;
  abierto: boolean;
  onCerrar: () => void;
  onCreada: (v: VarianteEncontrada) => void;
}) {
  const panel = usePanel();
  const puedeProductos = usePuede(Modulo.PRODUCTOS, "crear");
  const puedeCompras = usePuede(Modulo.COMPRAS, "crear");
  const puede = puedeProductos || puedeCompras;
  const idMarcas = useId();

  const [datos, setDatos] = useState<Datos>(VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [existente, setExistente] = useState<ProductoParaAlta | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [sugeridos, setSugeridos] = useState<ProductoParaAlta[]>([]);
  const saborRef = useRef<HTMLInputElement>(null);
  const marcaRef = useRef<HTMLInputElement>(null);

  // Al abrir: formulario limpio y marcas del panel para el autocompletar.
  useEffect(() => {
    if (!abierto) return;
    setDatos(VACIO);
    setErrores({});
    setError(null);
    setExistente(null);
    setBusqueda("");
    setSugeridos([]);
    if (!puede) return;
    void buscarProductosAltaAction("").then((r) => r.ok && setMarcas(r.data.marcas));
    setTimeout(() => marcaRef.current?.focus(), 50);
  }, [abierto, codigo, puede]);

  // Detectar "mismo producto" (marca + modelo + especificación) con debounce.
  const { marca, modelo, especificacion } = datos;
  useEffect(() => {
    if (!abierto || !puede || !marca.trim() || !modelo.trim()) {
      setExistente(null);
      return;
    }
    const t = setTimeout(() => {
      void productoPorClaveAction({ marca, modelo, especificacion }).then((r) => {
        if (r.ok) setExistente(r.data);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [abierto, puede, marca, modelo, especificacion]);

  // Buscar un producto existente para no tipear marca/modelo.
  useEffect(() => {
    const q = busqueda.trim();
    if (!abierto || !puede || q.length < 2) {
      setSugeridos([]);
      return;
    }
    const t = setTimeout(() => {
      void buscarProductosAltaAction(q).then((r) => r.ok && setSugeridos(r.data.productos));
    }, 250);
    return () => clearTimeout(t);
  }, [abierto, puede, busqueda]);

  const set = (campo: keyof Datos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }));

  function elegir(p: ProductoParaAlta) {
    setDatos((d) => ({
      ...d,
      marca: p.marca,
      modelo: p.modelo,
      especificacion: p.especificacion,
      precio: "",
    }));
    setExistente(p);
    setBusqueda("");
    setSugeridos([]);
    setTimeout(() => saborRef.current?.focus(), 0);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo) return;
    setGuardando(true);
    setError(null);
    const precio = aMonto(datos.precio);
    const r = await altaRapidaAction({
      codigoBarras: codigo,
      marca: datos.marca,
      modelo: datos.modelo,
      especificacion: datos.especificacion,
      sabor: datos.sabor,
      ...(existente ? { precioVentaSabor: precio } : { precioVenta: precio }),
    });
    setGuardando(false);
    if (!r.ok) {
      const campos = Object.fromEntries(
        Object.entries(r.error.fields ?? {}).map(([k, v]) => [
          k === "precioVentaSabor" ? "precioVenta" : k,
          v[0] ?? "",
        ]),
      );
      setErrores(campos);
      if (Object.keys(campos).length === 0) setError(r.error.message);
      return;
    }
    onCreada(r.data);
  }

  const labelEspecificacion = panel.etiquetaEspecificacion || "Especificación";

  return (
    <Sheet
      open={abierto}
      onOpenChange={(o) => !o && onCerrar()}
      title="Producto nuevo"
      description={
        codigo ? (
          <>
            El código <span className="text-foreground font-mono">{codigo}</span> no está cargado en{" "}
            {panel.nombre}.
          </>
        ) : undefined
      }
      footer={
        puede ? (
          <>
            <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" form="alta-rapida" loading={guardando}>
              <PackagePlus strokeWidth={1.75} /> Guardar y agregar
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onCerrar}>
            Entendido
          </Button>
        )
      }
    >
      {!puede ? (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-xl px-3 py-2.5 text-sm">
          No tenés permiso para cargar productos. Pedile a alguien con permiso en Productos que lo
          agregue.
        </p>
      ) : (
        <form id="alta-rapida" onSubmit={guardar} className="flex flex-col gap-4" noValidate>
          <div className="relative">
            <Search
              className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="¿Ya existe el producto? Buscalo (ej: elf bc)"
              aria-label="Buscar un producto existente"
              autoComplete="off"
              className={cn(controlClass, "h-11 pl-9")}
            />
            {sugeridos.length > 0 && (
              <ul className="border-border bg-surface absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border p-1 shadow-lg">
                {sugeridos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => elegir(p)}
                      className="hover:bg-surface-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {p.nombreCompleto}
                        </span>
                        <span className="text-muted block truncate text-xs">
                          {p.sabores.length ? p.sabores.join(", ") : "Sin sabores"}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">{formatearPesos(p.precioVenta)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              ref={marcaRef}
              label="Marca"
              required
              list={idMarcas}
              value={datos.marca}
              onChange={set("marca")}
              error={errores.marca}
              placeholder="Ej: Elf Bar"
              autoComplete="off"
              containerClassName="col-span-2"
            />
            <datalist id={idMarcas}>
              {marcas.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Input
              label="Modelo"
              required
              value={datos.modelo}
              onChange={set("modelo")}
              error={errores.modelo}
              placeholder="Ej: BC"
              autoComplete="off"
            />
            <Input
              label={labelEspecificacion}
              value={datos.especificacion}
              onChange={set("especificacion")}
              error={errores.especificacion}
              placeholder="Ej: 5000"
              autoComplete="off"
            />
          </div>

          {existente && (
            <div className="bg-primary-soft text-primary-soft-foreground flex gap-2.5 rounded-xl px-3 py-2.5 text-sm">
              <CircleCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <div>
                <p className="font-medium">
                  Ya existe {existente.nombreCompleto} ({formatearPesos(existente.precioVenta)})
                </p>
                <p>
                  Solo agregá el sabor.
                  {existente.sabores.length > 0 && ` Tiene: ${existente.sabores.join(", ")}.`}
                </p>
              </div>
            </div>
          )}

          <Input
            ref={saborRef}
            label="Sabor"
            value={datos.sabor}
            onChange={set("sabor")}
            error={errores.sabor}
            placeholder="Ej: Mango (vacío si no tiene)"
            autoComplete="off"
          />
          <Input
            label={existente ? "Precio de este sabor (solo si es distinto)" : "Precio de venta"}
            required={!existente}
            inputMode="decimal"
            value={datos.precio}
            onChange={(e) =>
              setDatos((d) => ({ ...d, precio: e.target.value.replace(/[^\d.,]/g, "") }))
            }
            error={errores.precioVenta}
            placeholder={existente ? existente.precioVenta.replace(/\.00$/, "") : "Ej: 10000"}
          />
          {(error || errores.codigoBarras) && (
            <p className="text-danger text-sm" role="alert">
              {errores.codigoBarras ?? error}
            </p>
          )}
        </form>
      )}
    </Sheet>
  );
}
