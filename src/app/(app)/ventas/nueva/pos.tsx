"use client";

import { Camera, Minus, Plus, Save, ShoppingCart, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { VarianteEscaneada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientePos } from "@/server/services/cliente.service";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoRapido, VentaConfirmada } from "@/server/services/venta.service";

import {
  guardarBorradorAction,
  productosRapidosAction,
  venderAction,
  variantesPosAction,
} from "../actions";
import { BuscadorPos } from "./buscador-pos";
import { ClienteSelector } from "./cliente-selector";
import { CobroPanel, type PagoAEnviar } from "./cobro-panel";
import { GrillaRapida } from "./grilla-rapida";
import { calcularTotales, num, precioDe, type DescuentoGlobal, type ItemCarrito } from "./tipos";
import { VentaExitosa } from "./venta-exitosa";

export interface EstadoInicialPos {
  borradorId: string;
  borradorNumero: number;
  depositoId: string;
  cliente: ClientePos | null;
  descuento: DescuentoGlobal | null;
  notas: string;
  items: ItemCarrito[];
}

interface Carrito {
  borradorId: string | null;
  depositoId: string;
  cliente: ClientePos | null;
  items: ItemCarrito[];
  descuento: DescuentoGlobal | null;
  notas: string;
}

const CLAVE_CARRITO = "pos.carrito";
const CLAVE_DEPOSITO = "pos.deposito";

function leer<T>(clave: string): T | null {
  try {
    const v = localStorage.getItem(clave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function escribir(clave: string, valor: unknown) {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* modo privado / sin espacio: el POS sigue funcionando sin persistir */
  }
}

/** ≥ lg: cobro inline en la columna derecha; en el celular, Sheet. */
function useEsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const cambiar = () => setDesktop(mq.matches);
    cambiar();
    mq.addEventListener("change", cambiar);
    return () => mq.removeEventListener("change", cambiar);
  }, []);
  return desktop;
}

export function Pos({
  depositos,
  depositoInicial,
  depositoFijadoPorUrl,
  grillaInicial,
  inicial,
  clienteInicial,
  puedeEditar,
  redondeoConfig,
  nombreNegocio,
}: {
  depositos: DepositoBasico[];
  depositoInicial: string;
  depositoFijadoPorUrl: boolean;
  grillaInicial: ProductoRapido[];
  inicial: EstadoInicialPos | null;
  clienteInicial: ClientePos | null;
  puedeEditar: boolean;
  redondeoConfig: number;
  nombreNegocio: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const esDesktop = useEsDesktop();
  const buscador = useRef<HTMLInputElement>(null);

  const vacio = useCallback(
    (depositoId: string): Carrito => ({
      borradorId: null,
      depositoId,
      cliente: null,
      items: [],
      descuento: null,
      notas: "",
    }),
    [],
  );
  const [carrito, setCarrito] = useState<Carrito>(() =>
    inicial
      ? { ...inicial, borradorId: inicial.borradorId }
      : { ...vacio(depositoInicial), cliente: clienteInicial },
  );
  const [grilla, setGrilla] = useState(grillaInicial);
  const [cobrando, setCobrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [redondear, setRedondear] = useState(redondeoConfig > 0);
  const [exito, setExito] = useState<{
    venta: VentaConfirmada;
    vuelto: number;
    cliente: ClientePos | null;
  } | null>(null);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);
  const restaurado = useRef(false);

  const { depositoId, items, cliente, descuento, notas } = carrito;
  const deposito = depositos.find((d) => d.id === depositoId);
  const totales = useMemo(
    () => calcularTotales(items, descuento, redondear ? redondeoConfig : 0),
    [items, descuento, redondear, redondeoConfig],
  );
  const enCarrito = useMemo(() => new Map(items.map((i) => [i.varianteId, i.cantidad])), [items]);
  const sinStock = items.filter((i) => i.cantidad > i.stock);

  // --- Persistencia (sobrevive a cerrar la app) -------------------------------------
  useEffect(() => {
    if (!inicial && !clienteInicial) {
      const guardado = leer<Carrito>(CLAVE_CARRITO);
      const depGuardado = leer<string>(CLAVE_DEPOSITO);
      if (
        guardado &&
        guardado.items.length > 0 &&
        depositos.some((d) => d.id === guardado.depositoId)
      ) {
        setCarrito(guardado);
        toast.info("Se recuperó la venta en curso", `${guardado.items.length} producto(s)`);
      } else if (
        !depositoFijadoPorUrl &&
        depGuardado &&
        depGuardado !== depositoInicial &&
        depositos.some((d) => d.id === depGuardado)
      ) {
        setCarrito((c) => ({ ...c, depositoId: depGuardado }));
      }
    }
    restaurado.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);
  useEffect(() => {
    if (!restaurado.current) return;
    escribir(CLAVE_CARRITO, carrito.items.length || carrito.borradorId ? carrito : null);
    escribir(CLAVE_DEPOSITO, carrito.depositoId);
  }, [carrito]);

  // Grilla y stock del carrito según el depósito.
  const depositoPrevio = useRef(depositoInicial);
  useEffect(() => {
    if (depositoPrevio.current === depositoId) return;
    depositoPrevio.current = depositoId;
    void productosRapidosAction({ depositoId }).then((r) => r.ok && setGrilla(r.data));
    void refrescarCarrito(depositoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositoId]);

  /** Precio de lista y stock actuales (al cambiar depósito y antes de cobrar). */
  async function refrescarCarrito(dep = depositoId): Promise<boolean> {
    if (carrito.items.length === 0) return true;
    const r = await variantesPosAction({
      ids: carrito.items.map((i) => i.varianteId),
      depositoId: dep,
    });
    if (!r.ok) return false;
    const porId = new Map(r.data.map((v) => [v.varianteId, v]));
    let cambioPrecio = false;
    setCarrito((c) => ({
      ...c,
      items: c.items.map((i) => {
        const v = porId.get(i.varianteId);
        if (!v) return i;
        if (v.precioVenta !== i.precioLista && !i.precioManual) cambioPrecio = true;
        return { ...i, precioLista: v.precioVenta, stock: v.stock };
      }),
    }));
    if (cambioPrecio)
      toast.info("Se actualizaron precios", "Algún producto cambió de precio de lista.");
    return true;
  }

  // --- Carrito -----------------------------------------------------------------------
  const agregar = useCallback(
    (v: {
      varianteId: string;
      nombreCompleto: string;
      sku: string;
      precioVenta: string;
      stock: number;
    }) => {
      setErrorVenta(null);
      setCarrito((c) => {
        const existente = c.items.find((i) => i.varianteId === v.varianteId);
        const items = existente
          ? c.items.map((i) =>
              i.varianteId === v.varianteId
                ? { ...i, cantidad: i.cantidad + 1, stock: v.stock }
                : i,
            )
          : [
              {
                varianteId: v.varianteId,
                nombreCompleto: v.nombreCompleto,
                sku: v.sku,
                precioLista: v.precioVenta,
                precioManual: null,
                cantidad: 1,
                stock: v.stock,
              },
              ...c.items,
            ];
        return { ...c, items };
      });
    },
    [],
  );
  const cambiarItem = (varianteId: string, cambios: Partial<ItemCarrito>) =>
    setCarrito((c) => ({
      ...c,
      items: c.items.map((i) => (i.varianteId === varianteId ? { ...i, ...cambios } : i)),
    }));
  const quitar = (varianteId: string) =>
    setCarrito((c) => ({ ...c, items: c.items.filter((i) => i.varianteId !== varianteId) }));

  // Escáner siempre activo (pistola vía ScannerProvider + cámara).
  const stockEn = (v: VarianteEscaneada) =>
    v.stock.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;
  const escaner = useEscanerVariantes({
    onVariante: (v) =>
      agregar({
        varianteId: v.varianteId,
        nombreCompleto: v.nombreCompleto,
        sku: v.sku,
        precioVenta: v.precioVenta,
        stock: stockEn(v),
      }),
    validar: (v) => {
      if (!v.activo) return "Producto inactivo: no se puede vender";
      const disponible = stockEn(v);
      const yaEnCarrito = enCarrito.get(v.varianteId) ?? 0;
      if (disponible <= yaEnCarrito)
        return disponible === 0
          ? `Sin stock en ${deposito?.nombre}`
          : `Solo hay ${disponible} en ${deposito?.nombre}`;
      return null;
    },
    habilitado: !exito,
    permitirRafaga: true,
    tituloCamara: "Escaneá para vender",
  });

  // --- Atajos de escritorio (no interfieren con la pistola: F2/F9/Esc no son caracteres) --
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        buscador.current?.focus();
      } else if (e.key === "F9") {
        e.preventDefault();
        void abrirCobro();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  });

  async function abrirCobro() {
    if (items.length === 0 || exito) return;
    await refrescarCarrito();
    if (esDesktop) {
      document
        .querySelector<HTMLInputElement>('[aria-label="Efectivo recibido"], [aria-label^="Monto "]')
        ?.select();
    } else setCobrando(true);
  }

  function datosVenta() {
    return {
      depositoId,
      clienteId: cliente?.id,
      notas: notas.trim() || undefined,
      descuentoGlobal:
        descuento && num(descuento.valor) > 0
          ? { tipo: descuento.tipo, valor: num(descuento.valor) }
          : undefined,
      items: items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        ...(i.precioManual !== null ? { precioUnitario: num(i.precioManual) } : {}),
      })),
    };
  }

  async function confirmar(pagos: PagoAEnviar[], meta: { fiado: boolean; vuelto: number }) {
    setErrorVenta(null);
    // Nada de ventas sin red: el stock y el cobro se validan en el servidor en el momento.
    if (!navigator.onLine) {
      const msg = "Las ventas necesitan conexión para validar stock y registrar el pago.";
      setErrorVenta(msg);
      toast.error("Sin conexión", msg);
      return;
    }
    setEnviando(true);
    const r = await venderAction({
      borradorId: carrito.borradorId ?? undefined,
      venta: datosVenta(),
      pagos,
      redondearA: redondear ? redondeoConfig : 0,
    });
    setEnviando(false);
    if (!r.ok) {
      setErrorVenta(r.error.message);
      toast.error("No se pudo confirmar la venta", r.error.message);
      if (r.error.code === "STOCK_INSUFICIENTE") void refrescarCarrito();
      return;
    }
    setCobrando(false);
    setExito({ venta: r.data, vuelto: meta.fiado ? 0 : meta.vuelto, cliente });
    setCarrito(vacio(depositoId));
    escribir(CLAVE_CARRITO, null);
    router.refresh();
  }

  async function guardarBorrador() {
    setGuardando(true);
    const r = await guardarBorradorAction({
      borradorId: carrito.borradorId ?? undefined,
      venta: datosVenta(),
    });
    setGuardando(false);
    if (!r.ok) return toast.error("No se pudo guardar el borrador", r.error.message);
    toast.success(`Borrador #${r.data.numero} guardado`, "Retomalo desde Ventas → Borradores.");
    setCarrito(vacio(depositoId));
    escribir(CLAVE_CARRITO, null);
    if (carrito.borradorId) router.replace("/ventas/nueva");
  }

  function nuevaVenta() {
    setExito(null);
    if (carrito.borradorId || inicial) router.replace("/ventas/nueva");
    setTimeout(() => buscador.current?.focus(), 50);
  }

  if (exito) {
    return (
      <VentaExitosa
        venta={exito.venta}
        vuelto={exito.vuelto}
        cliente={exito.cliente}
        nombreNegocio={nombreNegocio}
        onNueva={nuevaVenta}
      />
    );
  }

  const cobro = (
    <CobroPanel
      totales={totales}
      redondeoConfig={redondeoConfig}
      redondear={redondear}
      onRedondear={setRedondear}
      descuento={descuento}
      onDescuento={(d) => setCarrito((c) => ({ ...c, descuento: d }))}
      puedeEditar={puedeEditar}
      cliente={cliente}
      enviando={enviando}
      onConfirmar={(p, m) => void confirmar(p, m)}
      autoFocus={!esDesktop}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_26rem] lg:pb-0">
      {/* Izquierda: depósito, cliente, escáner, búsqueda y grilla */}
      <div className="flex min-w-0 flex-col gap-3">
        {carrito.borradorId && (
          <p className="bg-primary-soft text-primary-soft-foreground rounded-lg px-3 py-2 text-sm">
            Retomando el borrador #{inicial?.borradorNumero}. Al cobrar se confirma ese mismo
            número.
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
          <Select
            aria-label="Depósito de venta"
            options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
            value={depositoId}
            onChange={(e) => setCarrito((c) => ({ ...c, depositoId: e.target.value }))}
          />
          <ClienteSelector
            cliente={cliente}
            onCambio={(c) => setCarrito((x) => ({ ...x, cliente: c }))}
          />
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <BuscadorPos
              depositoId={depositoId}
              enCarrito={enCarrito}
              onElegir={(v) => agregar(v)}
              inputRef={buscador}
            />
          </div>
          <Button
            variant="secondary"
            className="h-11 shrink-0 px-4"
            onClick={escaner.abrirCamara}
            aria-label="Escanear con la cámara"
          >
            <Camera /> <span className="max-sm:hidden">Cámara</span>
          </Button>
        </div>
        <p className="text-muted text-xs">
          La pistola funciona siempre, sin tocar nada. Cada escaneo suma 1.
        </p>
        <GrillaRapida
          productos={grilla}
          enCarrito={enCarrito}
          onElegir={(v) => agregar({ ...v, precioVenta: v.precioVenta })}
        />
      </div>

      {/* Derecha: carrito (+ cobro inline en escritorio) */}
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <section aria-label="Carrito" className="border-border bg-surface rounded-2xl border">
          <header className="border-border flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">
              Carrito <span className="text-muted font-normal">· {totales.unidades} u.</span>
            </h2>
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() =>
                  setCarrito((c) => ({
                    ...vacio(c.depositoId),
                    cliente: c.cliente,
                    borradorId: c.borradorId,
                  }))
                }
              >
                Vaciar
              </Button>
            )}
          </header>
          {items.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="Escaneá o tocá un producto"
              description="Pistola, cámara, buscador o los más vendidos."
              className="border-0"
            />
          ) : (
            <ul aria-label="Productos de la venta" className="divide-border divide-y">
              {items.map((i) => {
                const falta = i.cantidad > i.stock;
                return (
                  <li
                    key={i.varianteId}
                    className={cn("flex flex-col gap-2 px-4 py-3", falta && "bg-danger-soft/50")}
                    data-sin-stock={falta || undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="leading-tight font-medium">{i.nombreCompleto}</p>
                        <p
                          className={cn(
                            "text-xs",
                            falta ? "text-danger font-semibold" : "text-muted",
                          )}
                        >
                          {falta
                            ? `Solo hay ${i.stock} en ${deposito?.nombre}`
                            : `${i.stock} en stock`}
                          {i.precioManual !== null && (
                            <span className="text-warning-soft-foreground">
                              {" "}
                              · precio modificado
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-danger -mt-1 -mr-2 shrink-0"
                        onClick={() => quitar(i.varianteId)}
                        aria-label={`Quitar ${i.nombreCompleto}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="icon"
                          className="size-10"
                          onClick={() =>
                            cambiarItem(i.varianteId, { cantidad: Math.max(1, i.cantidad - 1) })
                          }
                          aria-label={`Una menos de ${i.nombreCompleto}`}
                        >
                          <Minus />
                        </Button>
                        <CantidadInput
                          etiqueta={`Cantidad de ${i.nombreCompleto}`}
                          valor={i.cantidad}
                          onCambio={(n) => cambiarItem(i.varianteId, { cantidad: n })}
                          className="h-10 w-14 px-1 text-base font-semibold"
                        />
                        <Button
                          variant="secondary"
                          size="icon"
                          className="size-10"
                          onClick={() => cambiarItem(i.varianteId, { cantidad: i.cantidad + 1 })}
                          aria-label={`Una más de ${i.nombreCompleto}`}
                        >
                          <Plus />
                        </Button>
                      </div>
                      <div className="text-right">
                        {puedeEditar ? (
                          <input
                            inputMode="decimal"
                            aria-label={`Precio de ${i.nombreCompleto}`}
                            className={cn(
                              controlClass,
                              "h-8 w-24 px-2 text-right text-xs tabular-nums",
                            )}
                            value={i.precioManual ?? String(num(i.precioLista))}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^\d.,]/g, "");
                              cambiarItem(i.varianteId, {
                                precioManual: v === "" || num(v) === num(i.precioLista) ? null : v,
                              });
                            }}
                          />
                        ) : (
                          <p className="text-muted text-xs tabular-nums">
                            {formatearPesos(precioDe(i))} c/u
                          </p>
                        )}
                        <p className="font-semibold tabular-nums">
                          {formatearPesos(precioDe(i) * i.cantidad)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 0 && (
            <div className="border-border flex flex-col gap-2 border-t px-4 py-3">
              <Textarea
                label="Notas de la venta"
                rows={2}
                value={notas}
                onChange={(e) => setCarrito((c) => ({ ...c, notas: e.target.value }))}
                placeholder="Opcional"
              />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => void guardarBorrador()}
                loading={guardando}
              >
                <Save /> Guardar como borrador
              </Button>
            </div>
          )}
        </section>

        {errorVenta && (
          <p
            role="alert"
            className="bg-danger-soft text-danger-soft-foreground rounded-xl px-4 py-3 text-sm"
          >
            {errorVenta}
          </p>
        )}
        {sinStock.length > 0 && (
          <p className="text-danger text-sm">
            Hay {sinStock.length} producto(s) sin stock suficiente en {deposito?.nombre}: ajustá la
            cantidad para cobrar.
          </p>
        )}

        {esDesktop && items.length > 0 && sinStock.length === 0 && (
          <section aria-label="Cobro" className="border-border bg-surface rounded-2xl border p-4">
            {cobro}
          </section>
        )}
      </div>

      {/* Barra inferior (celular): total + Cobrar */}
      {!esDesktop && (
        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-muted text-xs">{totales.unidades} u.</p>
            <p className="text-2xl leading-none font-bold tabular-nums" data-testid="total-pos">
              {formatearPesos(totales.total)}
            </p>
          </div>
          <Button
            size="lg"
            className="px-8"
            onClick={() => void abrirCobro()}
            disabled={items.length === 0 || sinStock.length > 0}
          >
            Cobrar
          </Button>
        </div>
      )}

      {!esDesktop && (
        <Sheet open={cobrando} onOpenChange={setCobrando} title="Cobrar">
          {cobrando && cobro}
        </Sheet>
      )}

      {escaner.ui}
    </div>
  );
}
