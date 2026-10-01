"use client";

import type { MedioPago } from "@prisma/client";
import {
  ArrowRight,
  Camera,
  Info,
  Link2,
  Minus,
  PackageX,
  Plus,
  RefreshCcw,
  ScanBarcode,
  Trash2,
  Undo2,
  Warehouse,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearPesos } from "@/lib/format";
import { OBSERVACION_MINIMA } from "@/lib/validations/devolucion";
import { mostrarTelefono } from "@/lib/validations/cliente";
import { cn, formatearFecha } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, MEDIOS_PAGO } from "@/lib/ventas-ui";

import {
  otrosSaboresAction,
  registrarDevolucionAction,
  variantesParaDevolucionAction,
  ventasDeClienteAction,
} from "./actions";
import { ICONO_MEDIO_PAGO } from "../ventas/_componentes/medio-pago";
import { StepperVenta } from "../ventas/_componentes/stepper-venta";

export interface VentaVinculable {
  id: string;
  codigo: string;
  fecha: Date;
  /** `devuelto`: unidades de ese sabor ya devueltas en devoluciones registradas. */
  items: { varianteId: string; titulo: string; cantidad: number; devuelto: number }[];
}

export interface InicialDevolucion {
  cliente: { id: string; nombre: string; telefono: string };
  venta: (VentaVinculable & { depositoId: string }) | null;
  variantes: VarianteEncontrada[];
}

interface Item {
  /** Lo que trae el cliente (fallado). */
  variante: VarianteEncontrada;
  cantidad: number;
  /** Lo que se le entrega: el mismo sabor, otro sabor u otro modelo. */
  entregada: VarianteEncontrada;
}

type Paso = 1 | 2 | 3 | 4;

const TITULOS: Record<Paso, string> = {
  1: "Cliente",
  2: "Galpón",
  3: "Productos y cambio",
  4: "Observación y confirmar",
};

const PASOS_STEPPER = ["Cliente", "Galpón", "Productos", "Confirmar"];

const AVISO_STOCK =
  "Se descuenta del stock la unidad nueva que se entrega: el mismo sabor u, si no hay, otro sabor u otro modelo.";

const MAX_SIN_VENTA = 10_000;

const stockEn = (v: VarianteEncontrada, depositoId: string | null) =>
  depositoId ? (v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0) : 0;

/** Montos en centavos (enteros): sin errores de redondeo al sumar. */
const centavos = (s: string | number) => Math.round(Number(s) * 100);
const pesos = (c: number) => formatearPesos(c / 100);

const esCambio = (i: Item) => i.entregada.varianteId !== i.variante.varianteId;
/** Diferencia por unidad (centavos): entregado − devuelto, a precio de lista. 0 si es el mismo sabor. */
const difUnitaria = (i: Item) =>
  esCambio(i) ? centavos(i.entregada.precioVenta) - centavos(i.variante.precioVenta) : 0;

const quedanDeVenta = (venta: VentaVinculable | null, varianteId: string): number | null => {
  if (!venta) return null;
  const its = venta.items.filter((i) => i.varianteId === varianteId);
  if (its.length === 0) return 0;
  return its.reduce((a, i) => a + i.cantidad, 0) - (its[0]?.devuelto ?? 0);
};

/**
 * Registrar una devolución por garantía en 4 pasos: cliente (y, opcional, la
 * venta original), galpón del que sale la unidad nueva, productos (pistola,
 * cámara o buscador; con venta vinculada, sus sabores y hasta lo vendido) con
 * lo que se entrega a cambio, y observación con la diferencia de precio.
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
  /** Sabores de la venta vinculada (para volver a agregar uno que se quitó). */
  const [deLaVenta, setDeLaVenta] = useState<VarianteEncontrada[]>(
    inicial?.venta ? inicial.variantes : [],
  );
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>(() =>
    (inicial?.variantes ?? [])
      .filter((v) => (quedanDeVenta(inicial?.venta ?? null, v.varianteId) ?? 1) > 0)
      .map((v) => ({ variante: v, cantidad: 1, entregada: v })),
  );
  /** Ítem con el selector de cambio abierto (varianteId del devuelto). */
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [observacion, setObservacion] = useState("");
  const [medio, setMedio] = useState<MedioPago | null>(null);
  const [bonificar, setBonificar] = useState(false);
  const [montoBonificado, setMontoBonificado] = useState("");
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
      setDeLaVenta([]);
      setItems([]);
    }
  }

  async function vincular(v: VentaVinculable | null) {
    setVenta(v);
    setCambiando(null);
    if (!v) {
      setDeLaVenta([]);
      return;
    }
    const r = await variantesParaDevolucionAction({
      ids: [...new Set(v.items.map((i) => i.varianteId))],
    });
    if (!r.ok) {
      toast.error("No se pudieron cargar los productos de la venta", r.error.message);
      return;
    }
    setDeLaVenta(r.data);
    // Solo los sabores que todavía se pueden devolver.
    setItems(
      r.data
        .filter((variante) => (quedanDeVenta(v, variante.varianteId) ?? 0) > 0)
        .map((variante) => ({ variante, cantidad: 1, entregada: variante })),
    );
  }

  /** Tope de unidades a devolver de un sabor: lo que queda de la venta, o sin tope práctico. */
  const maximo = useCallback(
    (varianteId: string) => quedanDeVenta(venta, varianteId) ?? MAX_SIN_VENTA,
    [venta],
  );

  const agregar = useCallback(
    (v: VarianteEncontrada) => {
      setItems((its) => {
        const existente = its.find((i) => i.variante.varianteId === v.varianteId);
        if (existente)
          return its.map((i) =>
            i === existente
              ? { ...i, variante: v, cantidad: Math.min(maximo(v.varianteId), i.cantidad + 1) }
              : i,
          );
        return [...its, { variante: v, cantidad: 1, entregada: v }];
      });
    },
    [maximo],
  );

  const escaner = useEscanerVariantes({
    onVariante: (v) => {
      // Con venta vinculada solo se aceptan sus sabores.
      if (venta && (quedanDeVenta(venta, v.varianteId) ?? 0) <= 0) {
        toast.error(`${v.titulo} no está en la venta ${venta.codigo} (o ya se devolvió todo)`);
        return;
      }
      agregar(v);
    },
    habilitado: abierto && paso === 3 && cambiando === null,
    tituloCamara: deposito ? `Garantía desde ${deposito.nombre}` : "Garantía",
  });

  const cambiarCantidad = (id: string, cantidad: number) =>
    setItems((its) =>
      its.map((i) =>
        i.variante.varianteId === id
          ? { ...i, cantidad: Math.min(maximo(id), Math.max(1, cantidad)) }
          : i,
      ),
    );
  const quitar = (id: string) => {
    setItems((its) => its.filter((i) => i.variante.varianteId !== id));
    if (cambiando === id) setCambiando(null);
  };
  const elegirEntregada = (id: string, entregada: VarianteEncontrada) => {
    setItems((its) => its.map((i) => (i.variante.varianteId === id ? { ...i, entregada } : i)));
    setCambiando(null);
  };

  // Stock de lo que se ENTREGA (varios devueltos pueden cambiarse por el mismo sabor).
  const pedidoPorEntregada = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items)
      m.set(i.entregada.varianteId, (m.get(i.entregada.varianteId) ?? 0) + i.cantidad);
    return m;
  }, [items]);
  const faltaStock = (i: Item) =>
    (pedidoPorEntregada.get(i.entregada.varianteId) ?? 0) > stockEn(i.entregada, depositoId);
  const sinStock = items.filter(faltaStock);
  const sobreVenta = items.filter((i) => i.cantidad > maximo(i.variante.varianteId));
  const noDevueltosDeVenta = venta
    ? deLaVenta.filter(
        (v) =>
          (quedanDeVenta(venta, v.varianteId) ?? 0) > 0 &&
          !items.some((i) => i.variante.varianteId === v.varianteId),
      )
    : [];

  // Diferencia de precio (centavos): > 0 cobra, < 0 devuelve.
  const diferencia = items.reduce((a, i) => a + difUnitaria(i) * i.cantidad, 0);
  const maxMonto = Math.abs(diferencia);
  const montoFinal = bonificar
    ? Math.min(maxMonto, Math.max(0, centavos(montoBonificado.replace(",", ".") || 0)))
    : maxMonto;
  const observacionOk = observacion.trim().length >= OBSERVACION_MINIMA;
  const pagoOk = montoFinal === 0 || medio !== null;

  async function confirmar() {
    if (!clienteId || !depositoId) return;
    setEnviando(true);
    setError(null);
    const r = await registrarDevolucionAction({
      clienteId,
      ventaId: venta?.id ?? null,
      depositoId,
      items: items.map((i) => ({
        varianteId: i.variante.varianteId,
        cantidad: i.cantidad,
        varianteEntregadaId: esCambio(i) ? i.entregada.varianteId : null,
      })),
      observacion,
      diferenciaVista: diferencia / 100,
      montoDiferencia: montoFinal / 100,
      medioPagoDiferencia: montoFinal > 0 ? medio : null,
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
          <Button
            onClick={() => {
              setCambiando(null);
              setPaso(4);
            }}
            disabled={items.length === 0 || sinStock.length > 0 || sobreVenta.length > 0}
          >
            Continuar
          </Button>
        )}
        {paso === 4 && (
          <Button
            onClick={() => void confirmar()}
            loading={enviando}
            disabled={!observacionOk || !pagoOk}
          >
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
                        disabled={v.items.every((i) => i.cantidad - i.devuelto <= 0)}
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
            <div className="bg-surface rounded-card flex items-center gap-3 px-4 py-3">
              <Warehouse className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <p className="min-w-0 flex-1 text-sm">
                Sale de <strong data-testid="galpon-devolucion">{deposito?.nombre}</strong>
              </p>
              <Button variant="secondary" size="sm" onClick={() => setPaso(2)}>
                Cambiar
              </Button>
            </div>

            {venta ? (
              <p className="bg-tono-azul-suave text-foreground rounded-card flex items-start gap-2 px-4 py-3 text-sm">
                <Info className="text-marca-azul size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>
                  Vinculada a <strong className="font-mono">{venta.codigo}</strong>: se puede
                  devolver hasta lo que se vendió de cada sabor (menos lo ya devuelto).
                </span>
              </p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <ScanBarcode
                    className="text-muted size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <p className="text-muted min-w-0 flex-1 text-sm">
                    Escaneá el producto que trae el cliente, o buscalo a mano.
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
              </>
            )}

            {items.length === 0 ? (
              <p className="bg-surface text-muted rounded-card px-4 py-6 text-center text-sm">
                {venta
                  ? "No quedan productos para devolver de esta venta."
                  : "Todavía no agregaste productos."}
              </p>
            ) : (
              <ul aria-label="Productos que devuelve" className="flex flex-col gap-3">
                {items.map((i) => (
                  <ItemDevolucion
                    key={i.variante.varianteId}
                    item={i}
                    depositoId={depositoId}
                    depositoNombre={deposito?.nombre ?? ""}
                    ventaCodigo={venta?.codigo ?? null}
                    maximo={maximo(i.variante.varianteId)}
                    faltaStock={faltaStock(i)}
                    cambiando={cambiando === i.variante.varianteId}
                    onCantidad={(n) => cambiarCantidad(i.variante.varianteId, n)}
                    onQuitar={() => quitar(i.variante.varianteId)}
                    onAbrirCambio={() => setCambiando(i.variante.varianteId)}
                    onCerrarCambio={() => setCambiando(null)}
                    onEntregar={(v) => elegirEntregada(i.variante.varianteId, v)}
                  />
                ))}
              </ul>
            )}

            {noDevueltosDeVenta.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted text-sm">También de esta venta:</span>
                {noDevueltosDeVenta.map((v) => (
                  <Button
                    key={v.varianteId}
                    variant="secondary"
                    size="sm"
                    onClick={() => agregar(v)}
                  >
                    <Plus strokeWidth={1.75} /> {v.titulo}
                  </Button>
                ))}
              </div>
            )}

            {sinStock.length > 0 && (
              <p role="alert" className="text-danger text-sm">
                No hay stock suficiente en {deposito?.nombre} de{" "}
                {[...new Set(sinStock.map((i) => i.entregada.titulo))].join(", ")}. Cambialo por
                otro sabor u otro modelo, elegí otro galpón o ajustá la cantidad.
              </p>
            )}
            {diferencia !== 0 && <ResumenDiferencia diferencia={diferencia} className="mt-1" />}
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

            {diferencia !== 0 && (
              <section
                aria-label="Diferencia de precio"
                className="bg-surface rounded-card flex flex-col gap-4 p-4"
              >
                <ResumenDiferencia diferencia={diferencia} montoFinal={montoFinal} />
                {maxMonto > 0 && (
                  <>
                    <Switch
                      checked={bonificar}
                      onCheckedChange={(b) => {
                        setBonificar(b);
                        setMontoBonificado(b ? String(maxMonto / 100) : "");
                      }}
                      label={diferencia > 0 ? "Bonificar parte de la diferencia" : "Devolver menos"}
                      hint={
                        diferencia > 0
                          ? "Cobrarle menos (o nada) al cliente."
                          : "Por ejemplo, si el cliente acepta dejarlo a favor."
                      }
                    />
                    {bonificar && (
                      <Input
                        label={diferencia > 0 ? "Monto a cobrar" : "Monto a devolver"}
                        inputMode="decimal"
                        value={montoBonificado}
                        onChange={(e) => setMontoBonificado(e.target.value)}
                        hint={`Entre $ 0 y ${pesos(maxMonto)}.`}
                      />
                    )}
                  </>
                )}
                {montoFinal > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-semibold">
                      {diferencia > 0 ? "¿Cómo paga el cliente?" : "¿Cómo se le devuelve?"}
                    </legend>
                    <div
                      role="radiogroup"
                      aria-label="Medio de pago"
                      className="grid gap-2 sm:grid-cols-3"
                    >
                      {MEDIOS_PAGO.map((m) => {
                        const Icono = ICONO_MEDIO_PAGO[m];
                        const activo = medio === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={activo}
                            onClick={() => setMedio(m)}
                            className={cn(
                              "rounded-control flex min-h-12 items-center gap-2.5 border px-3 text-sm font-semibold transition-colors",
                              activo
                                ? "border-foreground bg-foreground text-background"
                                : "border-input bg-surface text-foreground hover:bg-surface-2",
                            )}
                          >
                            <Icono
                              className={cn("size-5", activo ? "text-background" : "text-muted")}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            {ETIQUETA_MEDIO_PAGO[m]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </section>
            )}

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
              <ul className="border-border flex flex-col gap-2 border-t pt-2">
                {items.map((i) => (
                  <li key={i.variante.varianteId} className="flex flex-col gap-0.5">
                    <span className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="text-muted">Devuelve</span> {i.variante.titulo}
                      </span>
                      <strong className="shrink-0 tabular-nums">{i.cantidad}</strong>
                    </span>
                    <span className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="text-muted">Se lleva</span>{" "}
                        {esCambio(i) ? <strong>{i.entregada.titulo}</strong> : "el mismo sabor"}
                      </span>
                      <strong className="shrink-0 tabular-nums">−{i.cantidad}</strong>
                    </span>
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

/** Un producto devuelto: cantidad (con tope), stock de lo que se entrega y el cambio. */
function ItemDevolucion({
  item: i,
  depositoId,
  depositoNombre,
  ventaCodigo,
  maximo,
  faltaStock,
  cambiando,
  onCantidad,
  onQuitar,
  onAbrirCambio,
  onCerrarCambio,
  onEntregar,
}: {
  item: Item;
  depositoId: string | null;
  depositoNombre: string;
  ventaCodigo: string | null;
  maximo: number;
  faltaStock: boolean;
  cambiando: boolean;
  onCantidad: (n: number) => void;
  onQuitar: () => void;
  onAbrirCambio: () => void;
  onCerrarCambio: () => void;
  onEntregar: (v: VarianteEncontrada) => void;
}) {
  const v = i.variante;
  const cambio = esCambio(i);
  const hay = stockEn(i.entregada, depositoId);
  const dif = difUnitaria(i);
  return (
    <li
      aria-label={v.titulo}
      className={cn(
        "bg-surface rounded-card flex flex-col gap-3 border p-4",
        faltaStock ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">Devuelve</p>
          <p className="leading-tight font-semibold break-words">{v.titulo}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted hover:text-danger -mt-2 -mr-2 shrink-0"
          onClick={onQuitar}
          aria-label={`Quitar ${v.titulo}`}
        >
          <Trash2 strokeWidth={1.75} />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted min-w-0 text-xs">
          {ventaCodigo ? (
            <>
              Se pueden devolver <strong className="text-foreground">{maximo}</strong> de{" "}
              <span className="whitespace-nowrap">{ventaCodigo}</span>
            </>
          ) : (
            "Cantidad que trae el cliente"
          )}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => onCantidad(i.cantidad - 1)}
            aria-label={`Restar uno de ${v.titulo}`}
            disabled={i.cantidad <= 1}
          >
            <Minus strokeWidth={1.75} />
          </Button>
          <CantidadInput
            etiqueta={`Cantidad de ${v.titulo}`}
            valor={i.cantidad}
            onCambio={onCantidad}
            max={maximo}
            className="w-14 font-semibold"
          />
          <Button
            variant="secondary"
            size="icon"
            onClick={() => onCantidad(i.cantidad + 1)}
            aria-label={`Sumar uno de ${v.titulo}`}
            disabled={i.cantidad >= maximo}
          >
            <Plus strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Lo que se le entrega */}
      <div
        className={cn(
          "rounded-control flex flex-col gap-2 px-3 py-2.5",
          faltaStock ? "bg-danger-soft" : cambio ? "bg-tono-azul-suave" : "bg-surface-2",
        )}
      >
        <div className="flex flex-wrap items-start gap-2">
          {faltaStock ? (
            <PackageX className="text-danger mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          ) : (
            <ArrowRight
              className={cn("mt-0.5 size-4 shrink-0", cambio ? "text-marca-azul" : "text-muted")}
              strokeWidth={2}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <span className="text-muted">Se lleva:</span>{" "}
              <strong>{cambio ? i.entregada.titulo : "el mismo sabor"}</strong>
              {cambio && (
                <span className="text-muted">
                  {" "}
                  · {i.entregada.productoId === v.productoId ? "otro sabor" : "otro modelo"}
                </span>
              )}
            </p>
            <p
              className={cn("text-xs", faltaStock ? "text-danger font-medium" : "text-muted")}
              data-testid="stock-entrega"
            >
              {faltaStock
                ? hay === 0
                  ? `Sin stock en ${depositoNombre}`
                  : `Solo hay ${hay} en ${depositoNombre}`
                : `Stock en ${depositoNombre}: ${hay}`}
              {cambio && dif !== 0 && (
                <span
                  className={cn("font-semibold", dif > 0 ? "text-tono-naranja" : "text-tono-oliva")}
                >
                  {" "}
                  · {dif > 0 ? "+" : "−"}
                  {pesos(Math.abs(dif))} c/u
                </span>
              )}
            </p>
          </div>
          {!cambiando && (
            // En pantallas chicas, los botones van abajo y a lo ancho del texto.
            <div className="flex shrink-0 gap-1 max-sm:w-full max-sm:justify-end">
              {cambio && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEntregar(v)}
                  aria-label={`Entregar el mismo sabor de ${v.titulo}`}
                >
                  <Undo2 strokeWidth={1.75} />
                </Button>
              )}
              <Button
                variant={faltaStock ? "primary" : "secondary"}
                size="sm"
                onClick={onAbrirCambio}
              >
                <RefreshCcw strokeWidth={1.75} /> Cambiar
              </Button>
            </div>
          )}
        </div>
        {cambiando && depositoId && (
          <SelectorCambio
            devuelto={v}
            actual={i.entregada}
            depositoId={depositoId}
            depositoNombre={depositoNombre}
            onElegir={onEntregar}
            onCancelar={onCerrarCambio}
          />
        )}
      </div>
    </li>
  );
}

/** Elegir lo que se entrega: otro sabor del mismo modelo (con stock) u otro modelo. */
function SelectorCambio({
  devuelto,
  actual,
  depositoId,
  depositoNombre,
  onElegir,
  onCancelar,
}: {
  devuelto: VarianteEncontrada;
  actual: VarianteEncontrada;
  depositoId: string;
  depositoNombre: string;
  onElegir: (v: VarianteEncontrada) => void;
  onCancelar: () => void;
}) {
  const [sabores, setSabores] = useState<VarianteEncontrada[] | null>(null);
  useEffect(() => {
    let vigente = true;
    void otrosSaboresAction({ varianteId: devuelto.varianteId, depositoId }).then((r) => {
      if (vigente) setSabores(r.ok ? r.data : []);
    });
    return () => {
      vigente = false;
    };
  }, [devuelto.varianteId, depositoId]);

  const dif = (v: VarianteEncontrada) => centavos(v.precioVenta) - centavos(devuelto.precioVenta);
  const mismoDisponible = stockEn(devuelto, depositoId) > 0;

  return (
    <div className="border-border mt-1 flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">¿Qué se lleva a cambio?</p>
        <Button variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>

      {mismoDisponible && actual.varianteId !== devuelto.varianteId && (
        <OpcionCambio
          titulo={`El mismo sabor (${devuelto.sabor ?? devuelto.titulo})`}
          detalle={`Stock: ${stockEn(devuelto, depositoId)}`}
          onClick={() => onElegir(devuelto)}
        />
      )}

      <div className="flex flex-col gap-2">
        <p className="text-muted text-xs font-medium tracking-wide uppercase">
          Otro sabor de {devuelto.nombreCompleto}
        </p>
        {sabores === null ? (
          <p className="text-muted text-sm">Buscando sabores con stock…</p>
        ) : sabores.length === 0 ? (
          <p className="text-muted text-sm">
            No hay otros sabores de este modelo con stock en {depositoNombre}.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sabores.map((s) => (
              <OpcionCambio
                key={s.varianteId}
                titulo={s.sabor ?? s.titulo}
                detalle={`Stock: ${stockEn(s, depositoId)}`}
                diferencia={dif(s)}
                activo={actual.varianteId === s.varianteId}
                onClick={() => onElegir(s)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-muted text-xs font-medium tracking-wide uppercase">Otro modelo</p>
        <VariantePicker
          onSelect={(v) => onElegir(v)}
          depositoId={depositoId}
          soloConStock
          yaAgregadas={new Set([devuelto.varianteId])}
          placeholder="Buscar otro modelo con stock…"
        />
        <p className="text-muted text-xs">
          Si es más caro, el cliente paga la diferencia; si es más barato, se le devuelve.
        </p>
      </div>
    </div>
  );
}

function OpcionCambio({
  titulo,
  detalle,
  diferencia = 0,
  activo = false,
  onClick,
}: {
  titulo: string;
  detalle: string;
  diferencia?: number;
  activo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "rounded-control bg-surface flex min-h-12 items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition-colors",
        activo
          ? "border-marca-azul ring-marca-azul ring-1 ring-inset"
          : "border-input hover:border-marca-azul/50",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{titulo}</span>
        <span className="text-muted text-xs">{detalle}</span>
      </span>
      {diferencia !== 0 && (
        <span
          className={cn(
            "rounded-inner shrink-0 px-1.5 py-0.5 text-xs font-semibold tabular-nums",
            diferencia > 0
              ? "bg-tono-naranja-suave text-tono-naranja"
              : "bg-tono-oliva-suave text-tono-oliva",
          )}
        >
          {diferencia > 0 ? "+" : "−"}
          {pesos(Math.abs(diferencia))}
        </span>
      )}
    </button>
  );
}

/** "El cliente paga $X" / "Hay que devolverle $X" (centavos). */
function ResumenDiferencia({
  diferencia,
  montoFinal,
  className,
}: {
  diferencia: number;
  montoFinal?: number;
  className?: string;
}) {
  const cobra = diferencia > 0;
  const bonificado = montoFinal !== undefined && montoFinal !== Math.abs(diferencia);
  return (
    <div
      className={cn(
        "rounded-control flex items-center justify-between gap-3 px-4 py-3",
        cobra ? "bg-tono-naranja-suave" : "bg-tono-oliva-suave",
        className,
      )}
      data-testid="diferencia-devolucion"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {cobra ? "El cliente paga la diferencia" : "Hay que devolverle al cliente"}
        </p>
        <p className="text-muted text-xs">
          {bonificado
            ? `Diferencia de ${pesos(Math.abs(diferencia))}, bonificado.`
            : "Diferencia de precio de lista entre lo que devuelve y lo que se lleva."}
        </p>
      </div>
      <p
        className={cn(
          "text-h3 shrink-0 font-bold tabular-nums",
          cobra ? "text-tono-naranja" : "text-tono-oliva",
        )}
      >
        {pesos(montoFinal ?? Math.abs(diferencia))}
      </p>
    </div>
  );
}

function OpcionVenta({
  activa,
  onClick,
  disabled = false,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-control flex min-h-12 w-full flex-col items-start gap-0.5 border px-4 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
  const todoDevuelto = venta.items.every((i) => i.cantidad - i.devuelto <= 0);
  return (
    <>
      <span className="font-semibold">
        <span className="font-mono">{venta.codigo}</span>{" "}
        <span className="text-muted font-normal">· {formatearFecha(venta.fecha)}</span>
        {todoDevuelto && <span className="text-muted font-normal"> · ya se devolvió todo</span>}
      </span>
      <span className="text-muted line-clamp-2 text-xs">
        {venta.items
          .map(
            (i) =>
              `${i.cantidad} × ${i.titulo}` + (i.devuelto > 0 ? ` (${i.devuelto} devuelto)` : ""),
          )
          .join(", ")}
      </span>
    </>
  );
}
