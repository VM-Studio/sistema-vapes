"use client";

import { Minus, PackageSearch, Plus, ScanBarcode, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { usePanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import type { FuenteEscaneo } from "@/features/scanner/config";
import { invalidarResoluciones, resolverCodigo } from "@/features/scanner/resolver-codigo";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
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

export function PasoProductos({
  deposito,
  items,
  stock,
  puedeEditar,
  puedeAltaProductos,
  escanerActivo,
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
  const clave = useRef(0);

  const subdialogo = camara || alta !== null || precioDe !== null;
  useEffect(() => onSubdialogo(subdialogo), [subdialogo, onSubdialogo]);

  useEffect(() => {
    let vigente = true;
    setMasVendidos(null);
    void masVendidosAction({ depositoId: deposito.id }).then((r) => {
      if (vigente) setMasVendidos(r.ok ? r.data : []);
    });
    return () => {
      vigente = false;
    };
  }, [deposito.id]);

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
      const r = await resolverCodigo(panel.id, codigo);
      if (!r.ok) {
        feedback.error("No se pudo buscar el código", r.error.message);
        return;
      }
      if (r.data.encontrado) {
        aceptar(desdeEncontrada(r.data.variante, deposito.id));
        return;
      }
      feedback.error();
      setMensaje({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++clave.current,
      });
      if (puedeAltaProductos) {
        setCamara(false);
        setAlta(r.data.codigo);
      } else {
        setAviso(
          `El código ${r.data.codigo} no está cargado en ${panel.nombre}. Pedile a alguien con permiso de Productos que lo dé de alta.`,
        );
      }
      if (fuente === "manual") document.getElementById(ID_BUSCADOR_VENTA)?.focus();
    },
    [aceptar, deposito.id, feedback, panel.id, panel.nombre, puedeAltaProductos],
  );

  useBarcodeScanner({
    onScan: (c, m) => void procesar(c, m.fuente),
    enabled: escanerActivo && !subdialogo,
  });

  const yaAgregadas = new Set(items.map((i) => i.varianteId));

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Escanear o buscar"
        className="bg-card rounded-card flex flex-col gap-3 p-4"
      >
        <p className="text-muted text-small flex items-center gap-2">
          <ScanBarcode className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          Escaneá con la pistola o la cámara, o buscá a mano.
        </p>
        <div className="flex gap-2">
          <VariantePicker
            id={ID_BUSCADOR_VENTA}
            className="flex-1"
            depositoId={deposito.id}
            yaAgregadas={yaAgregadas}
            placeholder="Escaneá o buscá producto, sabor o código (F2)"
            onSelect={(v) => aceptar(desdeEncontrada(v, deposito.id))}
          />
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
                puedeEditar={puedeEditar}
                onCantidad={(n) => onCantidad(i.varianteId, n)}
                onQuitar={() => onQuitar(i.varianteId)}
                onPrecioEspecial={() => setPrecioDe(i)}
              />
            ))}
          </ul>
        </div>
      )}

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
                      <span className="text-sm font-semibold">{formatearPesos(p.precioVenta)}</span>
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
          }}
        />
      )}
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
  onCantidad,
  onQuitar,
  onPrecioEspecial,
}: {
  item: ItemVenta;
  stock: number | undefined;
  deposito: string;
  puedeEditar: boolean;
  onCantidad: (n: number) => void;
  onQuitar: () => void;
  onPrecioEspecial: () => void;
}) {
  const sinStock = stock !== undefined && item.cantidad > stock;
  const subtotal = deCentavos(aCentavos(precioCobrado(item)) * item.cantidad);
  const cantidad = (
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
        <p className={cn("text-xs", sinStock ? "text-danger font-medium" : "text-subtle")}>
          {stock === undefined
            ? `Consultando stock en ${deposito}…`
            : sinStock
              ? `Solo hay ${stock} en ${deposito}`
              : `Stock en ${deposito}: ${stock}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted hover:text-danger justify-self-end md:order-5 md:size-9"
        aria-label={`Quitar ${item.titulo}`}
        onClick={onQuitar}
      >
        <Trash2 strokeWidth={1.75} />
      </Button>
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
