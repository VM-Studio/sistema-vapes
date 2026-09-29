"use client";

import { Minus, PackageSearch, Plus, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { usePanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-5">
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

      {aviso && (
        <p
          role="alert"
          className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm"
        >
          {aviso}
        </p>
      )}

      {items.length === 0 ? (
        <div className="border-border text-muted flex flex-col items-center gap-2 rounded-card border border-dashed px-4 py-8 text-center text-sm">
          <PackageSearch className="size-8" strokeWidth={1.75} aria-hidden />
          <p>Escaneá con la pistola o la cámara, buscá arriba o tocá uno de los más vendidos.</p>
        </div>
      ) : (
        <ul aria-label="Productos de la venta" className="flex flex-col gap-2">
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
      )}

      <section aria-labelledby="mas-vendidos" className="flex flex-col gap-2">
        <h3 id="mas-vendidos" className="text-muted text-sm font-medium">
          Más vendidos
        </h3>
        {masVendidos === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, n) => (
              <div key={n} className="bg-surface-2 h-20 animate-pulse rounded-card" />
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
                      "border-border bg-surface hover:border-primary hover:bg-primary-soft flex min-h-20 w-full flex-col justify-between gap-1 rounded-card border p-3 text-left transition-colors",
                      sinStock && "opacity-60",
                    )}
                  >
                    <span className="line-clamp-2 text-sm leading-snug font-medium">
                      {p.nombreCompleto}
                      {p.sabor && <span className="text-muted block">{p.sabor}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs tabular-nums">
                      <span className="font-semibold">{formatearPesos(p.precioVenta)}</span>
                      <span className={cn(sinStock ? "text-danger" : "text-muted")}>
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
  return (
    <li
      data-sin-stock={sinStock || undefined}
      className={cn(
        "flex flex-col gap-3 rounded-card border p-3 md:flex-row md:items-center md:gap-4 md:p-4",
        sinStock ? "border-danger/40 bg-danger-soft" : "border-border bg-surface",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.titulo}</p>
        <p className="text-sm tabular-nums">
          {item.precioEspecial !== null ? (
            <>
              <s className="text-muted">{formatearPesos(item.precioLista)}</s>{" "}
              <span className="text-primary font-semibold">
                {formatearPesos(item.precioEspecial)}
              </span>
            </>
          ) : (
            <span className="text-muted">{formatearPesos(item.precioLista)}</span>
          )}
        </p>
        <p className={cn("text-xs", sinStock ? "text-danger font-medium" : "text-muted")}>
          {stock === undefined
            ? `Consultando stock en ${deposito}…`
            : sinStock
              ? `Solo hay ${stock} en ${deposito}`
              : `Stock en ${deposito}: ${stock}`}
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-end">
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
        <p className="w-28 text-right font-semibold tabular-nums">{formatearPesos(subtotal)}</p>
      </div>
      <div className="flex items-center justify-end gap-1">
        {puedeEditar && (
          <Button variant="ghost" size="sm" onClick={onPrecioEspecial}>
            <Tag strokeWidth={1.75} /> Precio especial
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="text-danger"
          aria-label={`Quitar ${item.titulo}`}
          onClick={onQuitar}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      </div>
    </li>
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
