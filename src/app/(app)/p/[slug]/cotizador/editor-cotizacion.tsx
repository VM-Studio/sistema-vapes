"use client";

import {
  ChevronDown,
  FileText,
  Layers,
  MessageCircle,
  Minus,
  PackageSearch,
  Plus,
  Save,
  Settings2,
  ShoppingCart,
  Table2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VariantePicker } from "@/components/catalogo/variante-picker";
import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { resolverCodigo } from "@/features/scanner/resolver-codigo";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { calcularPrecios } from "@/server/services/precio.service";
import type { ProductoMasVendido } from "@/server/services/venta.service";

import {
  calcularPreciosAction,
  guardarCotizacionAction,
  masVendidosCotizadorAction,
  pdfCotizacionAction,
  whatsappCotizacionAction,
} from "./actions";
import { abrirEnPestana } from "./compartir";
import { TablaPreciosSheet } from "./tabla-precios-sheet";

type Calculo = Awaited<ReturnType<typeof calcularPrecios>>;
type ItemCalculado = Calculo["items"][number];
export type TipoCotizacionUI = "UNITARIA" | "MAYORISTA";

/** Un renglón tal como lo arma el vendedor (los precios los pone el servidor). */
export interface ItemEditor {
  varianteId: string;
  productoId: string;
  titulo: string;
  cantidad: number;
  /** Solo con "editar" en COTIZADOR. */
  precioManual: string | null;
}

export interface CotizacionInicial {
  id: string;
  codigo: string;
  items: ItemEditor[];
  cliente: ClienteElegido | null;
  descuento: string;
  notas: string;
  validezDias: number;
}

export const ID_BUSCADOR_COTIZADOR = "buscar-producto-cotizador";

const aCentavos = (m: string | number) => Math.round(Number(m) * 100);
const deCentavos = (c: number) => (c / 100).toFixed(2);

/** "10.000" / "10000,50" / "10000.5" → "10000.50"; null si no es un monto válido. */
function montoTipeado(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  const normal = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, "")
      : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Number(normal).toFixed(2);
}

const clienteParaGuardar = (c: ClienteElegido | null) =>
  c === null
    ? null
    : c.tipo === "existente"
      ? { id: c.id }
      : { nombre: c.nombre, telefono: c.telefono };

/**
 * Armado de una cotización en UNA pantalla (sin pasos): cliente opcional y
 * validez, ítems (pistola, cámara, buscador o más vendidos), descuento y
 * notas, y un pie fijo con el total y Guardar / WhatsApp / PDF / Convertir.
 * Cada acción guarda antes. En mayorista cada fila muestra el escalón que
 * aplica y cuánto falta para el siguiente.
 */
export function EditorCotizacion({
  tipo,
  inicial,
  validezDefault,
  modoEscalon,
  mostrarStock,
  puedeEditar,
  esOwner,
  puedeVender,
}: {
  tipo: TipoCotizacionUI;
  mostrarStock: boolean;
  inicial: CotizacionInicial | null;
  validezDefault: number;
  modoEscalon: "POR_PRODUCTO" | "POR_TOTAL";
  puedeEditar: boolean;
  esOwner: boolean;
  puedeVender: boolean;
}) {
  const panel = usePanel();
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const feedback = useScanFeedback();
  const mayorista = tipo === "MAYORISTA";

  const [guardada, setGuardada] = useState<{ id: string; codigo: string } | null>(
    inicial ? { id: inicial.id, codigo: inicial.codigo } : null,
  );
  const [items, setItems] = useState<ItemEditor[]>(inicial?.items ?? []);
  const [cliente, setCliente] = useState<ClienteElegido | null>(inicial?.cliente ?? null);
  const [verCliente, setVerCliente] = useState(false);
  const [validez, setValidez] = useState(inicial?.validezDias ?? validezDefault);
  const [descuento, setDescuento] = useState(inicial?.descuento ?? "");
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [calculo, setCalculo] = useState<Calculo | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [errorCalculo, setErrorCalculo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "guardar" | "whatsapp" | "pdf" | "convertir">(null);
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tablaDe, setTablaDe] = useState<string | null>(null);
  const [enfocar, setEnfocar] = useState<string | null>(null);
  const [masVendidos, setMasVendidos] = useState<ProductoMasVendido[] | null>(null);
  const clave = useRef(0);
  const pedido = useRef(0);

  useEffect(() => {
    void masVendidosCotizadorAction().then((r) => setMasVendidos(r.ok ? r.data : []));
  }, []);

  // --- Precios: siempre del servidor, recalculados en cada cambio -----------------
  const firma = JSON.stringify(
    items.map((i) => [i.varianteId, i.cantidad, puedeEditar ? i.precioManual : null]),
  );
  useEffect(() => {
    const n = ++pedido.current;
    if (items.length === 0) {
      setCalculo(null);
      setCalculando(false);
      return;
    }
    setCalculando(true);
    const t = setTimeout(() => {
      void calcularPreciosAction({
        tipo,
        items: items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          ...(puedeEditar && i.precioManual ? { precioManual: i.precioManual } : {}),
        })),
      })
        .catch(() => null)
        .then((r) => {
          if (n !== pedido.current) return;
          setCalculando(false);
          if (!r) return setErrorCalculo("Sin conexión: no se pudieron actualizar los precios.");
          if (!r.ok) return setErrorCalculo(r.error.message);
          setErrorCalculo(null);
          setCalculo(r.data);
        });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume los ítems
  }, [firma, tipo, puedeEditar]);

  const porVariante = useMemo(
    () => new Map((calculo?.items ?? []).map((c) => [c.varianteId, c])),
    [calculo],
  );
  const subtotal = calculo ? aCentavos(calculo.subtotal) : 0;
  const descuentoValido =
    !puedeEditar || descuento.trim() === "" || montoTipeado(descuento) !== null;
  const descuentoCent = puedeEditar
    ? Math.min(aCentavos(montoTipeado(descuento) ?? 0), subtotal)
    : 0;
  const total = deCentavos(subtotal - descuentoCent);
  const unidades = items.reduce((a, i) => a + i.cantidad, 0);

  // --- Ítems -------------------------------------------------------------------------
  const agregar = useCallback(
    (v: { varianteId: string; productoId: string; titulo: string; activo?: boolean }) => {
      if (v.activo === false) {
        const texto = `${v.titulo} está inactivo`;
        feedback.error(texto);
        setMensaje({ tipo: "error", texto, clave: ++clave.current });
        return;
      }
      feedback.ok();
      setAviso(null);
      setMensaje({ tipo: "ok", texto: v.titulo, clave: ++clave.current });
      setItems((prev) => {
        const existe = prev.find((i) => i.varianteId === v.varianteId);
        if (existe) {
          return mayorista
            ? prev
            : prev.map((i) =>
                i.varianteId === v.varianteId ? { ...i, cantidad: i.cantidad + 1 } : i,
              );
        }
        return [
          ...prev,
          {
            varianteId: v.varianteId,
            productoId: v.productoId,
            titulo: v.titulo,
            cantidad: 1,
            precioManual: null,
          },
        ];
      });
      if (mayorista) setEnfocar(v.varianteId);
    },
    [feedback, mayorista],
  );

  const procesar = useCallback(
    async (codigo: string) => {
      const r = await resolverCodigo(panel.id, codigo);
      if (!r.ok) {
        feedback.error("No se pudo buscar el código", r.error.message);
        return;
      }
      if (r.data.encontrado) {
        agregar(r.data.variante);
        return;
      }
      feedback.error();
      setMensaje({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++clave.current,
      });
      setAviso(`El código ${r.data.codigo} no está cargado en ${panel.nombre}.`);
    },
    [agregar, feedback, panel.id, panel.nombre],
  );

  useBarcodeScanner({
    onScan: (c) => void procesar(c),
    enabled: !camara && tablaDe === null && ocupado === null,
  });

  const cambiarItem = (varianteId: string, cambio: Partial<ItemEditor>) =>
    setItems((prev) => prev.map((i) => (i.varianteId === varianteId ? { ...i, ...cambio } : i)));
  const quitar = (varianteId: string) =>
    setItems((prev) => prev.filter((i) => i.varianteId !== varianteId));

  // --- Guardar (implícito antes de cada acción) ------------------------------------
  async function guardar(): Promise<{ id: string; codigo: string } | null> {
    if (items.length === 0) {
      toast.error("Agregá al menos un producto");
      return null;
    }
    if (!descuentoValido) {
      toast.error("Revisá el descuento");
      return null;
    }
    const desc = puedeEditar ? montoTipeado(descuento) : null;
    const r = await guardarCotizacionAction({
      ...(guardada ? { id: guardada.id } : {}),
      tipo,
      items: items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        ...(puedeEditar && i.precioManual ? { precioManual: i.precioManual } : {}),
      })),
      cliente: clienteParaGuardar(cliente),
      ...(desc && Number(desc) > 0 ? { descuento: desc } : {}),
      notas: notas.trim() || undefined,
      validezDias: validez,
    }).catch(() => null);
    if (!r) {
      toast.error("Sin conexión", "La cotización no se guardó: probá de nuevo.");
      return null;
    }
    if (!r.ok) {
      toast.error("No se pudo guardar", r.error.message);
      return null;
    }
    if (!guardada) {
      // Queda en la URL de edición sin recargar (lo armado sigue en pantalla).
      window.history.replaceState(null, "", ruta(`/cotizador/${r.data.id}/editar`));
    }
    setGuardada(r.data);
    return r.data;
  }

  async function accion(tipoAccion: "guardar" | "whatsapp" | "pdf" | "convertir") {
    setOcupado(tipoAccion);
    try {
      if (tipoAccion === "whatsapp" || tipoAccion === "pdf") {
        let codigo = "";
        const error = await abrirEnPestana(async () => {
          const g = await guardar();
          if (!g) return null;
          codigo = g.codigo;
          return tipoAccion === "pdf"
            ? pdfCotizacionAction({ id: g.id })
            : whatsappCotizacionAction({ id: g.id });
        });
        if (error && codigo) toast.error("No se pudo abrir", error);
        return;
      }
      const g = await guardar();
      if (!g) return;
      if (tipoAccion === "guardar") {
        toast.success("Cotización guardada", g.codigo);
        router.refresh();
      } else {
        router.push(ruta(`/ventas?nueva=1&cotizacion=${g.id}`));
      }
    } finally {
      setOcupado(null);
    }
  }

  const yaAgregadas = new Set(items.map((i) => i.varianteId));

  const resumen = mayorista && calculo && calculo.resumenEscalones.length > 0 && (
    <ResumenEscalones calculo={calculo} onTabla={(productoId) => setTablaDe(productoId)} />
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Cabecera --------------------------------------------------------------- */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mayorista ? "Cotización por mayor" : "Cotización por unidad"}
          </h1>
          {guardada && (
            <Badge variant="primary" data-testid="codigo-cotizacion">
              {guardada.codigo}
            </Badge>
          )}
        </div>
        {mayorista && (
          <p
            className="bg-surface-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-3 py-2 text-sm"
            data-testid="modo-escalon"
          >
            <Layers className="text-primary size-4" strokeWidth={1.75} aria-hidden />
            <span>
              Escalón{" "}
              <strong>
                {modoEscalon === "POR_PRODUCTO"
                  ? "por producto (suman todos los sabores del producto)"
                  : "por total de unidades de la cotización"}
              </strong>
            </span>
            {esOwner && (
              <Link
                href={ruta("/cotizador/configuracion")}
                className="text-primary inline-flex items-center gap-1 hover:underline"
              >
                <Settings2 className="size-3.5" strokeWidth={1.75} aria-hidden /> Configurar
              </Link>
            )}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
          <section
            aria-label="Cliente"
            className="border-border bg-surface flex flex-col gap-3 rounded-card border p-4"
          >
            {cliente || verCliente ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Cliente (opcional)</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCliente(null);
                      setVerCliente(false);
                    }}
                  >
                    <X strokeWidth={1.75} /> Sin cliente
                  </Button>
                </div>
                <SelectorCliente valor={cliente} onCambiar={setCliente} permitirNuevo />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setVerCliente(true)}
                className="text-muted hover:text-foreground flex min-h-11 items-center gap-2 text-left text-sm"
              >
                <UserRound className="size-5" strokeWidth={1.75} aria-hidden />
                Sin cliente. <span className="text-primary font-medium">Agregar cliente</span>
              </button>
            )}
          </section>
          <Input
            label="Validez (días)"
            inputMode="numeric"
            value={String(validez)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, "").slice(0, 3));
              setValidez(Math.max(1, n || 1));
            }}
            containerClassName="self-start"
          />
        </div>
      </header>

      <div className={cn("grid gap-5", mayorista && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <div className="flex min-w-0 flex-col gap-5">
          {/* Buscador + cámara --------------------------------------------------- */}
          <div className="flex gap-2">
            <VariantePicker
              id={ID_BUSCADOR_COTIZADOR}
              className="flex-1"
              yaAgregadas={yaAgregadas}
              placeholder="Escaneá o buscá producto, sabor o código"
              onSelect={(v: VarianteEncontrada) => agregar(v)}
            />
            <BotonCamara
              onClick={() => {
                feedback.prepararAudio();
                setCamara(true);
              }}
            />
          </div>
          {aviso && (
            <p
              role="alert"
              className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm"
            >
              {aviso}
            </p>
          )}
          {errorCalculo && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground rounded-control px-4 py-3 text-sm"
            >
              {errorCalculo}
            </p>
          )}

          {/* Ítems ---------------------------------------------------------------- */}
          {items.length === 0 ? (
            <div className="border-border text-muted flex flex-col items-center gap-2 rounded-card border border-dashed px-4 py-8 text-center text-sm">
              <PackageSearch className="size-8" strokeWidth={1.75} aria-hidden />
              <p>
                Escaneá con la pistola o la cámara, buscá arriba o tocá uno de los más vendidos.
              </p>
            </div>
          ) : (
            <ul aria-label="Productos de la cotización" className="flex flex-col gap-2">
              {items.map((i) => (
                <FilaCotizacion
                  key={i.varianteId}
                  item={i}
                  calculado={porVariante.get(i.varianteId)}
                  mayorista={mayorista}
                  mostrarStock={mostrarStock}
                  puedeEditar={puedeEditar}
                  enfocar={enfocar === i.varianteId}
                  onEnfocado={() => setEnfocar(null)}
                  onCantidad={(cantidad) => cambiarItem(i.varianteId, { cantidad })}
                  onPrecio={(precioManual) => cambiarItem(i.varianteId, { precioManual })}
                  onQuitar={() => quitar(i.varianteId)}
                  onTabla={() => setTablaDe(i.productoId)}
                />
              ))}
            </ul>
          )}

          {/* Más vendidos --------------------------------------------------------- */}
          <section aria-labelledby="mas-vendidos-cot" className="flex flex-col gap-2">
            <h2 id="mas-vendidos-cot" className="text-muted text-sm font-medium">
              Más vendidos
            </h2>
            {masVendidos === null ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, n) => (
                  <div key={n} className="bg-surface-2 h-16 animate-pulse rounded-card" />
                ))}
              </div>
            ) : masVendidos.length === 0 ? (
              <p className="text-muted text-sm">Todavía no hay ventas para sugerir.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {masVendidos.map((p) => (
                  <li key={p.varianteId}>
                    <button
                      type="button"
                      onClick={() => agregar(p)}
                      className="border-border bg-surface hover:border-primary hover:bg-primary-soft flex min-h-16 w-full flex-col justify-between gap-1 rounded-card border p-3 text-left transition-colors"
                    >
                      <span className="line-clamp-2 text-sm leading-snug font-medium">
                        {p.nombreCompleto}
                        {p.sabor && <span className="text-muted block">{p.sabor}</span>}
                      </span>
                      <span className="text-xs font-semibold tabular-nums">
                        {formatearPesos(p.precioVenta)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Descuento y notas ---------------------------------------------------- */}
          <div className={cn("grid gap-3", puedeEditar && "md:grid-cols-[14rem_minmax(0,1fr)]")}>
            {puedeEditar && (
              <Input
                label="Descuento ($)"
                inputMode="decimal"
                placeholder="0"
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
                error={descuentoValido ? undefined : "Monto inválido"}
                className="tabular-nums"
                containerClassName="self-start"
              />
            )}
            <Textarea
              label="Notas (opcional)"
              rows={2}
              maxLength={2000}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        {mayorista && (
          <>
            <aside className="hidden lg:block">
              <div className="sticky top-20">{resumen}</div>
            </aside>
            {resumen && (
              <details className="border-border bg-surface group rounded-card border lg:hidden">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-medium">
                  Resumen de escalones
                  <ChevronDown
                    className="size-4 transition-transform group-open:rotate-180"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </summary>
                <div className="px-2 pb-2">{resumen}</div>
              </details>
            )}
          </>
        )}
      </div>

      {/* Pie fijo ----------------------------------------------------------------- */}
      <footer className="border-border bg-surface/95 shadow-sheet sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 rounded-card border px-4 py-3 backdrop-blur md:bottom-4 md:mx-0">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 md:justify-start">
            <p className="text-muted text-sm">
              {unidades} {unidades === 1 ? "unidad" : "unidades"}
              {descuentoCent > 0 && <> · desc. −{formatearPesos(deCentavos(descuentoCent))}</>}
            </p>
            <p
              className={cn(
                "text-3xl font-bold tracking-tight tabular-nums",
                calculando && "opacity-60",
              )}
              data-testid="total-cotizacion"
            >
              {formatearPesos(total)}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 md:flex">
            <Button
              variant="secondary"
              onClick={() => void accion("guardar")}
              loading={ocupado === "guardar"}
              disabled={ocupado !== null || items.length === 0}
              aria-label="Guardar"
            >
              <Save strokeWidth={1.75} />
              <span className="hidden sm:inline">Guardar</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => void accion("whatsapp")}
              loading={ocupado === "whatsapp"}
              disabled={ocupado !== null || items.length === 0}
              aria-label="WhatsApp"
            >
              <MessageCircle strokeWidth={1.75} />
              <span className="hidden sm:inline">WhatsApp</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => void accion("pdf")}
              loading={ocupado === "pdf"}
              disabled={ocupado !== null || items.length === 0}
              aria-label="PDF"
            >
              <FileText strokeWidth={1.75} />
              <span className="hidden sm:inline">PDF</span>
            </Button>
            {puedeVender && (
              <Button
                onClick={() => void accion("convertir")}
                loading={ocupado === "convertir"}
                disabled={ocupado !== null || items.length === 0}
                aria-label="Convertir en venta"
              >
                <ShoppingCart strokeWidth={1.75} />
                <span className="hidden sm:inline">Convertir en venta</span>
              </Button>
            )}
          </div>
        </div>
      </footer>

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c) => void procesar(c)}
        mensaje={mensaje}
        permitirRafaga
        titulo="Agregar a la cotización"
      />
      <TablaPreciosSheet productoId={tablaDe} onCerrar={() => setTablaDe(null)} />
    </div>
  );
}

function FilaCotizacion({
  item,
  calculado,
  mayorista,
  mostrarStock,
  puedeEditar,
  enfocar,
  onEnfocado,
  onCantidad,
  onPrecio,
  onQuitar,
  onTabla,
}: {
  item: ItemEditor;
  calculado: ItemCalculado | undefined;
  mayorista: boolean;
  mostrarStock: boolean;
  puedeEditar: boolean;
  enfocar: boolean;
  onEnfocado: () => void;
  onCantidad: (n: number) => void;
  onPrecio: (p: string | null) => void;
  onQuitar: () => void;
  onTabla: () => void;
}) {
  const cantidadRef = useRef<HTMLInputElement>(null);
  const [precioTexto, setPrecioTexto] = useState(
    item.precioManual ? String(Number(item.precioManual)) : "",
  );
  useEffect(() => {
    if (!enfocar) return;
    cantidadRef.current?.focus();
    cantidadRef.current?.select();
    onEnfocado();
  }, [enfocar, onEnfocado]);

  const c = calculado;
  const conEscalon = c && c.escalonAplicado !== null && !c.esPrecioManual;
  const sinStock = c ? c.stockTotal < item.cantidad : false;
  const precioInvalido = precioTexto.trim() !== "" && montoTipeado(precioTexto) === null;

  return (
    <li
      data-testid="fila-cotizacion"
      className="border-border bg-surface flex flex-col gap-3 rounded-card border p-3 md:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{item.titulo}</p>
          <p className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {c ? (
              <>
                {mostrarStock && <span>Stock total: {c.stockTotal}</span>}
                {sinStock && (
                  <Badge variant="warning" title="Se puede cotizar igual">
                    Sin stock
                  </Badge>
                )}
              </>
            ) : (
              <span>Calculando…</span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-danger -mt-1 -mr-1 shrink-0"
          aria-label={`Quitar ${item.titulo}`}
          onClick={onQuitar}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {mayorista ? (
          <label className="flex flex-col gap-1 text-xs font-medium">
            Cantidad
            <input
              ref={cantidadRef}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label={`Cantidad de ${item.titulo}`}
              className={cn(
                controlClass,
                "h-14 w-28 text-center text-2xl font-semibold tabular-nums",
              )}
              value={String(item.cantidad)}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, "").slice(0, 5));
                onCantidad(Math.max(1, n || 1));
              }}
            />
          </label>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              aria-label={`Restar uno de ${item.titulo}`}
              disabled={item.cantidad <= 1}
              onClick={() => onCantidad(item.cantidad - 1)}
            >
              <Minus strokeWidth={1.75} />
            </Button>
            <CantidadInput
              etiqueta={`Cantidad de ${item.titulo}`}
              valor={item.cantidad}
              onCambio={onCantidad}
              className="w-16"
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label={`Sumar uno de ${item.titulo}`}
              onClick={() => onCantidad(item.cantidad + 1)}
            >
              <Plus strokeWidth={1.75} />
            </Button>
          </div>
        )}

        <div className="flex flex-col items-end gap-0.5 text-right tabular-nums">
          {c ? (
            <>
              <p className="text-sm">
                {conEscalon || c.esPrecioManual ? (
                  <>
                    <s className="text-muted" data-testid="precio-lista">
                      {formatearPesos(c.precioLista)}
                    </s>{" "}
                    <span
                      className="text-primary text-base font-semibold"
                      data-testid="precio-unitario"
                    >
                      {formatearPesos(c.precioUnitario)}
                    </span>
                  </>
                ) : (
                  <span data-testid="precio-unitario">{formatearPesos(c.precioUnitario)}</span>
                )}{" "}
                <span className="text-muted text-xs">c/u</span>
              </p>
              <p className="text-lg font-semibold" data-testid="subtotal-fila">
                {formatearPesos(c.subtotal)}
              </p>
            </>
          ) : (
            <p className="bg-surface-2 h-10 w-28 animate-pulse rounded-control" />
          )}
        </div>
      </div>

      {mayorista && c && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {conEscalon && (
            <Badge variant="primary" data-testid="chip-escalon">
              Escalón desde {c.escalonAplicado} u.
            </Badge>
          )}
          {c.proximoEscalon && !c.esPrecioManual && (
            <span className="text-success font-medium" data-testid="hint-escalon">
              Agregá {c.proximoEscalon.faltan} más y baja a{" "}
              {formatearPesos(c.proximoEscalon.precioUnitario)} c/u
            </span>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onTabla}>
            <Table2 strokeWidth={1.75} /> Ver tabla de precios
          </Button>
        </div>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Precio manual (c/u)"
            inputMode="decimal"
            placeholder={c ? String(Number(c.precioLista)) : ""}
            value={precioTexto}
            onChange={(e) => setPrecioTexto(e.target.value)}
            onBlur={() => onPrecio(precioInvalido ? item.precioManual : montoTipeado(precioTexto))}
            error={precioInvalido ? "Precio inválido" : undefined}
            containerClassName="w-44"
            className="tabular-nums"
          />
          {item.precioManual && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPrecioTexto("");
                onPrecio(null);
              }}
            >
              Volver al precio calculado
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function ResumenEscalones({
  calculo,
  onTabla,
}: {
  calculo: Calculo;
  onTabla: (productoId: string) => void;
}) {
  return (
    <section
      aria-labelledby="resumen-escalones"
      className="lg:border-border lg:bg-surface flex flex-col gap-3 lg:rounded-card lg:border lg:p-4"
      data-testid="resumen-escalones"
    >
      <h2 id="resumen-escalones" className="hidden font-semibold lg:block">
        Resumen de escalones
      </h2>
      <ul className="divide-border flex flex-col divide-y text-sm">
        {calculo.resumenEscalones.map((r) => (
          <li key={r.productoId} className="flex flex-col gap-1 py-2">
            <span className="font-medium">{r.nombreCompleto}</span>
            <span className="flex items-center justify-between gap-2 tabular-nums">
              <span className="text-muted">
                {r.unidades} u. ·{" "}
                {r.escalonAplicado !== null ? `escalón ${r.escalonAplicado}+` : "precio de lista"}
              </span>
              <span className="font-semibold">{formatearPesos(r.precioUnitario)} c/u</span>
            </span>
            <button
              type="button"
              onClick={() => onTabla(r.productoId)}
              className="text-primary self-start text-xs hover:underline"
            >
              Ver tabla de precios
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
