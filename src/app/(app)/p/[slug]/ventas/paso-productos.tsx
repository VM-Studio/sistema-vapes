"use client";

import {
  CircleCheck,
  Minus,
  PackageSearch,
  Plus,
  ScanBarcode,
  ScanLine,
  Tag,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { usePanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import type { FuenteEscaneo } from "@/features/scanner/config";
import { invalidarResoluciones, resolverCodigo } from "@/features/scanner/resolver-codigo";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  faltanVerificar,
  listaDeItems,
  verificarEscaneo,
  type Verificadas,
} from "@/lib/verificacion-escaneo";
import type { ProductoMasVendido } from "@/server/services/venta.service";

import { masVendidosAction } from "./actions";
import { aCentavos, deCentavos, montoTipeado, precioCobrado, type ItemVenta } from "./estado-venta";

/** Lo mínimo para sumar un sabor a la venta (escaneo, buscador o grilla). */
export interface SaborParaVenta {
  varianteId: string;
  productoId: string;
  titulo: string;
  precioVenta: string;
  activo?: boolean;
  /** Stock en el galpón elegido, si se conoce. */
  stock?: number;
}

export const ID_BUSCADOR_VENTA = "buscar-producto-venta";

function desdeEncontrada(v: VarianteEncontrada, depositoId: string): SaborParaVenta {
  return {
    varianteId: v.varianteId,
    productoId: v.productoId,
    titulo: v.titulo,
    precioVenta: v.precioVenta,
    activo: v.activo,
    stock:
      v.stockEnDeposito ??
      v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ??
      undefined,
  };
}

/** Lo que se muestra en grande al escanear: identidad completa del vape. */
export interface IdentidadEscaneada {
  varianteId: string;
  /** "Ignite V80 8000" (marca + modelo + especificación/pitadas). */
  producto: string;
  marca: string;
  modelo: string;
  especificacion: string;
  sabor: string | null;
  codigo: string;
}

function identidadDe(v: VarianteEncontrada, codigo: string): IdentidadEscaneada {
  return {
    varianteId: v.varianteId,
    producto: v.nombreCompleto,
    marca: v.marca,
    modelo: v.modelo,
    especificacion: v.especificacion,
    sabor: v.sabor,
    codigo,
  };
}

/** "Ignite V80 8000 — Mango Ice". */
const textoIdentidad = (i: IdentidadEscaneada) =>
  i.sabor ? `${i.producto} — ${i.sabor}` : i.producto;

/** Tiempo que queda en pantalla la identidad de lo escaneado. */
const MS_IDENTIDAD = 2000;

export function PasoProductos({
  deposito,
  items,
  stock,
  puedeEditar,
  puedeAltaProductos,
  escanerActivo,
  bloqueado = false,
  verificar,
  verificadas,
  onVerificar,
  onVerificadas,
  onAgregar,
  onCantidad,
  onQuitar,
  onPrecioEspecial,
  onSubdialogo,
}: {
  deposito: { id: string; nombre: string };
  items: ItemVenta[];
  stock: Record<string, number>;
  puedeEditar: boolean;
  puedeAltaProductos: boolean;
  /** false sin conexión o con otro diálogo encima. */
  escanerActivo: boolean;
  /** Conversión de una cotización: los ítems vienen fijos (solo se verifican). */
  bloqueado?: boolean;
  /** "Verificar con pistola" activo. */
  verificar: boolean;
  verificadas: Verificadas;
  onVerificar: (activo: boolean) => void;
  onVerificadas: (v: Record<string, number>) => void;
  onAgregar: (s: SaborParaVenta) => void;
  onCantidad: (varianteId: string, cantidad: number) => void;
  onQuitar: (varianteId: string) => void;
  onPrecioEspecial: (varianteId: string, precio: string | null) => void;
  /** Avisa si hay un diálogo propio abierto (cámara, alta rápida, precio especial). */
  onSubdialogo: (abierto: boolean) => void;
}) {
  const panel = usePanel();
  const feedback = useScanFeedback();
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [alta, setAlta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [precioDe, setPrecioDe] = useState<ItemVenta | null>(null);
  const [masVendidos, setMasVendidos] = useState<ProductoMasVendido[] | null>(null);
  const [identidad, setIdentidad] = useState<(IdentidadEscaneada & { clave: number }) | null>(null);
  /** (c) Escaneo que no corresponde a la venta: aviso bloqueante. */
  const [ajeno, setAjeno] = useState<{
    identidad: IdentidadEscaneada;
    sabor: SaborParaVenta;
  } | null>(null);
  const clave = useRef(0);
  const modoVerificar = verificar && items.length > 0;
  const puedeAgregar = !bloqueado;

  // La identidad queda 2 s en pantalla; un escaneo nuevo la reemplaza y reinicia el tiempo.
  useEffect(() => {
    if (!identidad) return;
    const t = setTimeout(() => setIdentidad(null), MS_IDENTIDAD);
    return () => clearTimeout(t);
  }, [identidad]);

  const otroDialogo = camara || alta !== null || precioDe !== null;
  const subdialogo = otroDialogo || ajeno !== null;
  useEffect(() => onSubdialogo(subdialogo), [subdialogo, onSubdialogo]);

  useEffect(() => {
    if (bloqueado) return;
    let vigente = true;
    setMasVendidos(null);
    void masVendidosAction({ depositoId: deposito.id }).then((r) => {
      if (vigente) setMasVendidos(r.ok ? r.data : []);
    });
    return () => {
      vigente = false;
    };
  }, [deposito.id, bloqueado]);

  const aceptar = useCallback(
    (s: SaborParaVenta) => {
      if (s.activo === false) {
        const texto = `${s.titulo} está inactivo: no se puede vender`;
        feedback.error(texto);
        setMensaje({ tipo: "error", texto, clave: ++clave.current });
        return;
      }
      feedback.ok();
      setAviso(null);
      setMensaje({
        tipo: "ok",
        texto: s.titulo,
        detalle: s.stock !== undefined ? `Stock en ${deposito.nombre}: ${s.stock}` : undefined,
        clave: ++clave.current,
      });
      onAgregar(s);
    },
    [deposito.nombre, feedback, onAgregar],
  );

  const procesar = useCallback(
    async (codigo: string, fuente: FuenteEscaneo) => {
      // Con el aviso "no corresponde" abierto, la pistola sigue capturando (así su
      // Enter no toca un botón del aviso) pero no hace nada: primero hay que decidir.
      if (ajeno) {
        feedback.error();
        return;
      }
      const r = await resolverCodigo(panel.id, codigo);
      if (!r.ok) {
        feedback.error("No se pudo buscar el código", r.error.message);
        return;
      }
      if (r.data.encontrado) {
        const v = r.data.variante;
        const id = identidadDe(v, codigo);
        setIdentidad({ ...id, clave: ++clave.current });
        if (!modoVerificar) {
          aceptar(desdeEncontrada(v, deposito.id));
          return;
        }
        const res = verificarEscaneo(items, verificadas, v.varianteId);
        if (res.tipo === "ok") {
          feedback.ok();
          setAviso(null);
          onVerificadas(res.verificadas);
          setMensaje({
            tipo: "ok",
            texto: `Verificada ${res.x}/${res.y}`,
            detalle: textoIdentidad(id),
            clave: ++clave.current,
          });
        } else if (res.tipo === "completo") {
          const texto = `Ya verificaste las ${res.y} ${res.y === 1 ? "unidad" : "unidades"} de ${v.sabor ?? v.nombreCompleto}`;
          feedback.error();
          setAviso(texto);
          setMensaje({ tipo: "error", texto, clave: ++clave.current });
        } else {
          feedback.error();
          setCamara(false);
          setAjeno({ identidad: id, sabor: desdeEncontrada(v, deposito.id) });
        }
        return;
      }
      feedback.error();
      setMensaje({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++clave.current,
      });
      if (bloqueado) {
        setAviso(
          `El código ${r.data.codigo} no está cargado en ${panel.nombre}: no corresponde a la cotización.`,
        );
      } else if (puedeAltaProductos) {
        setCamara(false);
        setAlta(r.data.codigo);
      } else {
        setAviso(
          `El código ${r.data.codigo} no está cargado en ${panel.nombre}. Pedile a alguien con permiso de Productos que lo dé de alta.`,
        );
      }
      if (fuente === "manual") document.getElementById(ID_BUSCADOR_VENTA)?.focus();
    },
    [
      aceptar,
      ajeno,
      bloqueado,
      deposito.id,
      feedback,
      items,
      modoVerificar,
      onVerificadas,
      panel.id,
      panel.nombre,
      puedeAltaProductos,
      verificadas,
    ],
  );

  useBarcodeScanner({
    onScan: (c, m) => void procesar(c, m.fuente),
    enabled: escanerActivo && !otroDialogo,
  });

  const yaAgregadas = new Set(items.map((i) => i.varianteId));
  const faltan = faltanVerificar(items, verificadas);

  return (
    <div className="flex flex-col gap-6">
      {identidad && <AvisoIdentidad key={identidad.clave} identidad={identidad} />}
      <section
        aria-label="Escanear o buscar"
        className="bg-card rounded-card flex flex-col gap-3 p-4"
      >
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
          <p className="text-muted text-small flex items-center gap-2">
            <ScanBarcode className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {modoVerificar
              ? "Escaneá cada vape: se compara con lo que tiene la venta."
              : bloqueado
                ? "Los productos vienen de la cotización: escanealos para verificarlos."
                : "Escaneá con la pistola o la cámara, o buscá a mano."}
          </p>
          <Switch
            className="md:shrink-0"
            label="Verificar con pistola"
            checked={modoVerificar}
            disabled={items.length === 0}
            onCheckedChange={onVerificar}
          />
        </div>
        {modoVerificar && (
          <p
            className="bg-surface-3 text-foreground rounded-control flex items-center gap-2 px-3 py-2 text-sm tabular-nums"
            data-testid="resumen-verificacion"
          >
            <ScanLine className="text-muted size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            {faltan === 0
              ? "Todas las unidades verificadas."
              : `Faltan verificar ${faltan} ${faltan === 1 ? "unidad" : "unidades"}.`}
          </p>
        )}
        <div className="flex gap-2">
          {!bloqueado && (
            <VariantePicker
              id={ID_BUSCADOR_VENTA}
              className="flex-1"
              depositoId={deposito.id}
              yaAgregadas={yaAgregadas}
              placeholder="Escaneá o buscá producto, sabor o código (F2)"
              onSelect={(v) => aceptar(desdeEncontrada(v, deposito.id))}
            />
          )}
          <BotonCamara
            onClick={() => {
              feedback.prepararAudio();
              setCamara(true);
            }}
          />
        </div>
      </section>

      {aviso && (
        <p
          role="alert"
          className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm"
        >
          {aviso}
        </p>
      )}

      {items.length === 0 ? (
        <div className="bg-card text-muted rounded-card flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
          <PackageSearch className="text-subtle size-10" strokeWidth={1.25} aria-hidden />
          <p className="max-w-sm">
            Escaneá con la pistola o la cámara, buscá arriba o tocá uno de los más vendidos.
          </p>
        </div>
      ) : (
        <div className="border-border bg-surface rounded-card overflow-hidden border">
          <div
            aria-hidden
            className="border-border bg-card text-muted hidden h-10 items-center gap-4 border-b px-4 text-xs font-medium md:grid md:grid-cols-[minmax(0,1fr)_8.5rem_9rem_6.5rem_2.5rem]"
          >
            <span>Producto</span>
            <span className="text-center">Cantidad</span>
            <span className="text-right">Precio</span>
            <span className="text-right">Subtotal</span>
            <span />
          </div>
          <ul aria-label="Productos de la venta" className="divide-border flex flex-col divide-y">
            {items.map((i) => (
              <FilaItem
                key={i.varianteId}
                item={i}
                stock={stock[i.varianteId]}
                deposito={deposito.nombre}
                puedeEditar={puedeEditar && !bloqueado}
                bloqueado={bloqueado}
                verificadas={
                  modoVerificar ? Math.min(verificadas[i.varianteId] ?? 0, i.cantidad) : null
                }
                onCantidad={(n) => onCantidad(i.varianteId, n)}
                onQuitar={() => onQuitar(i.varianteId)}
                onPrecioEspecial={() => setPrecioDe(i)}
              />
            ))}
          </ul>
        </div>
      )}

      {!bloqueado && (
        <section aria-labelledby="mas-vendidos" className="flex flex-col gap-3">
          <h3 id="mas-vendidos" className="text-h3 font-semibold">
            Más vendidos
          </h3>
          {masVendidos === null ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, n) => (
                <div key={n} className="bg-card rounded-card h-20 animate-pulse" />
              ))}
            </div>
          ) : masVendidos.length === 0 ? (
            <p className="text-muted text-sm">Todavía no hay ventas ni stock para sugerir.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {masVendidos.map((p) => {
                const enVenta = items.find((i) => i.varianteId === p.varianteId)?.cantidad ?? 0;
                const sinStock = p.stock - enVenta <= 0;
                return (
                  <li key={p.varianteId}>
                    <button
                      type="button"
                      onClick={() =>
                        aceptar({
                          varianteId: p.varianteId,
                          productoId: p.productoId,
                          titulo: p.titulo,
                          precioVenta: p.precioVenta,
                          stock: p.stock,
                        })
                      }
                      className={cn(
                        cardVariants({ variant: "clickable" }),
                        "flex min-h-24 w-full flex-col justify-between gap-2 p-3 text-left",
                        sinStock && "opacity-60",
                      )}
                    >
                      <span className="text-sm leading-snug">
                        <span className="line-clamp-2 font-medium">{p.nombreCompleto}</span>
                        {p.sabor && <span className="text-muted block truncate">{p.sabor}</span>}
                      </span>
                      <span className="flex items-baseline justify-between gap-2 tabular-nums">
                        <span className="text-sm font-semibold">
                          {formatearPesos(p.precioVenta)}
                        </span>
                        <span className={cn("text-xs", sinStock ? "text-danger" : "text-subtle")}>
                          {p.stock} en stock
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c, f) => void procesar(c, f)}
        mensaje={mensaje}
        permitirRafaga
        titulo={`Vender desde ${deposito.nombre}`}
      />
      {puedeAltaProductos && (
        <AltaRapidaSheet
          codigo={alta}
          abierto={alta !== null}
          onCerrar={() => setAlta(null)}
          onCreada={(v) => {
            if (alta) invalidarResoluciones(alta);
            setAlta(null);
            aceptar(desdeEncontrada(v, deposito.id));
            // Con "Verificar con pistola", el vape recién dado de alta ya se escaneó.
            if (modoVerificar) onVerificadas({ ...verificadas, [v.varianteId]: 1 });
          }}
        />
      )}
      <AvisoNoCorresponde
        ajeno={ajeno}
        items={items}
        puedeAgregar={puedeAgregar}
        onDescartar={() => {
          feedback.prepararAudio();
          setAjeno(null);
          document.getElementById(ID_BUSCADOR_VENTA)?.focus();
        }}
        onAgregar={() => {
          if (!ajeno) return;
          aceptar(ajeno.sabor);
          // El vape que se escaneó es el que se suma: queda verificado.
          onVerificadas({ ...verificadas, [ajeno.sabor.varianteId]: 1 });
          setAjeno(null);
        }}
      />
      <PrecioEspecialDialog
        item={precioDe}
        onCerrar={() => setPrecioDe(null)}
        onAplicar={(precio) => {
          if (precioDe) onPrecioEspecial(precioDe.varianteId, precio);
          setPrecioDe(null);
        }}
      />
    </div>
  );
}

function FilaItem({
  item,
  stock,
  deposito,
  puedeEditar,
  bloqueado,
  verificadas,
  onCantidad,
  onQuitar,
  onPrecioEspecial,
}: {
  item: ItemVenta;
  stock: number | undefined;
  deposito: string;
  puedeEditar: boolean;
  bloqueado: boolean;
  /** null = sin "Verificar con pistola". */
  verificadas: number | null;
  onCantidad: (n: number) => void;
  onQuitar: () => void;
  onPrecioEspecial: () => void;
}) {
  const sinStock = stock !== undefined && item.cantidad > stock;
  const subtotal = deCentavos(aCentavos(precioCobrado(item)) * item.cantidad);
  const cantidad = bloqueado ? (
    <p className="text-right font-medium tabular-nums md:text-center">
      {item.cantidad} {item.cantidad === 1 ? "unidad" : "unidades"}
    </p>
  ) : (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="icon"
        className="md:size-9"
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
        className="w-14 md:h-9"
      />
      <Button
        variant="secondary"
        size="icon"
        className="md:size-9"
        aria-label={`Sumar uno de ${item.titulo}`}
        onClick={() => onCantidad(item.cantidad + 1)}
      >
        <Plus strokeWidth={1.75} />
      </Button>
    </div>
  );
  return (
    <li
      data-sin-stock={sinStock || undefined}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3",
        "md:grid-cols-[minmax(0,1fr)_8.5rem_9rem_6.5rem_2.5rem] md:gap-x-4",
        sinStock && "bg-danger-soft/40",
      )}
    >
      <div className="min-w-0">
        <p className="leading-snug font-medium">{item.titulo}</p>
        {verificadas !== null && (
          <p
            className={cn(
              "text-xs font-medium tabular-nums",
              verificadas >= item.cantidad ? "text-success" : "text-muted",
            )}
            data-testid="verificadas"
          >
            {verificadas >= item.cantidad && (
              <CircleCheck
                className="mr-1 inline size-3.5 align-[-2px]"
                strokeWidth={2}
                aria-hidden
              />
            )}
            verificadas {verificadas}/{item.cantidad}
          </p>
        )}
        <p className={cn("text-xs", sinStock ? "text-danger font-medium" : "text-subtle")}>
          {stock === undefined
            ? `Consultando stock en ${deposito}…`
            : sinStock
              ? `Solo hay ${stock} en ${deposito}`
              : `Stock en ${deposito}: ${stock}`}
        </p>
      </div>
      {bloqueado ? (
        <span className="md:order-5" />
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted hover:text-danger justify-self-end md:order-5 md:size-9"
          aria-label={`Quitar ${item.titulo}`}
          onClick={onQuitar}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      )}
      <div className="md:order-2 md:flex md:justify-center">{cantidad}</div>
      <p className="text-right font-semibold whitespace-nowrap tabular-nums md:order-4">
        {formatearPesos(subtotal)}
      </p>
      <div className="col-span-2 flex items-center justify-between gap-2 tabular-nums md:order-3 md:col-span-1 md:flex-col md:items-end md:gap-0.5">
        <span className="text-sm">
          <PrecioUnitario item={item} /> <span className="text-subtle md:hidden">c/u</span>
        </span>
        {puedeEditar && (
          <Button variant="ghost" size="sm" className="-mr-3 md:h-7" onClick={onPrecioEspecial}>
            <Tag strokeWidth={1.75} /> Precio especial
          </Button>
        )}
      </div>
    </li>
  );
}

/** Precio de lista; con precio especial, el de lista tachado en gris y el especial en negro. */
function PrecioUnitario({ item }: { item: ItemVenta }) {
  return item.precioEspecial !== null ? (
    <span className="text-sm whitespace-nowrap">
      <s className="text-subtle">{formatearPesos(item.precioLista)}</s>{" "}
      <span className="text-foreground font-semibold">{formatearPesos(item.precioEspecial)}</span>
    </span>
  ) : (
    <span className="text-muted text-sm whitespace-nowrap">{formatearPesos(item.precioLista)}</span>
  );
}

function PrecioEspecialDialog({
  item,
  onCerrar,
  onAplicar,
}: {
  item: ItemVenta | null;
  onCerrar: () => void;
  onAplicar: (precio: string | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    setTexto(item?.precioEspecial ? String(Number(item.precioEspecial)) : "");
    setError(undefined);
  }, [item]);

  function aplicar() {
    const precio = montoTipeado(texto);
    if (precio === null) {
      setError("Ingresá un precio válido");
      return;
    }
    onAplicar(item && precio === Number(item.precioLista).toFixed(2) ? null : precio);
  }

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && onCerrar()}
      title="Precio especial"
      description={
        item ? `${item.titulo} · precio de lista ${formatearPesos(item.precioLista)}` : undefined
      }
      footer={
        <>
          {item?.precioEspecial && (
            <Button variant="secondary" onClick={() => onAplicar(null)}>
              Volver al de lista
            </Button>
          )}
          <Button onClick={aplicar}>Aplicar precio</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          aplicar();
        }}
      >
        <Input
          label="Precio por unidad"
          inputMode="decimal"
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          error={error}
          className="h-12 text-lg tabular-nums"
        />
      </form>
    </Dialog>
  );
}

/** Identidad completa de lo escaneado, en grande durante 2 s (no tapa los botones). */
function AvisoIdentidad({ identidad }: { identidad: IdentidadEscaneada }) {
  return (
    <div className="pointer-events-none sticky top-0 z-10 -mb-2" aria-live="polite">
      <div
        role="status"
        data-testid="identidad-escaneo"
        className="bg-card rounded-card border-border shadow-card flex items-center gap-4 border px-4 py-3"
      >
        <ScanBarcode className="text-muted size-8 shrink-0" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <p className="text-muted text-small">
            {identidad.marca} · {identidad.modelo}
            {identidad.especificacion ? ` · ${identidad.especificacion}` : ""}
          </p>
          <p className="text-h2 leading-tight font-semibold">
            {identidad.sabor ?? identidad.producto}
          </p>
          <p className="text-subtle text-small tabular-nums">
            {identidad.producto} · código {identidad.codigo}
          </p>
        </div>
      </div>
    </div>
  );
}

/** (c) El vape escaneado no está en la venta: hay que decidir antes de seguir. */
function AvisoNoCorresponde({
  ajeno,
  items,
  puedeAgregar,
  onDescartar,
  onAgregar,
}: {
  ajeno: { identidad: IdentidadEscaneada; sabor: SaborParaVenta } | null;
  items: ItemVenta[];
  puedeAgregar: boolean;
  onDescartar: () => void;
  onAgregar: () => void;
}) {
  return (
    <Dialog
      open={ajeno !== null}
      onOpenChange={(o) => !o && onDescartar()}
      title="Este vape no corresponde a la venta"
      footer={
        <>
          <Button variant="secondary" onClick={onDescartar}>
            Descartar
          </Button>
          {puedeAgregar && <Button onClick={onAgregar}>Agregar a la venta</Button>}
        </>
      }
    >
      {ajeno && (
        <div
          role="alert"
          data-testid="aviso-no-corresponde"
          className="bg-danger-soft text-danger-soft-foreground rounded-control flex gap-3 px-4 py-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <p>
            Escaneaste <strong>{textoIdentidad(ajeno.identidad)}</strong> (código{" "}
            {ajeno.identidad.codigo}); la venta tiene {listaDeItems(items)}.
          </p>
        </div>
      )}
    </Dialog>
  );
}
