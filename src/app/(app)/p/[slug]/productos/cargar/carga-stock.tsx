"use client";

import { Modulo } from "@prisma/client";
import {
  ArrowRight,
  Boxes,
  Camera,
  Check,
  CircleCheck,
  History,
  Minus,
  PackageCheck,
  PackageOpen,
  Plus,
  ScanBarcode,
  ScanLine,
  Trash2,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { cargarStockPorEscaneoAction } from "@/app/(app)/p/[slug]/productos/actions";
import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { usePuede, useUsuario } from "@/components/layout/usuario-context";
import { useEstadoOffline } from "@/components/pwa/sincronizacion-offline";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResumenCargaStock } from "@/server/services/producto.service";

interface Item {
  variante: VarianteEncontrada;
  cantidad: number;
}

/** Lista de carga guardada en el celular (por panel y usuario): sobrevive a un refresh o a cerrar la app. */
interface ListaGuardada {
  depositoId: string;
  items: Item[];
  ts: number;
}

type Paso = "galpon" | "escaneo" | "exito";

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
    /* almacenamiento bloqueado: la lista simplemente no se guarda */
  }
}

function haceCuanto(ts: number): string {
  const min = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (min < 60) return `${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} hora${h === 1 ? "" : "s"}` : `${Math.round(h / 24)} día(s)`;
}

const stockEn = (v: VarianteEncontrada, depositoId: string) =>
  v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;

export function CargaStock({
  depositos,
  buscarInicial,
  unidades: unidadesPorDeposito,
}: {
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  /** Nombre de un producto para dejar listo en el buscador. */
  buscarInicial: string;
  /** Unidades actuales por galpón (se muestran en las tarjetas del paso 1). */
  unidades?: Record<string, number>;
}) {
  const panel = usePanel();
  const usuario = useUsuario();
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const offline = useEstadoOffline();
  const puedeVerStock = usePuede(Modulo.STOCK, "ver");
  const CLAVE_LISTA = `carga-stock.lista.${panel.id}.${usuario.id}`;
  const CLAVE_GALPON = `carga-stock.galpon.${panel.id}.${usuario.id}`;

  const [paso, setPaso] = useState<Paso>("galpon");
  const [depositoId, setDepositoId] = useState<string | null>(null);
  const [preseleccionado, setPreseleccionado] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [guardada, setGuardada] = useState<ListaGuardada | null>(null);
  const [resaltado, setResaltado] = useState<{ id: string; n: number } | null>(null);
  const [cambiarGalpon, setCambiarGalpon] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resumen, setResumen] = useState<ResumenCargaStock | null>(null);
  const [selectorKey, setSelectorKey] = useState(0);

  const deposito = depositos.find((d) => d.id === depositoId) ?? null;
  const unidades = items.reduce((a, i) => a + i.cantidad, 0);

  // Al montar: último galpón usado (preseleccionado, NO confirmado) y lista sin terminar.
  useEffect(() => {
    const ultimo = leer<string>(CLAVE_GALPON);
    if (ultimo && depositos.some((d) => d.id === ultimo)) {
      setPreseleccionado(ultimo);
      setSelectorKey((k) => k + 1);
    }
    const lista = leer<ListaGuardada>(CLAVE_LISTA);
    if (lista && lista.items.length > 0 && depositos.some((d) => d.id === lista.depositoId))
      setGuardada(lista);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  // Persistir la lista (con el galpón y la hora) mientras se escanea.
  useEffect(() => {
    if (guardada) return; // no pisar la lista guardada mientras se decide si retomarla
    if (paso !== "escaneo" || !depositoId) return;
    escribir(
      CLAVE_LISTA,
      items.length ? ({ depositoId, items, ts: Date.now() } satisfies ListaGuardada) : null,
    );
  }, [items, depositoId, paso, guardada, CLAVE_LISTA]);

  function confirmarGalpon(id: string) {
    setDepositoId(id);
    escribir(CLAVE_GALPON, id);
    setPreseleccionado(id);
    if (guardada) {
      // Empezó una carga nueva: la sin terminar se descarta.
      escribir(CLAVE_LISTA, null);
      setGuardada(null);
    }
    setPaso("escaneo");
  }

  function retomar() {
    if (!guardada) return;
    setItems(guardada.items);
    setDepositoId(guardada.depositoId);
    setPreseleccionado(guardada.depositoId);
    setGuardada(null);
    setPaso("escaneo");
  }

  function descartar() {
    escribir(CLAVE_LISTA, null);
    setGuardada(null);
  }

  const agregar = useCallback((v: VarianteEncontrada) => {
    setItems((its) => {
      const existe = its.some((i) => i.variante.varianteId === v.varianteId);
      return existe
        ? its.map((i) =>
            i.variante.varianteId === v.varianteId
              ? { variante: v, cantidad: Math.min(99_999, i.cantidad + 1) }
              : i,
          )
        : [{ variante: v, cantidad: 1 }, ...its];
    });
    setResaltado((r) => ({ id: v.varianteId, n: (r?.n ?? 0) + 1 }));
  }, []);

  // Resaltado de la última fila escaneada (se apaga solo).
  useEffect(() => {
    if (!resaltado) return;
    const t = setTimeout(() => setResaltado(null), 1600);
    return () => clearTimeout(t);
  }, [resaltado]);

  const escaner = useEscanerVariantes({
    onVariante: (v) => agregar(v),
    // Sin galpón confirmado el escáner no hace nada (ni la pistola).
    habilitado: paso === "escaneo" && !confirmando && !cambiarGalpon,
    permitirRafaga: true,
    altaRapida: "directa",
    tituloCamara: deposito ? `Cargando en ${deposito.nombre}` : "Cargar stock",
  });

  const cambiarCantidad = (id: string, cantidad: number) =>
    setItems((its) =>
      its.map((i) =>
        i.variante.varianteId === id ? { ...i, cantidad: Math.max(1, cantidad) } : i,
      ),
    );
  const quitar = (id: string) => setItems((its) => its.filter((i) => i.variante.varianteId !== id));

  async function cargar() {
    if (!depositoId) return;
    setEnviando(true);
    const r = await cargarStockPorEscaneoAction({
      depositoId,
      items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
    });
    setEnviando(false);
    if (!r.ok) {
      toast.error("No se pudo cargar el stock", r.error.message);
      return;
    }
    setConfirmando(false);
    setItems([]);
    escribir(CLAVE_LISTA, null);
    invalidarResoluciones(); // el stock cambió: los próximos escaneos traen números frescos
    setResumen(r.data);
    setPaso("exito");
    router.refresh();
  }

  function cargarMas() {
    setResumen(null);
    setPaso("escaneo");
  }

  const cabecera = (
    <>
      <PageHeader
        title="Cargar stock"
        className="mb-4 md:mb-5"
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Productos", href: ruta("/productos") }, { label: "Cargar stock" }]}
          />
        }
        subtitle={
          paso === "escaneo" && deposito ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              Cargando en
              <Badge variant="primary" className="h-7 px-2.5 text-sm">
                <Warehouse strokeWidth={1.75} aria-hidden />
                <span data-testid="galpon-actual">{deposito.nombre}</span>
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1 underline-offset-4 hover:underline"
                onClick={() => (items.length > 0 ? setCambiarGalpon(true) : setPaso("galpon"))}
              >
                Cambiar
              </Button>
            </span>
          ) : (
            "Elegí el galpón y escaneá: cada lectura suma una unidad."
          )
        }
      />
      <Stepper
        pasos={["Galpón", "Escaneo", "Listo"]}
        actual={paso === "galpon" ? 0 : paso === "escaneo" ? 1 : 2}
        className="mb-6 max-w-md"
      />
    </>
  );

  // --- Paso 1: galpón -----------------------------------------------------------
  if (paso === "galpon") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col">
        {cabecera}
        {guardada && (
          <div
            role="status"
            className="bg-card text-body rounded-card mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5"
          >
            <span className="flex items-start gap-3">
              <History
                className="text-muted mt-0.5 size-5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                Tenés una carga sin terminar:{" "}
                <strong>
                  {guardada.items.reduce((a, i) => a + i.cantidad, 0)} unidades en{" "}
                  {depositos.find((d) => d.id === guardada.depositoId)?.nombre}
                </strong>{" "}
                <span className="text-muted">(hace {haceCuanto(guardada.ts)}).</span>
              </span>
            </span>
            <span className="flex shrink-0 gap-2 [&>*]:flex-1">
              <Button variant="secondary" size="sm" onClick={descartar}>
                Descartar
              </Button>
              <Button size="sm" onClick={retomar}>
                Retomar
              </Button>
            </span>
          </div>
        )}
        <SelectorGalpon
          key={selectorKey}
          depositos={depositos}
          preseleccionadoId={preseleccionado}
          titulo="¿En qué galpón vas a cargar?"
          descripcion="Todo lo que escanees entra en ese galpón. Elegilo y tocá Continuar."
          onConfirmar={confirmarGalpon}
          unidades={unidadesPorDeposito}
        />
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 3: éxito ------------------------------------------------------------
  if (paso === "exito" && resumen) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-2 md:py-6">
        <Card className="flex flex-col items-center gap-6 p-6 text-center md:p-8">
          <CircleCheck className="text-success size-14" strokeWidth={1.25} aria-hidden />
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-semibold">
              Cargaste {formatearNumero(resumen.unidades)} unidades en {resumen.deposito.nombre}
            </h1>
            <p className="text-muted text-body">
              {resumen.items.length} producto{resumen.items.length === 1 ? "" : "s"} · quedó
              registrado como ingreso manual.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 text-left">
            <h2 className="text-muted text-small font-medium">Stock de lo cargado, por galpón</h2>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-3" aria-label="Totales por galpón">
              {resumen.porDeposito.map((d) => {
                const actual = d.depositoId === resumen.deposito.id;
                return (
                  <li
                    key={d.depositoId}
                    className={cn(
                      "bg-surface rounded-control flex flex-col gap-0.5 p-3",
                      actual && "ring-foreground ring-1",
                    )}
                  >
                    <p className="text-muted text-small">
                      {d.nombre}
                      {actual && " · cargado"}
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatearNumero(d.unidades)}
                    </p>
                  </li>
                );
              })}
            </ul>
            <ul className="bg-surface divide-border rounded-control mt-2 flex flex-col divide-y px-4 text-sm">
              {resumen.items.map((i) => (
                <li key={i.varianteId} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate">{i.titulo}</span>
                  <span className="text-muted flex shrink-0 items-center gap-1.5 tabular-nums">
                    <strong className="text-success font-semibold">+{i.cantidad}</strong>
                    <span aria-hidden>·</span>
                    {i.stockAnterior}
                    <ArrowRight className="size-3.5" strokeWidth={1.75} aria-label="a" />
                    <span className="text-foreground font-medium">{i.stockPosterior}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            <Button size="lg" onClick={cargarMas}>
              <ScanLine strokeWidth={1.75} /> Cargar más
            </Button>
            {puedeVerStock ? (
              <Link
                href={ruta(`/stock?tab=${resumen.deposito.id}`)}
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                <Boxes strokeWidth={1.75} /> Ver stock
              </Link>
            ) : (
              <Link
                href={ruta("/productos")}
                className={buttonVariants({ variant: "secondary", size: "lg" })}
              >
                Ver productos
              </Link>
            )}
          </div>
        </Card>
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 2: escaneo ----------------------------------------------------------
  return (
    <div className={cn("mx-auto flex max-w-3xl flex-col", items.length > 0 && "pb-28 md:pb-0")}>
      {cabecera}
      <div className="flex flex-col gap-4">
        <Card aria-label="Escáner" className="flex flex-col gap-4 p-5 md:p-6" role="region">
          <div className="flex items-center gap-4">
            <span className="bg-surface text-foreground rounded-card relative flex size-14 shrink-0 items-center justify-center">
              <ScanBarcode className="size-8" strokeWidth={1.5} aria-hidden />
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              {escaner.ultima ? (
                <>
                  <p className="text-h3 truncate font-semibold">{escaner.ultima.titulo}</p>
                  <p className="text-success text-small inline-flex items-center gap-1">
                    <Check className="size-4" strokeWidth={2} aria-hidden /> Sumado a la lista
                  </p>
                </>
              ) : (
                <>
                  <p className="text-h3 font-semibold">Escaneá un producto o buscalo</p>
                  <p className="text-muted text-small">
                    Con la pistola no hace falta tocar nada. Cada lectura repetida suma 1.
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <ScanInput
              onScan={(c, m) => void escaner.procesar(c, m.fuente)}
              inputRef={escaner.inputRef}
              autoFocus={false}
              placeholder="Escribí un código y Enter"
              className="flex-1"
            />
            <Button
              variant="secondary"
              onClick={escaner.abrirCamara}
              aria-label="Escanear con la cámara"
              className="h-12 w-12 px-0 sm:w-auto sm:px-4 md:h-12"
            >
              <Camera strokeWidth={1.75} /> <span className="hidden sm:inline">Cámara</span>
            </Button>
          </div>
          <VariantePicker
            onSelect={(v) => escaner.agregar(v)}
            depositoId={depositoId ?? undefined}
            yaAgregadas={new Set(items.map((i) => i.variante.varianteId))}
            valorInicial={buscarInicial}
            autoFocus={buscarInicial !== ""}
            placeholder="Buscar a mano: producto, sabor o código…"
          />
        </Card>

        <Card className="flex flex-col gap-4 p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h3 font-semibold">Lista de carga</h2>
            {items.length > 0 && (
              <p className="text-muted text-small tabular-nums">
                {items.length} producto{items.length === 1 ? "" : "s"} · {formatearNumero(unidades)}{" "}
                u.
              </p>
            )}
          </div>
          {items.length === 0 ? (
            <div className="bg-surface text-muted rounded-control flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
              <PackageOpen className="text-subtle size-10" strokeWidth={1.25} aria-hidden />
              Todavía no escaneaste nada.
            </div>
          ) : (
            <div className="border-border bg-surface rounded-control overflow-hidden border">
              <div
                aria-hidden
                className="border-border bg-card text-muted hidden h-10 grid-cols-[minmax(0,1fr)_9rem_13rem] items-center gap-4 border-b px-4 text-xs font-medium sm:grid"
              >
                <span>Producto</span>
                <span className="text-right">En {deposito?.nombre}</span>
                <span className="text-right">Cantidad</span>
              </div>
              <ul aria-label="Lista de carga" className="divide-border flex flex-col divide-y">
                {items.map((i) => {
                  const v = i.variante;
                  const actual = depositoId ? stockEn(v, depositoId) : 0;
                  const recien = resaltado?.id === v.varianteId;
                  return (
                    <li
                      key={v.varianteId}
                      aria-label={v.titulo}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-3 transition-colors sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_13rem] sm:items-center sm:gap-4",
                        recien && "bg-surface-3",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="leading-tight font-medium break-words">
                          {v.nombreCompleto}
                          {v.sabor && <span className="text-muted font-normal"> — {v.sabor}</span>}
                        </p>
                        <p className="text-muted text-small sm:hidden">
                          En {deposito?.nombre}: <span className="tabular-nums">{actual}</span>{" "}
                          <ArrowRight className="inline size-3.5" aria-hidden />{" "}
                          <strong className="text-foreground tabular-nums">
                            {actual + i.cantidad}
                          </strong>
                        </p>
                      </div>
                      <p className="text-muted hidden text-right text-sm tabular-nums sm:block">
                        {actual} <ArrowRight className="inline size-3.5" aria-hidden />{" "}
                        <strong
                          className="text-foreground font-semibold"
                          data-testid="stock-resultante"
                        >
                          {actual + i.cantidad}
                        </strong>
                      </p>
                      <div className="flex items-center gap-1 sm:justify-end">
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
                          className="w-16 text-center text-lg font-semibold"
                        />
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={() => cambiarCantidad(v.varianteId, i.cantidad + 1)}
                          aria-label={`Sumar uno de ${v.titulo}`}
                        >
                          <Plus strokeWidth={1.75} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted hover:text-danger ml-auto sm:ml-0"
                          onClick={() => quitar(v.varianteId)}
                          aria-label={`Quitar ${v.titulo}`}
                        >
                          <Trash2 strokeWidth={1.75} />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {items.length > 0 && deposito && (
        <div className="border-border bg-surface pl-safe pr-safe fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t px-4 py-3 md:sticky md:bottom-0 md:mt-6 md:px-0 md:py-4">
          <Button
            size="lg"
            fullWidth
            onClick={() => setConfirmando(true)}
            disabled={!offline.online}
          >
            <PackageCheck strokeWidth={1.75} /> Cargar {formatearNumero(unidades)} unidad
            {unidades === 1 ? "" : "es"} en {deposito.nombre}
          </Button>
          {!offline.online && (
            <p className="text-muted mt-1 text-center text-xs">
              Sin conexión: confirmá cuando vuelva la señal (la lista queda guardada).
            </p>
          )}
        </div>
      )}

      {escaner.ui}

      <Dialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title={`Cargar en ${deposito?.nombre ?? ""}`}
        description={`${formatearNumero(unidades)} unidades de ${items.length} producto${items.length === 1 ? "" : "s"}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={() => void cargar()} loading={enviando} disabled={!offline.online}>
              Confirmar carga
            </Button>
          </>
        }
      >
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
          {items.map((i) => (
            <li key={i.variante.varianteId} className="flex justify-between gap-3">
              <span className="truncate">{i.variante.titulo}</span>
              <strong className="shrink-0 tabular-nums">+{i.cantidad}</strong>
            </li>
          ))}
        </ul>
      </Dialog>

      <ConfirmDialog
        open={cambiarGalpon}
        onOpenChange={setCambiarGalpon}
        title="¿Cambiar de galpón?"
        description={`La lista (${formatearNumero(unidades)} unidades) se mantiene, pero se va a cargar en el galpón que elijas.`}
        confirmLabel="Cambiar galpón"
        onConfirm={() => {
          setCambiarGalpon(false);
          setSelectorKey((k) => k + 1);
          setPaso("galpon");
        }}
      />
    </div>
  );
}
