"use client";

import { Camera, Info, Link2, Minus, Plus, ScanBarcode, Trash2, Warehouse } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { OBSERVACION_MINIMA } from "@/lib/validations/devolucion";
import { mostrarTelefono } from "@/lib/validations/cliente";
import { cn, formatearFecha } from "@/lib/utils";

import {
  registrarDevolucionAction,
  variantesParaDevolucionAction,
  ventasDeClienteAction,
} from "./actions";
import { StepperVenta } from "../ventas/_componentes/stepper-venta";

export interface VentaVinculable {
  id: string;
  codigo: string;
  fecha: Date;
  items: { varianteId: string; titulo: string; cantidad: number }[];
}

export interface InicialDevolucion {
  cliente: { id: string; nombre: string; telefono: string };
  venta: (VentaVinculable & { depositoId: string }) | null;
  variantes: VarianteEncontrada[];
}

interface Item {
  variante: VarianteEncontrada;
  cantidad: number;
}

type Paso = 1 | 2 | 3 | 4;

const TITULOS: Record<Paso, string> = {
  1: "Cliente",
  2: "Galpón",
  3: "Productos",
  4: "Observación y confirmar",
};

const PASOS_STEPPER = ["Cliente", "Galpón", "Productos", "Observación"];

const AVISO_STOCK = "Se descuenta del stock la unidad nueva que se entrega al cliente.";

const stockEn = (v: VarianteEncontrada, depositoId: string | null) =>
  depositoId ? (v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0) : 0;

/**
 * Registrar una devolución por garantía en 4 pasos: cliente (y, opcional, la
 * venta original), galpón del que sale la unidad nueva, productos (pistola,
 * cámara o buscador) y observación.
 */
export function RegistrarDevolucion({
  abierto,
  onCerrar,
  depositos,
  inicial,
}: {
  abierto: boolean;
  onCerrar: () => void;
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  inicial: InicialDevolucion | null;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();

  const [paso, setPaso] = useState<Paso>(1);
  const [cliente, setCliente] = useState<ClienteElegido | null>(
    inicial ? { tipo: "existente", ...inicial.cliente } : null,
  );
  const [ventas, setVentas] = useState<VentaVinculable[] | null>(null);
  const [venta, setVenta] = useState<VentaVinculable | null>(inicial?.venta ?? null);
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>(
    inicial?.variantes.map((v) => ({ variante: v, cantidad: 1 })) ?? [],
  );
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clienteId = cliente?.tipo === "existente" ? cliente.id : null;
  const deposito = depositos.find((d) => d.id === depositoId) ?? null;

  // Ventas del cliente para "vincular a una venta".
  useEffect(() => {
    setVentas(null);
    if (!clienteId || !abierto) return;
    let vigente = true;
    void ventasDeClienteAction({ clienteId }).then((r) => {
      if (!vigente) return;
      setVentas(r.ok ? r.data : []);
    });
    return () => {
      vigente = false;
    };
  }, [clienteId, abierto]);

  function elegirCliente(c: ClienteElegido | null) {
    if (c?.tipo === "existente" && c.id === clienteId) return;
    setCliente(c);
    if (venta) {
      setVenta(null);
      setItems([]);
    }
  }

  async function vincular(v: VentaVinculable | null) {
    setVenta(v);
    if (!v) return;
    const r = await variantesParaDevolucionAction({
      ids: [...new Set(v.items.map((i) => i.varianteId))],
    });
    if (!r.ok) {
      toast.error("No se pudieron cargar los productos de la venta", r.error.message);
      return;
    }
    setItems(r.data.map((variante) => ({ variante, cantidad: 1 })));
  }

  const agregar = useCallback((v: VarianteEncontrada) => {
    setItems((its) =>
      its.some((i) => i.variante.varianteId === v.varianteId)
        ? its.map((i) =>
            i.variante.varianteId === v.varianteId
              ? { variante: v, cantidad: Math.min(10_000, i.cantidad + 1) }
              : i,
          )
        : [...its, { variante: v, cantidad: 1 }],
    );
  }, []);

  const escaner = useEscanerVariantes({
    onVariante: (v) => agregar(v),
    habilitado: abierto && paso === 3,
    tituloCamara: deposito ? `Garantía desde ${deposito.nombre}` : "Garantía",
  });

  const cambiarCantidad = (id: string, cantidad: number) =>
    setItems((its) =>
      its.map((i) =>
        i.variante.varianteId === id ? { ...i, cantidad: Math.max(1, cantidad) } : i,
      ),
    );
  const quitar = (id: string) => setItems((its) => its.filter((i) => i.variante.varianteId !== id));

  const vendidoEnVenta = (varianteId: string) =>
    venta?.items.filter((i) => i.varianteId === varianteId).reduce((a, i) => a + i.cantidad, 0) ??
    null;
  const sinStock = items.filter((i) => i.cantidad > stockEn(i.variante, depositoId));
  const observacionOk = observacion.trim().length >= OBSERVACION_MINIMA;

  async function confirmar() {
    if (!clienteId || !depositoId) return;
    setEnviando(true);
    setError(null);
    const r = await registrarDevolucionAction({
      clienteId,
      ventaId: venta?.id ?? null,
      depositoId,
      items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
      observacion,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.observacion?.[0] ?? r.error.message);
      return;
    }
    invalidarResoluciones();
    toast.success(`Devolución ${r.data.codigo} registrada`);
    if (r.data.avisos.length > 0) toast.info("Atención", r.data.avisos.join(" "));
    router.push(ruta(`/devoluciones/${r.data.id}`));
  }

  const footer =
    paso === 2 ? (
      <Button variant="secondary" onClick={() => setPaso(1)}>
        Atrás
      </Button>
    ) : (
      <>
        {paso > 1 && (
          <Button
            variant="secondary"
            onClick={() => setPaso((p) => (p - 1) as Paso)}
            disabled={enviando}
          >
            Atrás
          </Button>
        )}
        {paso === 1 && (
          <Button onClick={() => setPaso(2)} disabled={!clienteId}>
            Continuar
          </Button>
        )}
        {paso === 3 && (
          <Button onClick={() => setPaso(4)} disabled={items.length === 0 || sinStock.length > 0}>
            Continuar
          </Button>
        )}
        {paso === 4 && (
          <Button onClick={() => void confirmar()} loading={enviando} disabled={!observacionOk}>
            Confirmar devolución
          </Button>
        )}
      </>
    );

  return (
    <>
      <Sheet
        open={abierto}
        onOpenChange={(o) => !o && !enviando && onCerrar()}
        title="Registrar devolución"
        description={`Paso ${paso} de 4 · ${TITULOS[paso]}`}
        className="md:w-[36rem]"
        footer={footer}
      >
        <StepperVenta ariaLabel="Pasos" pasos={PASOS_STEPPER} actual={paso - 1} className="mb-6" />
        {paso === 1 && (
          <div className="flex flex-col gap-5">
            <SelectorCliente valor={cliente} onCambiar={elegirCliente} permitirNuevo={false} />
            {clienteId && (
              <section aria-labelledby="vincular-venta" className="flex flex-col gap-2">
                <h3 id="vincular-venta" className="text-h3 flex items-center gap-2 font-semibold">
                  <Link2 className="text-muted size-5" strokeWidth={1.75} aria-hidden />
                  Vincular a una venta <span className="text-muted font-normal">(opcional)</span>
                </h3>
                {ventas === null ? (
                  <p className="text-muted text-sm">Buscando sus compras…</p>
                ) : (
                  <div
                    role="radiogroup"
                    aria-label="Venta original"
                    className="flex flex-col gap-2"
                  >
                    <OpcionVenta activa={!venta} onClick={() => void vincular(null)}>
                      <span className="font-medium">Sin vincular</span>
                    </OpcionVenta>
                    {venta && !ventas.some((v) => v.id === venta.id) && (
                      <OpcionVenta activa onClick={() => undefined}>
                        <ResumenVenta venta={venta} />
                      </OpcionVenta>
                    )}
                    {ventas.map((v) => (
                      <OpcionVenta
                        key={v.id}
                        activa={venta?.id === v.id}
                        onClick={() => void vincular(v)}
                      >
                        <ResumenVenta venta={v} />
                      </OpcionVenta>
                    ))}
                    {ventas.length === 0 && (
                      <p className="text-muted text-sm">No tiene compras confirmadas.</p>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {paso === 2 && (
          <SelectorGalpon
            depositos={depositos}
            preseleccionadoId={depositoId ?? inicial?.venta?.depositoId ?? null}
            titulo="¿De qué galpón sale la unidad nueva?"
            descripcion={AVISO_STOCK}
            onConfirmar={(id) => {
              setDepositoId(id);
              setPaso(3);
            }}
          />
        )}

        {paso === 3 && (
          <div className="flex flex-col gap-4">
            <p className="bg-surface-3 text-foreground rounded-card flex items-start gap-2 px-4 py-3 text-sm">
              <Info className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              {AVISO_STOCK}
            </p>
            <div className="bg-surface rounded-card flex items-center gap-3 px-4 py-3">
              <Warehouse className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <p className="min-w-0 flex-1 text-sm">
                Sale de <strong data-testid="galpon-devolucion">{deposito?.nombre}</strong>
              </p>
              <Button variant="secondary" size="sm" onClick={() => setPaso(2)}>
                Cambiar
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <ScanBarcode className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <p className="text-muted min-w-0 flex-1 text-sm">
                Escaneá el producto con la pistola o la cámara, o buscalo a mano.
              </p>
              <Button
                variant="secondary"
                onClick={escaner.abrirCamara}
                aria-label="Escanear con la cámara"
              >
                <Camera strokeWidth={1.75} /> <span className="hidden sm:inline">Cámara</span>
              </Button>
            </div>
            <VariantePicker
              onSelect={(v) => escaner.agregar(v)}
              depositoId={depositoId ?? undefined}
              yaAgregadas={new Set(items.map((i) => i.variante.varianteId))}
              placeholder="Buscar: producto, sabor o código…"
            />
            {items.length === 0 ? (
              <p className="bg-surface text-muted rounded-card px-4 py-6 text-center text-sm">
                Todavía no agregaste productos.
              </p>
            ) : (
              <ul
                aria-label="Productos a entregar"
                className="bg-surface divide-border rounded-card flex flex-col divide-y"
              >
                {items.map((i) => {
                  const v = i.variante;
                  const hay = stockEn(v, depositoId);
                  const vendido = vendidoEnVenta(v.varianteId);
                  return (
                    <li
                      key={v.varianteId}
                      aria-label={v.titulo}
                      className="flex flex-col gap-2 p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 leading-tight font-semibold break-words">
                          {v.titulo}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted hover:text-danger -mt-2 -mr-2 shrink-0"
                          onClick={() => quitar(v.varianteId)}
                          aria-label={`Quitar ${v.titulo}`}
                        >
                          <Trash2 strokeWidth={1.75} />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-muted min-w-0 text-xs">
                          <p className={cn(i.cantidad > hay && "text-danger font-medium")}>
                            Stock en {deposito?.nombre}: {hay}
                          </p>
                          {venta && (
                            <p
                              className={cn(
                                vendido !== null &&
                                  i.cantidad > vendido &&
                                  "text-warning font-medium",
                              )}
                            >
                              {vendido ? (
                                <>
                                  Vendidos en{" "}
                                  <span className="whitespace-nowrap">{venta.codigo}</span>:{" "}
                                  {vendido}
                                </>
                              ) : (
                                <>
                                  No está en{" "}
                                  <span className="whitespace-nowrap">{venta.codigo}</span>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => cambiarCantidad(v.varianteId, i.cantidad - 1)}
                            aria-label={`Restar uno de ${v.titulo}`}
                            disabled={i.cantidad <= 1}
                          >
                            <Minus strokeWidth={1.75} />
                          </Button>
                          <CantidadInput
                            etiqueta={`Cantidad de ${v.titulo}`}
                            valor={i.cantidad}
                            onCambio={(n) => cambiarCantidad(v.varianteId, n)}
                            max={10_000}
                            className="w-14 font-semibold"
                          />
                          <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => cambiarCantidad(v.varianteId, i.cantidad + 1)}
                            aria-label={`Sumar uno de ${v.titulo}`}
                          >
                            <Plus strokeWidth={1.75} />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {sinStock.length > 0 && (
              <p role="alert" className="text-danger text-sm">
                No hay stock suficiente en {deposito?.nombre} de{" "}
                {sinStock.map((i) => i.variante.titulo).join(", ")}. Elegí otro galpón o ajustá la
                cantidad.
              </p>
            )}
          </div>
        )}

        {paso === 4 && (
          <div className="flex flex-col gap-4">
            <Textarea
              label="Observación"
              required
              rows={3}
              autoFocus
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              maxLength={1000}
              placeholder="¿Qué le pasó al producto? Ej: no carga, luz roja parpadea"
              hint={`Mínimo ${OBSERVACION_MINIMA} caracteres (${observacion.trim().length}/${OBSERVACION_MINIMA}).`}
            />
            <section
              aria-label="Resumen"
              className="bg-surface rounded-card flex flex-col gap-2 p-4 text-sm"
            >
              <h3 className="text-h3 mb-1 font-semibold">Resumen</h3>
              {cliente && (
                <p>
                  <span className="text-muted">Cliente:</span> <strong>{cliente.nombre}</strong>{" "}
                  <span className="text-muted tabular-nums">
                    ({mostrarTelefono(cliente.telefono)})
                  </span>
                </p>
              )}
              {venta && (
                <p>
                  <span className="text-muted">Venta:</span>{" "}
                  <strong className="font-mono">{venta.codigo}</strong>
                </p>
              )}
              <p>
                <span className="text-muted">Sale de:</span> <strong>{deposito?.nombre}</strong>
              </p>
              <ul className="border-border flex flex-col gap-1 border-t pt-2">
                {items.map((i) => (
                  <li key={i.variante.varianteId} className="flex justify-between gap-3">
                    <span className="truncate">{i.variante.titulo}</span>
                    <strong className="shrink-0 tabular-nums">−{i.cantidad}</strong>
                  </li>
                ))}
              </ul>
              <p className="text-muted flex items-start gap-1.5 text-xs">
                <Info className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {AVISO_STOCK}
              </p>
            </section>
            {error && (
              <p
                role="alert"
                className="bg-danger-soft text-danger-soft-foreground rounded-control px-4 py-3 text-sm"
              >
                {error}
              </p>
            )}
          </div>
        )}
      </Sheet>
      {escaner.ui}
    </>
  );
}

function OpcionVenta({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      onClick={onClick}
      className={cn(
        "rounded-control flex min-h-12 w-full flex-col items-start gap-0.5 border px-4 py-2.5 text-left text-sm transition-colors",
        activa
          ? "border-foreground bg-surface ring-foreground ring-1 ring-inset"
          : "border-border bg-surface hover:border-input",
      )}
    >
      {children}
    </button>
  );
}

function ResumenVenta({ venta }: { venta: VentaVinculable }) {
  return (
    <>
      <span className="font-semibold">
        <span className="font-mono">{venta.codigo}</span>{" "}
        <span className="text-muted font-normal">· {formatearFecha(venta.fecha)}</span>
      </span>
      <span className="text-muted line-clamp-2 text-xs">
        {venta.items.map((i) => `${i.cantidad} × ${i.titulo}`).join(", ")}
      </span>
    </>
  );
}
