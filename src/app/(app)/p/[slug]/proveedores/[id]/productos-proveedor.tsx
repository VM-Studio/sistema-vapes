"use client";

import { Check, Package, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { BuscadorRemoto } from "@/components/compras/buscador-remoto";
import { usePanel } from "@/components/layout/panel-context";
import { EquivalenteUsdt } from "@/components/compras/equivalente-usdt";
import type { CotizacionVigente } from "@/lib/cambio";
import { formatearMonto } from "@/lib/format";
import { soloDecimal } from "@/components/compras/proveedor-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFecha } from "@/lib/utils";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { resolverCodigo } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import type { ProductoDeProveedorDTO } from "@/server/services/proveedor.service";

import {
  asignarProductoAction,
  buscarProductosProveedorAction,
  quitarProductoAction,
} from "../actions";

type Moneda = "ARS" | "USDT";

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
  moneda: p.moneda ?? "USDT",
  actualizadoAt: p.actualizadoAt,
  guardado:
    p.precio === null ? null : { precio: String(Number(p.precio)), moneda: p.moneda ?? "USDT" },
});

/**
 * Productos que vende el proveedor. Con precios visibles y permiso de
 * edición: tabla editable inline (guardar fija actualizadoAt = ahora),
 * agregar y quitar. Sin precios: solo la lista de productos. Los precios en
 * USDT muestran al lado, en gris y en vivo, su equivalente en pesos con la
 * cotización USDT vigente (`cotizacionUsdt`, la manda el servidor).
 *
 * Vincular escaneando: con permiso de edición, la pistola (lector tipo
 * teclado que termina en Enter, con o sin foco en «Escanear código») o la
 * cámara buscan el código de barras del sabor o un código alternativo en el
 * panel y preseleccionan su PRODUCTO (el precio del proveedor es por
 * producto): si ya está vinculado, lleva el foco a su precio para editarlo;
 * si no, agrega la fila y el foco va al precio. Se puede escanear varios
 * seguidos (la ráfaga de la pistola no ensucia el precio con foco: ver
 * capturador). La carga manual (buscador) sigue igual.
 */
export function ProductosProveedor({
  proveedorId,
  productos,
  verPrecios,
  puedeEditar,
  cotizacionUsdt,
}: {
  proveedorId: string;
  productos: ProductoDeProveedorDTO[];
  verPrecios: boolean;
  puedeEditar: boolean;
  cotizacionUsdt: CotizacionVigente | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filas, setFilas] = useState<Fila[]>(() => productos.map(aFila));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardandoTodos, setGuardandoTodos] = useState(false);
  const [filtro, setFiltro] = useState("");
  /** Fila recién agregada: su precio toma el foco. */
  const [agregado, setAgregado] = useState<string | null>(null);
  const editable = verPrecios && puedeEditar;
  const panel = usePanel();
  const feedback = useScanFeedback();
  const [camara, setCamara] = useState(false);
  const [mensajeCamara, setMensajeCamara] = useState<MensajeCamara | null>(null);
  const claveMensaje = useRef(0);
  const scanRef = useRef<HTMLInputElement>(null);
  /** Resultado del último escaneo (aria-live) y fila resaltada. */
  const [escaneo, setEscaneo] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [resaltado, setResaltado] = useState<string | null>(null);
  const filasRef = useRef(filas);
  filasRef.current = filas;

  /** Escaneo (pistola, cámara o tipeado): preselecciona el producto y pasa el foco al precio. */
  async function procesarCodigo(codigo: string) {
    const r = await resolverCodigo(panel.id, codigo);
    if (!r.ok) {
      feedback.error("No se pudo buscar el código", r.error.message);
      setEscaneo({ tipo: "error", texto: r.error.message });
      return;
    }
    if (!r.data.encontrado) {
      feedback.error();
      const texto = `No hay ningún producto con el código ${r.data.codigo} en este panel. Cargalo en Productos o buscalo a mano abajo.`;
      setEscaneo({ tipo: "error", texto });
      setMensajeCamara({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++claveMensaje.current,
      });
      return;
    }
    const v = r.data.variante;
    const yaEsta = filasRef.current.some((f) => f.productoId === v.productoId);
    feedback.ok();
    setCamara(false);
    setFiltro("");
    setEscaneo({
      tipo: "ok",
      texto: yaEsta
        ? `${v.nombreCompleto}: ya está vinculado, editá su precio.`
        : `${v.nombreCompleto}: agregado, cargá el precio y Enter para guardar.`,
    });
    if (!yaEsta)
      setFilas((fs) =>
        fs.some((f) => f.productoId === v.productoId)
          ? fs
          : [
              ...fs,
              {
                productoId: v.productoId,
                nombreCompleto: v.nombreCompleto,
                precio: "",
                moneda: "USDT",
                actualizadoAt: null,
                guardado: null,
              },
            ],
      );
    setAgregado(v.productoId);
    setResaltado(v.productoId);
  }

  useBarcodeScanner({
    onScan: (c) => void procesarCodigo(c),
    enabled: editable && !camara,
  });

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

  const cambiada = (f: Fila) =>
    f.precio !== "" &&
    (f.guardado === null ||
      f.guardado.precio !== String(Number(f.precio.replace(",", "."))) ||
      f.guardado.moneda !== f.moneda);

  /** Guarda una fila; devuelve si salió bien (el error queda en la fila). */
  async function guardarFila(f: Fila): Promise<boolean> {
    setErrores((e) => ({ ...e, [f.productoId]: "" }));
    const r = await asignarProductoAction({
      proveedorId,
      productoId: f.productoId,
      precio: f.precio.replace(",", "."),
      moneda: f.moneda,
    });
    if (!r.ok) {
      const msj = r.error.fields?.precio?.[0] ?? r.error.message;
      setErrores((e) => ({ ...e, [f.productoId]: msj }));
      return false;
    }
    return true;
  }

  async function guardar(f: Fila) {
    setGuardando(f.productoId);
    const ok = await guardarFila(f);
    setGuardando(null);
    if (!ok) return;
    toast.success("Precio guardado", f.nombreCompleto);
    // Listo para escanear el siguiente.
    scanRef.current?.focus();
    router.refresh();
  }

  /** "Guardar todos": los precios cambiados o nuevos, uno por uno (cada uno con su fecha). */
  async function guardarTodos() {
    const pendientes = filas.filter(cambiada);
    setGuardandoTodos(true);
    let ok = 0;
    for (const f of pendientes) if (await guardarFila(f)) ok++;
    setGuardandoTodos(false);
    if (ok === pendientes.length) toast.success(`${ok} precio(s) guardado(s)`);
    else toast.error(`Se guardaron ${ok} de ${pendientes.length}`, "Revisá los marcados en rojo.");
    router.refresh();
  }

  const pendientes = editable ? filas.filter(cambiada).length : 0;
  const palabras = filtro.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibles = palabras.length
    ? filas.filter(
        (f) =>
          f.guardado === null || palabras.every((w) => f.nombreCompleto.toLowerCase().includes(w)),
      )
    : filas;

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
      {editable && (
        <div className="flex flex-col gap-2">
          <ScanInput
            onScan={(c) => void procesarCodigo(c)}
            onAbrirCamara={() => {
              feedback.prepararAudio();
              setMensajeCamara(null);
              setCamara(true);
            }}
            placeholder="Escanear código para vincular (pistola o tipeado + Enter)"
            autoFocus
            inputRef={scanRef}
          />
          <p
            aria-live="polite"
            data-testid="resultado-escaneo-proveedor"
            className={cn(
              "text-small min-h-5",
              escaneo?.tipo === "error" ? "text-danger" : "text-muted",
            )}
          >
            {escaneo?.texto ??
              "Escaneá el producto: si ya está vinculado se abre su precio; si no, se agrega."}
          </p>
        </div>
      )}
      {filas.length > 8 && (
        <div className="relative">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            aria-label="Filtrar productos del proveedor"
            placeholder={`Filtrar sus ${filas.length} productos`}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className={cn(controlClass, "h-11 pl-9 md:h-10")}
          />
        </div>
      )}
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
            {visibles.length === 0 && (
              <li className="text-muted px-4 py-3 text-sm">
                Ningún producto coincide con «{filtro.trim()}».
              </li>
            )}
            {visibles.map((f) => {
              const cambio =
                f.guardado === null ||
                f.guardado.precio !== String(Number(f.precio.replace(",", "."))) ||
                f.guardado.moneda !== f.moneda;
              return (
                <li
                  key={f.productoId}
                  data-resaltado={resaltado === f.productoId ? "" : undefined}
                  className={cn(
                    "grid items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors",
                    resaltado === f.productoId && "bg-card",
                    editable
                      ? "grid-cols-[minmax(0,1fr)_5.5rem_auto]"
                      : "grid-cols-[minmax(0,1fr)_auto_auto]",
                    columnasDesktop,
                  )}
                >
                  <div className={cn("min-w-0", editable && "col-span-2 md:col-span-1")}>
                    <p className="font-medium">{f.nombreCompleto}</p>
                    {verPrecios && (
                      <p className="text-subtle flex flex-wrap items-center gap-x-1.5 text-xs">
                        <span>
                          {f.actualizadoAt
                            ? `Actualizado ${formatearFecha(f.actualizadoAt)}`
                            : "Sin guardar"}
                        </span>
                        {editable && f.moneda === "USDT" && f.precio !== "" && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">
                              {formatearMonto(f.precio.replace(",", "."), "USDT")}
                            </span>
                            <EquivalenteUsdt monto={f.precio} cotizacion={cotizacionUsdt} />
                          </>
                        )}
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && cambiada(f)) {
                            e.preventDefault();
                            void guardar(f);
                          }
                        }}
                        ref={(el) => {
                          if (el && agregado === f.productoId) {
                            el.focus();
                            setAgregado(null);
                          }
                        }}
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
                        <option value="USDT">USDT</option>
                        <option value="ARS">ARS</option>
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
                      <span className="flex flex-col items-end">
                        <span className="text-right font-semibold tabular-nums">
                          {formatearMonto(f.guardado?.precio, f.guardado?.moneda)}
                        </span>
                        {f.guardado?.moneda === "USDT" && (
                          <EquivalenteUsdt monto={f.guardado.precio} cotizacion={cotizacionUsdt} />
                        )}
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
      {editable && pendientes > 1 && (
        <Button
          className="self-end max-md:w-full"
          loading={guardandoTodos}
          disabled={guardando !== null}
          onClick={() => void guardarTodos()}
        >
          <Check strokeWidth={1.75} /> Guardar los {pendientes} precios
        </Button>
      )}
      {editable && (
        <BuscadorRemoto
          ariaLabel="Agregar producto que vende"
          placeholder="Agregar producto (marca, modelo…)"
          buscar={(q) => buscarProductosProveedorAction({ q })}
          getKey={(p) => p.id}
          render={(p) => <span className="truncate">{p.nombreCompleto}</span>}
          onSelect={(p) => {
            setAgregado(p.id);
            setResaltado(p.id);
            setFilas((fs) =>
              fs.some((f) => f.productoId === p.id)
                ? fs
                : [
                    ...fs,
                    {
                      productoId: p.id,
                      nombreCompleto: p.nombreCompleto,
                      precio: "",
                      moneda: "USDT",
                      actualizadoAt: null,
                      guardado: null,
                    },
                  ],
            );
          }}
        />
      )}
      {editable && (
        <CameraScanner
          open={camara}
          onOpenChange={setCamara}
          onDetect={(c) => void procesarCodigo(c)}
          mensaje={mensajeCamara}
          titulo="Escanear producto para vincular"
        />
      )}
    </SectionCard>
  );
}
