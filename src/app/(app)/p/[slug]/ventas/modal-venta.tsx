"use client";

import type { MedioPago } from "@prisma/client";
import { ArrowLeft, Check, Warehouse, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useDialogElement } from "@/components/ui/use-dialog-element";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VentaGenerada } from "@/server/services/venta.service";

import { generarVentaAction, stockVentaAction, unidadesPorDepositoAction } from "./actions";
import {
  ETIQUETA_PASO,
  guardarVentaEnCurso,
  MENSAJE_SIN_CONEXION,
  montoTipeado,
  PASOS,
  totalesVenta,
  useEnLinea,
  ventaTieneDatos,
  ventaVacia,
  type Paso,
  type VentaEnCurso,
} from "./estado-venta";
import { PasoPago } from "./paso-pago";
import { ID_BUSCADOR_VENTA, PasoProductos, type SaborParaVenta } from "./paso-productos";
import { VentaExitosa } from "./venta-exitosa";

export interface DepositoVenta {
  id: string;
  nombre: string;
  esPrincipal: boolean;
}

/**
 * "Generar venta": modal a pantalla completa en el celular y centrado grande
 * en desktop. Pasos: galpón → productos → cliente → pago → éxito. Se puede
 * volver a cualquier paso anterior. El estado se guarda en localStorage (por
 * panel y usuario) para retomarlo. Desktop: F2 buscar, F9 confirmar, Esc cerrar.
 */
export function ModalVenta({
  abierto,
  inicial,
  depositos,
  unidadesIniciales,
  puedeEditar,
  puedeAltaProductos,
  claveStorage,
  onCerrado,
}: {
  abierto: boolean;
  inicial: VentaEnCurso;
  depositos: DepositoVenta[];
  unidadesIniciales: Record<string, number>;
  puedeEditar: boolean;
  puedeAltaProductos: boolean;
  claveStorage: string;
  onCerrado: () => void;
}) {
  const router = useRouter();
  const enLinea = useEnLinea();
  const idTitulo = useId();
  const [venta, setVenta] = useState<VentaEnCurso>(inicial);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [unidades, setUnidades] = useState(unidadesIniciales);
  const [exito, setExito] = useState<VentaGenerada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoCliente, setAvisoCliente] = useState<string | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [subdialogo, setSubdialogo] = useState(false);
  const ventaRef = useRef(venta);
  ventaRef.current = venta;

  // Cada apertura arranca del estado que manda la página (nueva o retomada).
  useEffect(() => {
    if (!abierto) return;
    setVenta(inicial);
    setStock({});
    setExito(null);
    setError(null);
    setAvisoCliente(null);
    void unidadesPorDepositoAction().then((r) => r.ok && setUnidades(r.data));
  }, [abierto, inicial]);

  // Persistencia para "Retomar venta en curso".
  useEffect(() => {
    if (!abierto || exito) return;
    if (ventaTieneDatos(venta) || venta.paso !== "galpon") guardarVentaEnCurso(claveStorage, venta);
  }, [abierto, venta, exito, claveStorage]);

  const deposito = depositos.find((d) => d.id === venta.depositoId) ?? null;
  const totales = totalesVenta(venta.items, puedeEditar ? venta.descuento : "");

  const refrescarStock = useCallback(async (depositoId: string, ids: string[]) => {
    if (ids.length === 0) return {};
    const r = await stockVentaAction({ depositoId, ids });
    if (!r.ok) return null;
    setStock((s) => ({ ...s, ...r.data }));
    return r.data;
  }, []);

  // Al cambiar de galpón (o retomar), el stock de lo que ya está en la venta se vuelve a leer.
  useEffect(() => {
    if (!abierto || !venta.depositoId) return;
    setStock({});
    void refrescarStock(
      venta.depositoId,
      ventaRef.current.items.map((i) => i.varianteId),
    );
  }, [abierto, venta.depositoId, refrescarStock]);

  const cambiar = (parcial: Partial<VentaEnCurso>) => setVenta((v) => ({ ...v, ...parcial }));
  const irA = (paso: Paso) => {
    setError(null);
    cambiar({ paso });
  };

  function cerrar(descartar: boolean) {
    if (descartar) guardarVentaEnCurso(claveStorage, null);
    setConfirmarCierre(false);
    onCerrado();
  }

  function solicitarCerrar() {
    if (enviando) return;
    if (exito || !ventaTieneDatos(venta)) cerrar(true);
    else setConfirmarCierre(true);
  }

  const { ref, onBackdropClick } = useDialogElement(abierto, (o) => !o && solicitarCerrar());

  // --- Productos ------------------------------------------------------------------

  const agregar = useCallback(
    (s: SaborParaVenta) => {
      setVenta((v) => {
        const existe = v.items.find((i) => i.varianteId === s.varianteId);
        const items = existe
          ? v.items.map((i) =>
              i.varianteId === s.varianteId ? { ...i, cantidad: i.cantidad + 1 } : i,
            )
          : [
              ...v.items,
              {
                varianteId: s.varianteId,
                productoId: s.productoId,
                titulo: s.titulo,
                precioLista: s.precioVenta,
                cantidad: 1,
                precioEspecial: null,
              },
            ];
        return { ...v, items };
      });
      if (s.stock !== undefined) setStock((st) => ({ ...st, [s.varianteId]: s.stock! }));
      const depositoId = ventaRef.current.depositoId;
      if (depositoId) void refrescarStock(depositoId, [s.varianteId]);
    },
    [refrescarStock],
  );

  const excedidos = venta.items.filter(
    (i) => stock[i.varianteId] === undefined || i.cantidad > stock[i.varianteId]!,
  );

  async function continuarDesdeProductos() {
    if (!venta.depositoId || venta.items.length === 0) return;
    const r = await refrescarStock(
      venta.depositoId,
      venta.items.map((i) => i.varianteId),
    );
    if (!r) {
      setError("No se pudo verificar el stock. Probá de nuevo.");
      return;
    }
    const falta = venta.items.find((i) => i.cantidad > (r[i.varianteId] ?? 0));
    if (falta) {
      setError(`No hay stock suficiente de ${falta.titulo} en ${deposito?.nombre ?? "el galpón"}.`);
      return;
    }
    irA("cliente");
  }

  // --- Confirmar ------------------------------------------------------------------

  const puedeConfirmar =
    enLinea &&
    !enviando &&
    venta.medioPago !== null &&
    venta.cliente !== null &&
    venta.items.length > 0 &&
    !!venta.depositoId &&
    (!puedeEditar || venta.descuento.trim() === "" || montoTipeado(venta.descuento) !== null);

  async function confirmar() {
    if (!puedeConfirmar || !venta.cliente || !venta.medioPago || !venta.depositoId) return;
    setEnviando(true);
    setError(null);
    const cliente: ClienteElegido = venta.cliente;
    const descuento = puedeEditar ? montoTipeado(venta.descuento) : null;
    const r = await generarVentaAction({
      depositoId: venta.depositoId,
      cliente:
        cliente.tipo === "existente"
          ? { id: cliente.id }
          : { nuevo: { nombre: cliente.nombre, telefono: cliente.telefono } },
      items: venta.items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        ...(i.precioEspecial !== null ? { precioEspecial: i.precioEspecial } : {}),
      })),
      medioPago: venta.medioPago,
      ...(descuento && Number(descuento) > 0 ? { descuento } : {}),
      notas: venta.notas,
    }).catch(() => null);
    setEnviando(false);
    if (!r) {
      setError("Sin conexión con el servidor. La venta NO se registró: probá de nuevo.");
      return;
    }
    if (!r.ok) {
      if (r.error.code === "STOCK_INSUFICIENTE") {
        setError(r.error.message);
        setVenta((v) => ({ ...v, paso: "productos" }));
        void refrescarStock(
          venta.depositoId,
          venta.items.map((i) => i.varianteId),
        );
        return;
      }
      setError(r.error.message);
      return;
    }
    if (r.data.tipo === "cliente_duplicado") {
      const c = r.data.cliente;
      setVenta((v) => ({ ...v, paso: "cliente", cliente: { tipo: "existente", ...c } }));
      setAvisoCliente(`${r.data.mensaje}. Lo seleccionamos: revisá que sea él y seguí.`);
      return;
    }
    guardarVentaEnCurso(claveStorage, null);
    invalidarResoluciones();
    setExito(r.data.venta);
    router.refresh();
  }

  function nuevaVenta() {
    const depositoId = venta.depositoId;
    setExito(null);
    setStock({});
    setError(null);
    setAvisoCliente(null);
    setVenta({ ...ventaVacia(depositoId), paso: depositoId ? "productos" : "galpon" });
  }

  // --- Teclado (desktop): F2 buscar, F9 confirmar ------------------------------------

  const confirmarRef = useRef(confirmar);
  confirmarRef.current = confirmar;
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        if (ventaRef.current.paso === "productos")
          document.getElementById(ID_BUSCADOR_VENTA)?.focus();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (ventaRef.current.paso === "pago") void confirmarRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  const indicePaso = PASOS.indexOf(venta.paso);

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-labelledby={idTitulo}
      data-testid="modal-venta"
      className={cn(
        "anim-dialog bg-surface text-foreground shadow-sheet m-0 h-dvh max-h-none w-full max-w-none p-0",
        "md:m-auto md:h-[min(92dvh,60rem)] md:w-[min(72rem,calc(100%-3rem))] md:rounded-2xl",
      )}
    >
      {abierto && (
        <div className="flex h-full flex-col">
          <header className="border-border flex flex-col gap-3 border-b px-4 pt-3 pb-3 md:px-6 md:pt-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <h2 id={idTitulo} className="text-xl font-semibold tracking-tight">
                  {exito ? "Venta registrada" : "Generar venta"}
                </h2>
                {deposito && !exito && venta.paso !== "galpon" && (
                  <button
                    type="button"
                    onClick={() => irA("galpon")}
                    className="bg-primary-soft text-primary-soft-foreground inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium"
                    aria-label={`Galpón: ${deposito.nombre}. Cambiar`}
                    data-testid="galpon-venta"
                  >
                    <Warehouse className="size-4" strokeWidth={1.75} aria-hidden />
                    <span className="truncate">{deposito.nombre}</span>
                  </button>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={solicitarCerrar}
                aria-label="Cerrar"
                className="-mr-2 shrink-0"
              >
                <X strokeWidth={1.75} />
              </Button>
            </div>
            {!exito && (
              <ol aria-label="Pasos de la venta" className="grid grid-cols-4 gap-1.5">
                {PASOS.map((p, n) => {
                  const hecho = n < indicePaso;
                  const actual = n === indicePaso;
                  return (
                    <li key={p}>
                      <button
                        type="button"
                        disabled={!hecho}
                        onClick={() => irA(p)}
                        aria-current={actual ? "step" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-1.5 text-left text-xs font-medium disabled:cursor-default",
                          actual ? "text-foreground" : hecho ? "text-primary" : "text-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 rounded-full",
                            actual || hecho ? "bg-primary" : "bg-surface-2",
                          )}
                        />
                        <span className="flex items-center gap-1">
                          {hecho && <Check className="size-3.5" strokeWidth={2} aria-hidden />}
                          {n + 1}. {ETIQUETA_PASO[p]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </header>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
            {!enLinea && !exito ? (
              <div
                role="alert"
                className="bg-warning-soft text-warning-soft-foreground flex flex-col items-center gap-3 rounded-2xl px-6 py-10 text-center"
              >
                <WifiOff className="size-10" strokeWidth={1.75} aria-hidden />
                <p className="text-lg font-semibold">Sin conexión</p>
                <p className="max-w-md text-sm">{MENSAJE_SIN_CONEXION}.</p>
                <p className="max-w-md text-xs">
                  La venta en curso quedó guardada: cuando vuelva la señal, seguís desde acá.
                </p>
              </div>
            ) : exito ? (
              <VentaExitosa venta={exito} />
            ) : (
              <>
                {error && (
                  <p
                    role="alert"
                    className="bg-danger-soft text-danger-soft-foreground mb-4 rounded-xl px-4 py-3 text-sm"
                  >
                    {error}
                  </p>
                )}
                {venta.paso === "galpon" && (
                  <SelectorGalpon
                    key={venta.depositoId ?? "sin-galpon"}
                    depositos={depositos}
                    unidades={unidades}
                    preseleccionadoId={venta.depositoId}
                    titulo="¿Desde qué galpón vendés?"
                    descripcion="El stock se descuenta de este galpón."
                    onConfirmar={(depositoId) => {
                      setError(null);
                      cambiar({ depositoId, paso: "productos" });
                    }}
                  />
                )}
                {venta.paso === "productos" && deposito && (
                  <PasoProductos
                    deposito={deposito}
                    items={venta.items}
                    stock={stock}
                    puedeEditar={puedeEditar}
                    puedeAltaProductos={puedeAltaProductos}
                    escanerActivo={enLinea && !confirmarCierre}
                    onAgregar={agregar}
                    onSubdialogo={setSubdialogo}
                    onCantidad={(varianteId, cantidad) =>
                      setVenta((v) => ({
                        ...v,
                        items: v.items.map((i) =>
                          i.varianteId === varianteId
                            ? { ...i, cantidad: Math.max(1, cantidad) }
                            : i,
                        ),
                      }))
                    }
                    onQuitar={(varianteId) =>
                      setVenta((v) => ({
                        ...v,
                        items: v.items.filter((i) => i.varianteId !== varianteId),
                      }))
                    }
                    onPrecioEspecial={(varianteId, precio) =>
                      setVenta((v) => ({
                        ...v,
                        items: v.items.map((i) =>
                          i.varianteId === varianteId ? { ...i, precioEspecial: precio } : i,
                        ),
                      }))
                    }
                  />
                )}
                {venta.paso === "cliente" && (
                  <div className="mx-auto flex max-w-xl flex-col gap-4">
                    {avisoCliente && (
                      <p
                        role="status"
                        className="bg-warning-soft text-warning-soft-foreground rounded-xl px-4 py-3 text-sm"
                      >
                        {avisoCliente}
                      </p>
                    )}
                    <SelectorCliente
                      valor={venta.cliente}
                      onCambiar={(cliente) => {
                        if (cliente?.tipo === "existente") setAvisoCliente(null);
                        setVenta((v) => ({ ...v, cliente }));
                      }}
                      permitirNuevo
                    />
                  </div>
                )}
                {venta.paso === "pago" && deposito && venta.cliente && (
                  <PasoPago
                    deposito={deposito.nombre}
                    cliente={venta.cliente}
                    items={venta.items}
                    medioPago={venta.medioPago}
                    descuento={venta.descuento}
                    notas={venta.notas}
                    puedeEditar={puedeEditar}
                    totales={totales}
                    onMedioPago={(medioPago: MedioPago) => cambiar({ medioPago })}
                    onDescuento={(descuento) => cambiar({ descuento })}
                    onNotas={(notas) => cambiar({ notas })}
                  />
                )}
              </>
            )}
          </div>

          <footer className="pb-safe border-border bg-surface flex shrink-0 items-center gap-3 border-t px-4 pt-3 md:px-6 md:pb-4">
            {exito ? (
              <div className="flex w-full flex-col gap-2 md:flex-row md:justify-end">
                <Button variant="secondary" onClick={() => cerrar(true)}>
                  Cerrar
                </Button>
                <Button size="lg" onClick={nuevaVenta}>
                  Nueva venta
                </Button>
              </div>
            ) : (
              <>
                {indicePaso > 0 && (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Volver al paso anterior"
                    onClick={() => irA(PASOS[indicePaso - 1]!)}
                    disabled={enviando}
                  >
                    <ArrowLeft strokeWidth={1.75} />
                  </Button>
                )}
                {venta.paso !== "galpon" && (
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-muted text-xs">
                      {totales.unidades} {totales.unidades === 1 ? "unidad" : "unidades"}
                    </p>
                    <p className="text-lg font-semibold tabular-nums" data-testid="total-venta">
                      {formatearPesos(totales.total)}
                    </p>
                  </div>
                )}
                {venta.paso === "productos" && (
                  <Button
                    size="lg"
                    disabled={
                      !enLinea || venta.items.length === 0 || excedidos.length > 0 || subdialogo
                    }
                    onClick={() => void continuarDesdeProductos()}
                  >
                    Continuar
                  </Button>
                )}
                {venta.paso === "cliente" && (
                  <Button
                    size="lg"
                    disabled={!enLinea || venta.cliente === null}
                    onClick={() => irA("pago")}
                  >
                    Continuar
                  </Button>
                )}
                {venta.paso === "pago" && (
                  <Button
                    size="lg"
                    disabled={!puedeConfirmar}
                    loading={enviando}
                    onClick={() => void confirmar()}
                    title="F9"
                  >
                    Confirmar venta
                  </Button>
                )}
              </>
            )}
          </footer>
        </div>
      )}

      <Dialog
        open={confirmarCierre}
        onOpenChange={setConfirmarCierre}
        title="¿Cerrar la venta en curso?"
        description="Podés guardarla para retomarla después o descartarla."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmarCierre(false)}>
              Seguir vendiendo
            </Button>
            <Button variant="secondary" onClick={() => cerrar(false)}>
              Guardar para después
            </Button>
            <Button variant="danger" onClick={() => cerrar(true)}>
              Descartar venta
            </Button>
          </>
        }
      />
    </dialog>
  );
}
