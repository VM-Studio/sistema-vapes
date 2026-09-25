"use client";

import { Modulo } from "@prisma/client";
import {
  ArrowLeftRight,
  Camera,
  ClipboardCheck,
  Lock,
  Minus,
  PackagePlus,
  Plus,
  ScanBarcode,
  ScanSearch,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ajusteMasivoAction,
  completarTransferenciaAction,
  crearTransferenciaAction,
  ingresoManualAction,
} from "@/app/(app)/movimientos/actions";
import { usePuede, useUsuario } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { resolverVarianteAction } from "@/features/scanner/actions";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import type { VarianteEscaneada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { conSigno, formatearNumero, formatearPesos } from "@/lib/format";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";

type Modo = "consultar" | "ingresar" | "contar" | "transferir";

const MODOS: { id: Modo | "vender"; label: string; icono: typeof ScanSearch }[] = [
  { id: "consultar", label: "Consultar", icono: ScanSearch },
  { id: "ingresar", label: "Ingresar", icono: PackagePlus },
  { id: "contar", label: "Contar", icono: ClipboardCheck },
  { id: "transferir", label: "Transferir", icono: ArrowLeftRight },
  { id: "vender", label: "Vender", icono: ShoppingCart },
];

interface ItemCarrito {
  variante: VarianteEscaneada;
  cantidad: number;
}

interface Sesion {
  modo: Modo;
  depositoId: string;
  destinoId: string;
  items: ItemCarrito[];
  ts: number;
}

const CLAVE_SESION = "escanear.sesion";
const CLAVE_DEPOSITO = "escanear.deposito";
const CLAVE_TECLADO = "escanear.ocultarTeclado";

function leerLocal<T>(clave: string): T | null {
  try {
    const v = localStorage.getItem(clave);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function escribirLocal(clave: string, valor: unknown) {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* modo privado / almacenamiento bloqueado: la sesión simplemente no se guarda */
  }
}

const stockEn = (v: VarianteEscaneada, depositoId: string) =>
  v.stock.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;

function haceCuanto(ts: number): string {
  const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return `${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `${h} hora${h === 1 ? "" : "s"}`;
}

export function EscanearHub({
  depositos,
}: {
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const usuario = useUsuario();

  // --- Permisos por modo ---
  const puedeIngresoManual = usePuede(Modulo.MOVIMIENTOS, "crear");
  const puedeCompra = usePuede(Modulo.COMPRAS, "crear");
  const puedeContar = usePuede(Modulo.MOVIMIENTOS, "editar");
  const puedeTransferir = usePuede(Modulo.MOVIMIENTOS, "crear");
  const puedeVender = usePuede(Modulo.VENTAS, "crear");
  const puedeCompletar = usePuede(Modulo.MOVIMIENTOS, "editar");
  const puedeVerProductos = usePuede(Modulo.PRODUCTOS, "ver");
  const habilitado: Record<Modo, string | null> = {
    consultar: null,
    ingresar:
      puedeIngresoManual || puedeCompra
        ? null
        : "Necesitás permiso para crear en Movimientos o en Compras.",
    contar: puedeContar ? null : "Necesitás permiso para editar en Movimientos (ajustes de stock).",
    transferir: puedeTransferir ? null : "Necesitás permiso para crear en Movimientos.",
  };

  // --- Modo y depósitos (URL + localStorage) ---
  const modoUrl = params.get("modo") as Modo | null;
  const modo: Modo =
    modoUrl && modoUrl in habilitado && habilitado[modoUrl] === null ? modoUrl : "consultar";
  const principal = depositos.find((d) => d.esPrincipal)?.id ?? depositos[0]?.id ?? "";
  const valido = (id: string | null | undefined) =>
    id && depositos.some((d) => d.id === id) ? id : null;
  const [depositoId, setDepositoId] = useState(() => valido(params.get("deposito")) ?? principal);
  const [destinoId, setDestinoId] = useState(
    () => valido(params.get("destino")) ?? depositos.find((d) => d.id !== principal)?.id ?? "",
  );

  // El depósito guardado se aplica después de montar (localStorage no existe en el servidor).
  useEffect(() => {
    if (params.get("deposito")) return;
    const guardado = valido(leerLocal<string>(CLAVE_DEPOSITO));
    if (guardado) setDepositoId(guardado);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  const actualizarUrl = useCallback(
    (cambios: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      router.replace(`${pathname}?${sp}`, { scroll: false });
    },
    [params, pathname, router],
  );

  function elegirDeposito(id: string) {
    setDepositoId(id);
    escribirLocal(CLAVE_DEPOSITO, id);
    if (id === destinoId) setDestinoId(depositos.find((d) => d.id !== id)?.id ?? "");
    actualizarUrl({ deposito: id });
  }

  function elegirModo(m: Modo | "vender") {
    if (m === "vender") {
      // Vender es el punto de venta, con el mismo depósito y el escáner activo.
      if (!puedeVender)
        return toast.error("Modo Vender bloqueado", "Necesitás permiso para crear en Ventas.");
      router.push(`/ventas/nueva?deposito=${depositoId}`);
      return;
    }
    const bloqueo = habilitado[m];
    if (bloqueo) {
      toast.error(`Modo ${MODOS.find((x) => x.id === m)?.label} bloqueado`, bloqueo);
      return;
    }
    actualizarUrl({ modo: m === "consultar" ? null : m });
  }

  // --- Carrito de sesión (persistido) ---
  const [items, setItems] = useState<ItemCarrito[]>([]);
  const [consulta, setConsulta] = useState<VarianteEscaneada | null>(null);
  const [pendiente, setPendiente] = useState<Sesion | null>(null);

  useEffect(() => {
    const s = leerLocal<Sesion>(CLAVE_SESION);
    if (s && s.items.length > 0) setPendiente(s);
  }, []);

  useEffect(() => {
    if (pendiente) return; // no pisar la sesión guardada mientras se decide si retomarla
    escribirLocal(
      CLAVE_SESION,
      items.length
        ? ({ modo, depositoId, destinoId, items, ts: Date.now() } satisfies Sesion)
        : null,
    );
  }, [items, modo, depositoId, destinoId, pendiente]);

  function retomar() {
    if (!pendiente) return;
    setItems(pendiente.items);
    setDepositoId(valido(pendiente.depositoId) ?? principal);
    setDestinoId(valido(pendiente.destinoId) ?? destinoId);
    actualizarUrl({
      modo: pendiente.modo === "consultar" ? null : pendiente.modo,
      deposito: pendiente.depositoId,
    });
    setPendiente(null);
  }

  const agregar = useCallback((v: VarianteEscaneada) => {
    setItems((its) =>
      its.some((i) => i.variante.varianteId === v.varianteId)
        ? // Escaneo repetido: suma 1 (y actualiza el stock mostrado).
          its.map((i) =>
            i.variante.varianteId === v.varianteId ? { variante: v, cantidad: i.cantidad + 1 } : i,
          )
        : [{ variante: v, cantidad: 1 }, ...its],
    );
  }, []);

  const escaner = useEscanerVariantes({
    onVariante: (v) => (modo === "consultar" ? setConsulta(v) : agregar(v)),
    permitirRafaga: modo !== "consultar",
    tituloCamara: `Escanear · ${MODOS.find((m) => m.id === modo)?.label}`,
  });

  const cambiarCantidad = (id: string, cantidad: number) =>
    setItems((its) =>
      its.map((i) =>
        i.variante.varianteId === id
          ? { ...i, cantidad: Math.max(modo === "contar" ? 0 : 1, cantidad) }
          : i,
      ),
    );
  const quitar = (id: string) => setItems((its) => its.filter((i) => i.variante.varianteId !== id));

  const unidades = items.reduce((a, i) => a + i.cantidad, 0);
  const diferencias = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        sistema: stockEn(i.variante, depositoId),
        dif: i.cantidad - stockEn(i.variante, depositoId),
      })),
    [items, depositoId],
  );
  const ultima = escaner.ultima;

  // --- Confirmación ---
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState<{ id: string; numero: number } | null>(null);
  const [ocultarTeclado, setOcultarTeclado] = useState(false);
  useEffect(() => setOcultarTeclado(leerLocal<boolean>(CLAVE_TECLADO) ?? false), []);

  const [refrescando, setRefrescando] = useState(false);
  async function abrirConfirmacion() {
    setMotivo(
      modo === "ingresar" ? "Ingreso por escaneo" : modo === "contar" ? "Recuento por escaneo" : "",
    );
    if (modo === "contar") {
      // El stock del sistema puede haber cambiado desde el primer escaneo (caché de 5 min):
      // las diferencias que se confirman salen del stock actual.
      setRefrescando(true);
      const frescas = await Promise.all(
        items.map((i) => resolverVarianteAction({ varianteId: i.variante.varianteId })),
      );
      setRefrescando(false);
      const porId = new Map(
        frescas.flatMap((r) => (r.ok && r.data ? [[r.data.varianteId, r.data] as const] : [])),
      );
      setItems((its) =>
        its.map((i) => ({ ...i, variante: porId.get(i.variante.varianteId) ?? i.variante })),
      );
    }
    setConfirmando(true);
  }

  function terminar(titulo: string, descripcion?: string) {
    toast.success(titulo, descripcion);
    setItems([]);
    setConfirmando(false);
    invalidarResoluciones(); // el stock cambió: la próxima lectura trae números frescos
    router.refresh();
  }

  async function confirmar() {
    setEnviando(true);
    try {
      if (modo === "ingresar") {
        const r = await ingresoManualAction({
          depositoId,
          motivo,
          actualizarCosto: false,
          items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
        });
        if (!r.ok)
          return toast.error(
            "No se pudo registrar el ingreso",
            r.error.fields?.motivo?.[0] ?? r.error.message,
          );
        terminar(
          `Ingresaron ${formatearNumero(r.data.unidades)} unidades`,
          depositos.find((d) => d.id === depositoId)?.nombre,
        );
      } else if (modo === "contar") {
        const conDif = diferencias.filter((d) => d.dif !== 0);
        if (conDif.length === 0)
          return terminar("Todo coincide con el sistema", "No hubo que ajustar nada.");
        const r = await ajusteMasivoAction({
          depositoId,
          motivo,
          items: items.map((i) => ({
            varianteId: i.variante.varianteId,
            cantidadReal: i.cantidad,
          })),
        });
        if (!r.ok)
          return toast.error(
            "No se pudo aplicar el recuento",
            r.error.fields?.motivo?.[0] ?? r.error.message,
          );
        terminar(
          `Recuento aplicado: ${r.data.ajustes.length} ajuste(s)`,
          `${r.data.sinCambios} coincidían con el sistema.`,
        );
      } else if (modo === "transferir") {
        const r = await crearTransferenciaAction({
          depositoOrigenId: depositoId,
          depositoDestinoId: destinoId,
          notas: motivo || undefined,
          items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
        });
        if (!r.ok) return toast.error("No se pudo crear la transferencia", r.error.message);
        setItems([]);
        setConfirmando(false);
        setCreada(r.data);
      }
    } finally {
      setEnviando(false);
    }
  }

  async function completarAhora() {
    if (!creada) return;
    setEnviando(true);
    const r = await completarTransferenciaAction({ id: creada.id });
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo completar", r.error.message);
    setCreada(null);
    terminar(
      `Transferencia #${r.data.numero} completada`,
      `Se movieron ${r.data.unidades} unidades.`,
    );
  }

  function comoCompra() {
    const lista = items.map((i) => `${i.variante.varianteId}:${i.cantidad}`).join(",");
    setItems([]);
    setConfirmando(false);
    router.push(`/compras/nueva?deposito=${depositoId}&items=${lista}`);
  }

  const etiquetaBoton =
    modo === "ingresar"
      ? `Confirmar ingreso (${unidades} u.)`
      : modo === "contar"
        ? `Aplicar recuento (${items.length})`
        : `Crear transferencia (${unidades} u.)`;

  return (
    <div
      className={cn(
        "mx-auto flex max-w-3xl flex-col gap-4",
        modo !== "consultar" && items.length > 0 && "pb-24 md:pb-0",
      )}
    >
      {/* Modos */}
      <div
        role="tablist"
        aria-label="Modo"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {MODOS.map((m) => {
          const Icono = m.icono;
          const bloqueo =
            m.id === "vender"
              ? puedeVender
                ? null
                : "Necesitás permiso para crear en Ventas."
              : habilitado[m.id];
          const activo = m.id === modo;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={activo}
              aria-disabled={bloqueo ? true : undefined}
              title={bloqueo ?? undefined}
              onClick={() => elegirModo(m.id)}
              className={cn(
                "flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                activo
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface",
                bloqueo && "cursor-not-allowed opacity-50",
              )}
            >
              {bloqueo ? (
                <Lock className="size-4" aria-label="bloqueado" />
              ) : (
                <Icono className="size-4" aria-hidden />
              )}
              {m.label}
            </button>
          );
        })}
      </div>

      {pendiente && (
        <div
          role="status"
          className="border-primary/40 bg-primary-soft flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          <span>
            Tenés una sesión de <strong>{pendiente.modo}</strong> con {pendiente.items.length}{" "}
            producto(s) de hace {haceCuanto(pendiente.ts)}.
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPendiente(null)}>
              Descartar
            </Button>
            <Button size="sm" onClick={retomar}>
              Retomar sesión
            </Button>
          </span>
        </div>
      )}

      {/* Depósito(s) */}
      <div className={cn("grid gap-3", modo === "transferir" && "grid-cols-2")}>
        <Select
          label={modo === "transferir" ? "Origen" : "Depósito"}
          options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
          value={depositoId}
          onChange={(e) => elegirDeposito(e.target.value)}
        />
        {modo === "transferir" && (
          <Select
            label="Destino"
            options={depositos
              .filter((d) => d.id !== depositoId)
              .map((d) => ({ value: d.id, label: d.nombre }))}
            value={destinoId}
            onChange={(e) => {
              setDestinoId(e.target.value);
              actualizarUrl({ destino: e.target.value });
            }}
          />
        )}
      </div>

      {/* Zona de escaneo */}
      <section
        aria-label="Escáner"
        className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
      >
        <div className="flex items-center gap-3">
          <span className="bg-primary-soft text-primary-soft-foreground relative flex size-12 shrink-0 items-center justify-center rounded-full">
            <ScanBarcode className="size-6" aria-hidden />
            <span
              className="bg-primary/15 absolute inset-0 animate-ping rounded-full motion-reduce:hidden"
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1" aria-live="polite">
            {ultima ? (
              <>
                <p className="truncate text-lg leading-tight font-semibold">
                  {ultima.nombreCompleto}
                </p>
                <p className="text-muted text-sm">
                  En {depositos.find((d) => d.id === depositoId)?.nombre}:{" "}
                  <strong className="text-foreground">{stockEn(ultima, depositoId)}</strong> ·
                  Total: <strong className="text-foreground">{ultima.stockTotal}</strong>
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">Esperando escaneo…</p>
                <p className="text-muted text-sm">
                  Usá la pistola (no hace falta tocar nada), la cámara o escribí el código.
                </p>
              </>
            )}
          </div>
        </div>
        <ScanInput
          onScan={(c, m) => void escaner.procesar(c, m.fuente)}
          onAbrirCamara={escaner.abrirCamara}
          soloPistola={ocultarTeclado}
          inputRef={escaner.inputRef}
          autoFocus={false}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-muted flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={ocultarTeclado}
              onChange={(e) => {
                setOcultarTeclado(e.target.checked);
                escribirLocal(CLAVE_TECLADO, e.target.checked);
              }}
            />
            Ocultar teclado en pantalla (uso con pistola)
          </label>
          <Button variant="secondary" onClick={escaner.abrirCamara} className="md:hidden">
            <Camera /> Cámara
          </Button>
        </div>
      </section>

      {/* Consultar: ficha rápida */}
      {modo === "consultar" && consulta && (
        <section aria-label="Producto" className="border-border bg-surface rounded-2xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{consulta.nombreCompleto}</h2>
              <p className="text-muted font-mono text-xs">
                {consulta.sku} · {consulta.codigoBarras ?? "sin código"}
                {consulta.porCodigoAlternativo && " (leído por código alternativo)"}
              </p>
              {!consulta.activo && <Badge variant="danger">Inactivo</Badge>}
            </div>
            <div className="text-right">
              <p className="text-3xl leading-none font-bold tabular-nums">{consulta.stockTotal}</p>
              <p className="text-muted text-xs">unidades</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface-2 rounded-lg p-3">
              <dt className="text-muted text-xs">Precio de venta</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatearPesos(consulta.precioVenta)}
              </dd>
            </div>
            {esOwner(usuario) && consulta.precioCosto && (
              <div className="bg-surface-2 rounded-lg p-3">
                <dt className="text-muted text-xs">Costo</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatearPesos(consulta.precioCosto)}
                </dd>
              </div>
            )}
          </dl>
          <ul className="divide-border mt-3 flex flex-col divide-y text-sm">
            {depositos.map((d) => (
              <li
                key={d.id}
                className={cn("flex justify-between py-2", d.id === depositoId && "font-semibold")}
              >
                <span>{d.nombre}</span>
                <span className="tabular-nums">{stockEn(consulta, d.id)}</span>
              </li>
            ))}
          </ul>
          {puedeVerProductos && (
            <Link
              href={`/productos/${consulta.productoId}`}
              className={cn(buttonVariants({ variant: "secondary" }), "mt-3 w-full")}
            >
              Ver ficha completa
            </Link>
          )}
        </section>
      )}

      {/* Carrito de sesión */}
      {modo !== "consultar" &&
        (items.length === 0 ? (
          <p className="border-border text-muted rounded-xl border border-dashed px-4 py-8 text-center text-sm">
            Escaneá productos: cada lectura repetida suma 1.
          </p>
        ) : (
          <ul aria-label="Productos escaneados" className="flex flex-col gap-2">
            {diferencias.map((i) => (
              <li
                key={i.variante.varianteId}
                className={cn(
                  "bg-surface flex items-center gap-3 rounded-xl border p-3",
                  modo === "contar"
                    ? i.dif === 0
                      ? "border-success/40"
                      : "border-danger/40"
                    : "border-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  {/* El sabor es lo que distingue una fila de otra: va primero y no se corta. */}
                  <p
                    className="leading-tight font-semibold break-words"
                    title={i.variante.nombreCompleto}
                  >
                    {i.variante.nombreCompleto === i.variante.producto
                      ? i.variante.producto
                      : i.variante.variante}
                  </p>
                  {i.variante.nombreCompleto !== i.variante.producto && (
                    <p className="text-muted truncate text-xs">{i.variante.producto}</p>
                  )}
                  <p className="text-muted text-xs">
                    {modo === "contar" ? (
                      <>
                        Sistema:{" "}
                        <strong className="text-foreground tabular-nums">{i.sistema}</strong>{" "}
                        <span
                          className={cn(
                            "font-semibold",
                            i.dif === 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {i.dif === 0 ? "✓ coincide" : `${conSigno(i.dif)}`}
                        </span>
                      </>
                    ) : (
                      <>
                        En {depositos.find((d) => d.id === depositoId)?.nombre}: {i.sistema}
                        {modo === "transferir" && i.cantidad > i.sistema && (
                          <span className="text-danger font-semibold"> · no alcanza</span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-10"
                    onClick={() => cambiarCantidad(i.variante.varianteId, i.cantidad - 1)}
                    aria-label={`Restar uno de ${i.variante.nombreCompleto}`}
                  >
                    <Minus />
                  </Button>
                  <CantidadInput
                    etiqueta={`Cantidad de ${i.variante.nombreCompleto}`}
                    valor={i.cantidad}
                    min={modo === "contar" ? 0 : 1}
                    onCambio={(n) => cambiarCantidad(i.variante.varianteId, n)}
                    className="h-10 w-16 px-1 text-base font-semibold"
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-10"
                    onClick={() => cambiarCantidad(i.variante.varianteId, i.cantidad + 1)}
                    aria-label={`Sumar uno de ${i.variante.nombreCompleto}`}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-danger size-10"
                    onClick={() => quitar(i.variante.varianteId)}
                    aria-label={`Quitar ${i.variante.nombreCompleto}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {/* Botón fijo */}
      {modo !== "consultar" && items.length > 0 && (
        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 border-t px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <Button
            size="lg"
            fullWidth
            onClick={() => void abrirConfirmacion()}
            loading={refrescando}
            disabled={modo === "transferir" && !destinoId}
          >
            {etiquetaBoton}
          </Button>
        </div>
      )}

      {escaner.ui}

      {/* Confirmación */}
      <Dialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title={
          modo === "ingresar"
            ? "Confirmar ingreso"
            : modo === "contar"
              ? "Aplicar recuento"
              : "Crear transferencia"
        }
        description={
          modo === "transferir"
            ? `${depositos.find((d) => d.id === depositoId)?.nombre} → ${depositos.find((d) => d.id === destinoId)?.nombre}`
            : depositos.find((d) => d.id === depositoId)?.nombre
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={enviando}>
              Volver
            </Button>
            {modo === "ingresar" && puedeCompra && (
              <Button variant="secondary" onClick={comoCompra} disabled={enviando}>
                Registrar como compra
              </Button>
            )}
            {!(modo === "ingresar" && !puedeIngresoManual) && (
              <Button onClick={confirmar} loading={enviando}>
                {modo === "ingresar"
                  ? "Confirmar ingreso"
                  : modo === "contar"
                    ? "Aplicar"
                    : "Crear"}
              </Button>
            )}
          </>
        }
      >
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-sm">
          {diferencias.map((i) => (
            <li key={i.variante.varianteId} className="flex justify-between gap-3">
              <span className="truncate">{i.variante.nombreCompleto}</span>
              <span className="shrink-0 tabular-nums">
                {modo === "contar" ? (
                  <>
                    {i.sistema} → <strong>{i.cantidad}</strong>{" "}
                    <span className={i.dif === 0 ? "text-success" : "text-danger"}>
                      {i.dif === 0 ? "✓" : `(${conSigno(i.dif)})`}
                    </span>
                  </>
                ) : (
                  <strong>{i.cantidad} u.</strong>
                )}
              </span>
            </li>
          ))}
        </ul>
        {modo === "contar" && diferencias.every((d) => d.dif === 0) && (
          <p className="bg-success-soft text-success-soft-foreground rounded-lg px-3 py-2 text-sm">
            Todo coincide con el sistema: no se va a ajustar nada.
          </p>
        )}
        {modo !== "transferir" ? (
          <Input
            label="Motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
            hint={modo === "contar" ? "Mínimo 5 caracteres." : undefined}
          />
        ) : (
          <Input
            label="Notas (opcional)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}
      </Dialog>

      <Dialog
        open={creada !== null}
        onOpenChange={(o) => !o && setCreada(null)}
        title={`Transferencia #${creada?.numero} creada`}
        description="Quedó pendiente: el stock se mueve al completarla."
        footer={
          <>
            <Link
              href={`/movimientos/transferencias/${creada?.id}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Ver transferencia
            </Link>
            {puedeCompletar && (
              <Button onClick={completarAhora} loading={enviando}>
                Completar ahora
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
