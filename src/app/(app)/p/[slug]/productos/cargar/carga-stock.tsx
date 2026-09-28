"use client";

import {
  ArrowRight,
  Camera,
  CircleCheck,
  Minus,
  PackageCheck,
  Plus,
  ScanBarcode,
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
import { useUsuario } from "@/components/layout/usuario-context";
import { useEstadoOffline } from "@/components/pwa/sincronizacion-offline";
import { Button, buttonVariants } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
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
}: {
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
  /** Nombre de un producto para dejar listo en el buscador. */
  buscarInicial: string;
}) {
  const panel = usePanel();
  const usuario = useUsuario();
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const offline = useEstadoOffline();
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

  // --- Paso 1: galpón -----------------------------------------------------------
  if (paso === "galpon") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {guardada && (
          <div
            role="status"
            className="border-primary/40 bg-primary-soft flex flex-col gap-3 rounded-2xl border p-4 text-sm md:flex-row md:items-center md:justify-between"
          >
            <span>
              Tenés una carga sin terminar:{" "}
              <strong>
                {guardada.items.reduce((a, i) => a + i.cantidad, 0)} unidades en{" "}
                {depositos.find((d) => d.id === guardada.depositoId)?.nombre}
              </strong>{" "}
              (hace {haceCuanto(guardada.ts)}).
            </span>
            <span className="flex gap-2">
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
        />
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 3: éxito ------------------------------------------------------------
  if (paso === "exito" && resumen) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <section className="border-border bg-surface flex flex-col items-center gap-3 rounded-2xl border p-6 text-center">
          <span className="bg-success-soft text-success-soft-foreground flex size-14 items-center justify-center rounded-full">
            <CircleCheck className="size-7" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cargaste {formatearNumero(resumen.unidades)} unidades en {resumen.deposito.nombre}
          </h1>
          <p className="text-muted text-sm">
            {resumen.items.length} producto{resumen.items.length === 1 ? "" : "s"} · quedó
            registrado como ingreso manual.
          </p>
        </section>

        <section className="border-border bg-surface rounded-2xl border p-4">
          <h2 className="mb-2 text-sm font-semibold">Stock de lo cargado, por galpón</h2>
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3" aria-label="Totales por galpón">
            {resumen.porDeposito.map((d) => (
              <li
                key={d.depositoId}
                className={cn(
                  "rounded-xl p-3",
                  d.depositoId === resumen.deposito.id
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "bg-surface-2",
                )}
              >
                <p className="text-xs">{d.nombre}</p>
                <p className="text-2xl font-bold tabular-nums">{formatearNumero(d.unidades)}</p>
              </li>
            ))}
          </ul>
          <ul className="divide-border mt-3 flex flex-col divide-y text-sm">
            {resumen.items.map((i) => (
              <li key={i.varianteId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{i.titulo}</span>
                <span className="shrink-0 tabular-nums">
                  +{i.cantidad} · {i.stockAnterior} <ArrowRight className="inline size-3" />{" "}
                  {i.stockPosterior}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Link
            href={ruta("/productos")}
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            Ver productos
          </Link>
          <Button size="lg" onClick={cargarMas}>
            <ScanBarcode strokeWidth={1.75} /> Cargar más
          </Button>
        </div>
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 2: escaneo ----------------------------------------------------------
  return (
    <div
      className={cn("mx-auto flex max-w-3xl flex-col gap-4", items.length > 0 && "pb-28 md:pb-0")}
    >
      <header className="border-primary bg-primary-soft sticky top-0 z-10 flex items-center gap-3 rounded-2xl border px-4 py-3">
        <Warehouse className="text-primary size-6 shrink-0" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-muted text-xs">Cargando en</p>
          <p className="truncate text-lg leading-tight font-semibold" data-testid="galpon-actual">
            {deposito?.nombre}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (items.length > 0 ? setCambiarGalpon(true) : setPaso("galpon"))}
        >
          Cambiar
        </Button>
      </header>

      <section
        aria-label="Escáner"
        className="border-border bg-surface flex flex-col gap-3 rounded-2xl border p-4"
      >
        <div className="flex items-center gap-3">
          <span className="bg-primary-soft text-primary-soft-foreground relative flex size-12 shrink-0 items-center justify-center rounded-full">
            <ScanBarcode className="size-6" strokeWidth={1.75} aria-hidden />
            <span
              className="bg-primary/15 absolute inset-0 animate-ping rounded-full motion-reduce:hidden"
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1" aria-live="polite">
            {escaner.ultima ? (
              <>
                <p className="truncate font-semibold">{escaner.ultima.titulo}</p>
                <p className="text-muted text-sm">Sumado a la lista</p>
              </>
            ) : (
              <>
                <p className="font-semibold">Escaneá los productos</p>
                <p className="text-muted text-sm">
                  Con la pistola no hace falta tocar nada. Cada lectura repetida suma 1.
                </p>
              </>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={escaner.abrirCamara}
            aria-label="Escanear con la cámara"
          >
            <Camera strokeWidth={1.75} /> <span className="hidden sm:inline">Cámara</span>
          </Button>
        </div>
        <ScanInput
          onScan={(c, m) => void escaner.procesar(c, m.fuente)}
          inputRef={escaner.inputRef}
          autoFocus={false}
          placeholder="Escribí un código y Enter"
        />
        <VariantePicker
          onSelect={(v) => escaner.agregar(v)}
          depositoId={depositoId ?? undefined}
          yaAgregadas={new Set(items.map((i) => i.variante.varianteId))}
          valorInicial={buscarInicial}
          autoFocus={buscarInicial !== ""}
          placeholder="Buscar a mano: producto, sabor o código…"
        />
      </section>

      {items.length === 0 ? (
        <p className="border-border text-muted rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
          Todavía no escaneaste nada.
        </p>
      ) : (
        <ul aria-label="Lista de carga" className="flex flex-col gap-2">
          {items.map((i) => {
            const v = i.variante;
            const actual = depositoId ? stockEn(v, depositoId) : 0;
            const recien = resaltado?.id === v.varianteId;
            return (
              <li
                key={v.varianteId}
                aria-label={v.titulo}
                className={cn(
                  "bg-surface flex flex-col gap-3 rounded-2xl border p-3 transition-colors sm:flex-row sm:items-center",
                  recien ? "border-primary bg-primary-soft" : "border-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="leading-tight font-semibold break-words">
                    {v.nombreCompleto}
                    {v.sabor && <span className="font-normal"> — {v.sabor}</span>}
                  </p>
                  <p className="text-muted text-sm">
                    En {deposito?.nombre}: <span className="tabular-nums">{actual}</span>{" "}
                    <ArrowRight className="inline size-3.5" aria-hidden />{" "}
                    <strong className="text-foreground tabular-nums" data-testid="stock-resultante">
                      {actual + i.cantidad}
                    </strong>
                  </p>
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
                    className="w-20 text-lg font-semibold"
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
                    className="text-danger"
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
      )}

      {items.length > 0 && deposito && (
        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 border-t px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
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
