"use client";

import { Modulo } from "@prisma/client";
import { ArrowLeft, Plus, Search, Store, Trash2, Truck, Warehouse } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { SelectorGalpon } from "@/components/catalogo/selector-galpon";
import { BuscadorRemoto } from "@/components/compras/buscador-remoto";
import { DialogoRecibir } from "@/components/compras/dialogo-recibir";
import { ProveedorForm, soloDecimal } from "@/components/compras/proveedor-form";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { usePuede } from "@/components/layout/usuario-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { invalidarResoluciones, resolverCodigo } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { hoyAR } from "@/lib/fechas";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CambioPrecioProveedor } from "@/server/services/compra.service";

import {
  buscarSaboresCompraAction,
  costoSugeridoAction,
  guardarCompraAction,
  preciosQueCambianAction,
  recibirCompraAction,
  type SaborBuscado,
} from "./actions";

export interface ItemCompraForm {
  varianteId: string;
  productoId: string;
  nombreCompleto: string;
  /** null = sabor "Único" (no se muestra). */
  sabor: string | null;
  sku: string;
  cantidad: string;
  costo: string;
  /** De dónde salió el costo sugerido (o "manual" si lo editaron). */
  origenCosto: "PROVEEDOR" | "ULTIMO_COSTO" | "manual" | "cargando" | null;
}

export interface ProveedorOpcion {
  id: string;
  nombre: string;
  nombreTienda: string;
}

export interface CompraInicial {
  id: string | null;
  idVisible?: string;
  proveedorId: string;
  depositoId: string;
  fecha: string;
  notas: string;
  items: ItemCompraForm[];
}

const num = (s: string) => Number(s.replace(",", ".")) || 0;
const soloEntero = (s: string) => s.replace(/\D/g, "");
const tituloItem = (i: { nombreCompleto: string; sabor: string | null }) =>
  i.sabor ? `${i.nombreCompleto} — ${i.sabor}` : i.nombreCompleto;

type Paso = 1 | 2 | 3;

/**
 * Nueva compra (o edición de un borrador) en tres pasos:
 * 1. proveedor (obligatorio, con "crear rápido"),
 * 2. galpón destino (SelectorGalpon: nunca se confirma solo),
 * 3. ítems con la pistola/cámara activas y buscador manual. Cada sabor trae
 *    el costo sugerido (precio del proveedor o último costo), editable.
 * "Recibir mercadería" guarda el borrador y pregunta si actualizar el precio
 * del proveedor con los costos que cambian.
 */
export function CompraForm({
  inicial,
  proveedores: proveedoresIniciales,
  depositos,
}: {
  inicial: CompraInicial;
  proveedores: ProveedorOpcion[];
  depositos: { id: string; nombre: string; esPrincipal: boolean }[];
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const panel = usePanel();
  const toast = useToast();
  const feedback = useScanFeedback();
  const puedeRecibir = usePuede(Modulo.COMPRAS, "editar");
  const puedeCrearProveedor = usePuede(Modulo.PROVEEDORES, "crear");

  const [compraId, setCompraId] = useState(inicial.id);
  const [idVisible, setIdVisible] = useState(inicial.idVisible ?? null);
  const [proveedores, setProveedores] = useState(proveedoresIniciales);
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId);
  const [depositoId, setDepositoId] = useState(inicial.depositoId);
  // Una compra nueva siempre pasa por el galpón (aunque venga preseleccionado): nunca se confirma solo.
  const [paso, setPaso] = useState<Paso>(
    !inicial.proveedorId ? 1 : inicial.id && inicial.depositoId ? 3 : 2,
  );
  const [fecha, setFecha] = useState(inicial.fecha);
  const [notas, setNotas] = useState(inicial.notas);
  const [items, setItems] = useState<ItemCompraForm[]>(inicial.items);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<"borrador" | "recibir" | null>(null);
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [filtroProveedor, setFiltroProveedor] = useState("");
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const [recibir, setRecibir] = useState<{ cambios: CambioPrecioProveedor[] | null } | null>(null);
  const clave = useRef(0);

  const proveedor = proveedores.find((p) => p.id === proveedorId);
  const deposito = depositos.find((d) => d.id === depositoId);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  /** Completa el costo sugerido de los sabores que todavía no tienen costo cargado a mano. */
  const sugerirCostos = useCallback(async (provId: string, varianteIds: string[]) => {
    if (!provId || varianteIds.length === 0) return;
    const r = await costoSugeridoAction({ proveedorId: provId, varianteIds });
    if (!r.ok) {
      setItems((its) =>
        its.map((i) => (i.origenCosto === "cargando" ? { ...i, origenCosto: null } : i)),
      );
      return;
    }
    setItems((its) =>
      its.map((i) => {
        const s = r.data[i.varianteId];
        if (!s || i.origenCosto === "manual") return i;
        return {
          ...i,
          costo: s.costo === null ? "" : String(Number(s.costo)),
          origenCosto: s.fuente,
        };
      }),
    );
  }, []);

  // Al elegir (o cambiar) el proveedor: sugerir el costo de todo lo que no se cargó a mano
  // (también los ítems precargados por URL).
  useEffect(() => {
    const sinCosto = itemsRef.current
      .filter((i) => i.origenCosto !== "manual")
      .map((i) => i.varianteId);
    if (proveedorId && sinCosto.length) void sugerirCostos(proveedorId, sinCosto);
  }, [proveedorId, sugerirCostos]);

  function agregar(v: {
    varianteId: string;
    productoId: string;
    nombreCompleto: string;
    sabor: string | null;
    sku: string;
  }) {
    const existe = itemsRef.current.some((i) => i.varianteId === v.varianteId);
    setItems((its) =>
      existe
        ? its.map((i) =>
            i.varianteId === v.varianteId ? { ...i, cantidad: String(num(i.cantidad) + 1) } : i,
          )
        : [
            ...its,
            {
              varianteId: v.varianteId,
              productoId: v.productoId,
              nombreCompleto: v.nombreCompleto,
              sabor: v.sabor,
              sku: v.sku,
              cantidad: "1",
              costo: "",
              origenCosto: "cargando",
            },
          ],
    );
    if (!existe) void sugerirCostos(proveedorId, [v.varianteId]);
  }

  const procesar = async (codigo: string) => {
    const r = await resolverCodigo(panel.id, codigo);
    if (!r.ok) {
      feedback.error("No se pudo buscar el código", r.error.message);
      return;
    }
    if (r.data.encontrado) {
      const v = r.data.variante;
      feedback.ok();
      setMensaje({ tipo: "ok", texto: tituloItem(v), clave: ++clave.current });
      agregar(v);
    } else {
      feedback.error();
      setMensaje({
        tipo: "error",
        texto: "Código desconocido",
        detalle: r.data.codigo,
        clave: ++clave.current,
      });
      setCamara(false);
      setDesconocido(r.data.codigo);
    }
  };

  // Pistola activa en el paso de ítems (pausada con el alta rápida o el diálogo abiertos).
  useBarcodeScanner({
    onScan: (c) => void procesar(c),
    enabled: paso === 3 && desconocido === null && recibir === null && !nuevoProveedor,
  });

  const total = items.reduce((a, i) => a + num(i.cantidad) * num(i.costo), 0);
  const unidades = items.reduce((a, i) => a + num(i.cantidad), 0);
  const actualizar = (id: string, cambios: Partial<ItemCompraForm>) =>
    setItems((its) => its.map((i) => (i.varianteId === id ? { ...i, ...cambios } : i)));

  /** Guarda el borrador (crea o actualiza). Devuelve el id o null si hubo errores. */
  async function guardarBorrador(): Promise<{ id: string; idVisible: string } | null> {
    setErrores({});
    const r = await guardarCompraAction({
      id: compraId ?? undefined,
      datos: {
        proveedorId,
        depositoId,
        fecha,
        notas,
        items: items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitario: i.costo.replace(",", "."),
        })),
      },
    });
    if (!r.ok) {
      setErrores(
        Object.fromEntries(
          Object.entries(r.error.fields ?? {}).map(([k, v]) => [
            k.replace(/^datos\./, ""),
            v[0] ?? "",
          ]),
        ),
      );
      toast.error(
        "No se pudo guardar la compra",
        r.error.fields ? "Revisá los datos marcados." : r.error.message,
      );
      return null;
    }
    setCompraId(r.data.id);
    setIdVisible(r.data.idVisible);
    return { id: r.data.id, idVisible: r.data.idVisible };
  }

  async function onGuardarBorrador() {
    setEnviando("borrador");
    const g = await guardarBorrador();
    setEnviando(null);
    if (!g) return;
    toast.success(`Compra ${g.idVisible} guardada como borrador`);
    router.push(ruta(`/compras/${g.id}`));
  }

  async function onRecibir() {
    setEnviando("recibir");
    const g = await guardarBorrador();
    setEnviando(null);
    if (!g) return;
    setRecibir({ cambios: null });
    const r = await preciosQueCambianAction({ id: g.id });
    if (!r.ok) {
      setRecibir(null);
      toast.error("No se pudieron comparar los precios", r.error.message);
      return;
    }
    setRecibir({ cambios: r.data });
  }

  async function confirmarRecibir(actualizarPrecioProveedor: boolean) {
    if (!compraId) return;
    setEnviando("recibir");
    const r = await recibirCompraAction({ id: compraId, actualizarPrecioProveedor });
    setEnviando(null);
    if (!r.ok) {
      setRecibir(null);
      toast.error(`La compra ${idVisible ?? ""} quedó como borrador`, r.error.message);
      return;
    }
    setRecibir(null);
    invalidarResoluciones();
    toast.success(
      `Compra ${r.data.idVisible} recibida`,
      `Ingresaron ${formatearNumero(r.data.unidades)} unidades a ${deposito?.nombre ?? "el galpón"}${r.data.preciosActualizados ? ` · ${r.data.preciosActualizados} precio(s) de ${proveedor?.nombre ?? "proveedor"} actualizado(s)` : ""}.`,
    );
    router.push(ruta(`/compras/${compraId}`));
  }

  const titulo = compraId && inicial.id ? `Editar compra ${idVisible ?? ""}` : "Nueva compra";
  const pasos = (
    <Stepper
      pasos={["Proveedor", "Galpón", "Ítems"]}
      actual={paso - 1}
      className="bg-card rounded-card mb-6 px-4 py-3 md:px-5"
    />
  );

  // ---------------------------------------------------------------------------
  // Paso 1: proveedor
  // ---------------------------------------------------------------------------
  if (paso === 1) {
    const f = filtroProveedor.trim().toLowerCase();
    const visibles = f
      ? proveedores.filter((p) => `${p.nombre} ${p.nombreTienda}`.toLowerCase().includes(f))
      : proveedores;
    return (
      <>
        <PageHeader title={titulo} subtitle="Paso 1 de 3 · ¿A quién le comprás?" />
        {pasos}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                type="search"
                aria-label="Buscar proveedor"
                placeholder="Buscar por nombre o tienda"
                value={filtroProveedor}
                onChange={(e) => setFiltroProveedor(e.target.value)}
                className={cn(controlClass, "h-11 pl-10 md:h-10")}
              />
            </div>
            {puedeCrearProveedor && (
              <Button variant="secondary" onClick={() => setNuevoProveedor(true)}>
                <Plus strokeWidth={1.75} /> Crear proveedor rápido
              </Button>
            )}
          </div>
          {visibles.length === 0 ? (
            <EmptyState
              icon={Truck}
              title={
                proveedores.length ? "Ningún proveedor coincide" : "Todavía no hay proveedores"
              }
              description={
                puedeCrearProveedor
                  ? "Crealo con «Crear proveedor rápido»."
                  : "Pedile a un dueño que lo cargue en Proveedores."
              }
            />
          ) : (
            <div
              role="radiogroup"
              aria-label="Proveedor"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {visibles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === proveedorId}
                  onClick={() => {
                    setProveedorId(p.id);
                    setPaso(depositoId && compraId ? 3 : 2);
                  }}
                  className={cn(
                    "bg-card rounded-card hover:bg-card-hover hover:shadow-card-hover flex min-h-20 items-center gap-4 border p-4 text-left transition-[background-color,box-shadow,border-color] duration-150",
                    p.id === proveedorId ? "border-foreground" : "border-transparent",
                  )}
                >
                  <span className="bg-surface text-muted rounded-control flex size-11 shrink-0 items-center justify-center">
                    <Store className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{p.nombre}</span>
                    <span className="text-muted text-small truncate">{p.nombreTienda}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {errores.proveedorId && <p className="text-danger text-small">{errores.proveedorId}</p>}
        </div>
        <Sheet
          open={nuevoProveedor}
          onOpenChange={setNuevoProveedor}
          title="Nuevo proveedor"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setNuevoProveedor(false)}
                disabled={creandoProveedor}
              >
                Cancelar
              </Button>
              <Button type="submit" form="form-proveedor-rapido" loading={creandoProveedor}>
                Crear
              </Button>
            </>
          }
        >
          {nuevoProveedor && (
            <ProveedorForm
              formId="form-proveedor-rapido"
              proveedor={null}
              verPrecios={false}
              compacto
              onEnviando={setCreandoProveedor}
              onListo={(p) => {
                setProveedores((ps) => [...ps, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                setProveedorId(p.id);
                setNuevoProveedor(false);
                setPaso(2);
              }}
            />
          )}
        </Sheet>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 2: galpón destino
  // ---------------------------------------------------------------------------
  if (paso === 2) {
    return (
      <>
        <PageHeader title={titulo} subtitle={`Paso 2 de 3 · Compra a ${proveedor?.nombre ?? ""}`} />
        {pasos}
        <SelectorGalpon
          depositos={depositos}
          preseleccionadoId={depositoId || depositos.find((d) => d.esPrincipal)?.id}
          titulo="¿A qué galpón entra la mercadería?"
          descripcion="El stock se suma ahí cuando recibas la compra."
          onConfirmar={(id) => {
            setDepositoId(id);
            setPaso(3);
          }}
        />
        <Button variant="ghost" className="mt-4" onClick={() => setPaso(1)}>
          <ArrowLeft strokeWidth={1.75} /> Volver al proveedor
        </Button>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 3: ítems
  // ---------------------------------------------------------------------------
  return (
    <>
      <PageHeader
        title={titulo}
        subtitle="Paso 3 de 3 · Escaneá la mercadería (pistola o cámara) o buscala a mano."
      />
      {pasos}
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem] md:items-end">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Store className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0">
                  <span className="text-muted text-small block">Proveedor</span>
                  <span className="block truncate font-semibold">
                    {proveedor ? `${proveedor.nombre} · ${proveedor.nombreTienda}` : "—"}
                  </span>
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPaso(1)}>
                Cambiar
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Warehouse className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0">
                  <span className="text-muted text-small block">Galpón destino</span>
                  <span className="block truncate font-semibold">{deposito?.nombre ?? "—"}</span>
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPaso(2)}>
                Cambiar
              </Button>
            </div>
            <Input
              label="Fecha"
              type="date"
              value={fecha}
              max={hoyAR()}
              onChange={(e) => setFecha(e.target.value)}
              error={errores.fecha}
            />
            {(errores.proveedorId || errores.depositoId) && (
              <p className="text-danger text-small md:col-span-3">
                {errores.proveedorId ?? errores.depositoId}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <ScanInput
              onScan={(c) => void procesar(c)}
              onAbrirCamara={() => {
                feedback.prepararAudio();
                setCamara(true);
              }}
              autoFocus={false}
            />
            <BuscadorRemoto<SaborBuscado>
              ariaLabel="Buscar producto a mano"
              placeholder="…o buscá por producto, sabor o SKU"
              buscar={(q) => buscarSaboresCompraAction({ q })}
              getKey={(v) => v.varianteId}
              render={(v) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {tituloItem(v)}
                    {items.some((i) => i.varianteId === v.varianteId) && (
                      <span className="text-subtle ml-2 text-xs font-normal">(ya agregado)</span>
                    )}
                  </span>
                  <span className="text-muted truncate text-xs">
                    {v.sku}
                    {v.codigoBarras ? ` · ${v.codigoBarras}` : ""}
                  </span>
                </span>
              )}
              onSelect={agregar}
            />
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Todavía no hay productos en la compra"
            description="Cada escaneo repetido suma una unidad."
          />
        ) : (
          <div className="border-border bg-surface rounded-card overflow-hidden border">
            <div
              aria-hidden
              className="border-border bg-card text-muted hidden h-10 grid-cols-[minmax(0,1fr)_6rem_8.5rem_8rem_2.75rem] items-center gap-3 border-b px-4 text-xs font-medium md:grid"
            >
              <span>Producto</span>
              <span className="text-right">Cantidad</span>
              <span className="text-right">Costo unitario</span>
              <span className="text-right">Subtotal</span>
              <span />
            </div>
            <ul aria-label="Ítems de la compra" className="divide-border flex flex-col divide-y">
              {items.map((it, i) => {
                const t = tituloItem(it);
                const errorDe = (campo: string) => errores[`items.${i}.${campo}`];
                const sugerido =
                  it.origenCosto === "PROVEEDOR" || it.origenCosto === "ULTIMO_COSTO";
                return (
                  <li
                    key={it.varianteId}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_6rem_8.5rem_8rem_2.75rem] md:items-center"
                  >
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <p className="font-medium">{it.nombreCompleto}</p>
                      <p className="text-subtle text-xs">
                        {it.sabor ? `${it.sabor} · ` : ""}
                        {it.sku}
                        {it.origenCosto === "PROVEEDOR" && " · costo del proveedor"}
                        {it.origenCosto === "ULTIMO_COSTO" && " · último costo"}
                        {it.origenCosto === "cargando" && " · buscando costo…"}
                      </p>
                    </div>
                    <label className="text-muted text-small row-start-2 flex flex-col gap-1 md:row-start-auto">
                      <span className="md:sr-only">Cantidad</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`Cantidad de ${t}`}
                        value={it.cantidad}
                        onChange={(e) =>
                          actualizar(it.varianteId, { cantidad: soloEntero(e.target.value) })
                        }
                        aria-invalid={errorDe("cantidad") ? true : undefined}
                        className={cn(
                          controlClass,
                          "text-foreground h-11 text-right font-semibold tabular-nums md:h-10",
                        )}
                      />
                      {errorDe("cantidad") && (
                        <span className="text-danger">{errorDe("cantidad")}</span>
                      )}
                    </label>
                    <label className="text-muted text-small row-start-2 flex flex-col gap-1 md:row-start-auto">
                      <span className="md:sr-only">Costo unitario</span>
                      <input
                        inputMode="decimal"
                        aria-label={`Costo de ${t}`}
                        title={sugerido ? "Costo sugerido: editalo si cambió" : undefined}
                        value={it.costo}
                        onChange={(e) =>
                          actualizar(it.varianteId, {
                            costo: soloDecimal(e.target.value),
                            origenCosto: "manual",
                          })
                        }
                        aria-invalid={errorDe("costoUnitario") ? true : undefined}
                        className={cn(
                          controlClass,
                          "h-11 text-right tabular-nums md:h-10",
                          sugerido && "text-muted",
                        )}
                      />
                      {errorDe("costoUnitario") && (
                        <span className="text-danger">{errorDe("costoUnitario")}</span>
                      )}
                    </label>
                    <p className="col-span-2 flex items-baseline justify-between gap-2 md:col-span-1 md:block md:text-right">
                      <span className="text-muted text-small md:hidden">Subtotal</span>
                      <strong className="font-semibold tabular-nums">
                        {formatearPesos(num(it.cantidad) * num(it.costo))}
                      </strong>
                    </p>
                    <IconButton
                      variant="ghost"
                      className="hover:text-danger col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto"
                      onClick={() =>
                        setItems((its) => its.filter((x) => x.varianteId !== it.varianteId))
                      }
                      aria-label={`Quitar ${t}`}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {errores.items && <p className="text-danger text-small">{errores.items}</p>}

        <Card>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
            <Textarea
              label="Notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="N.º de remito o factura, observaciones…"
            />
            <div className="flex flex-col justify-end gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-h3 font-semibold">Total</span>
                <span
                  className="text-h2 font-semibold tabular-nums"
                  aria-label="Total de la compra"
                >
                  {formatearPesos(total)}
                </span>
              </div>
              <p className="text-muted text-small">
                {formatearNumero(unidades)} unidades · el total final lo calcula el sistema
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="md:flex md:justify-end">
          <BarraAccion>
            <Button
              variant="secondary"
              onClick={() => void onGuardarBorrador()}
              loading={enviando === "borrador"}
              disabled={items.length === 0 || enviando !== null}
            >
              Guardar borrador
            </Button>
            {puedeRecibir && (
              <Button
                onClick={() => void onRecibir()}
                loading={enviando === "recibir" && recibir === null}
                disabled={items.length === 0 || enviando !== null}
              >
                Recibir mercadería
              </Button>
            )}
          </BarraAccion>
        </div>
      </div>

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c) => void procesar(c)}
        mensaje={mensaje}
        permitirRafaga
        titulo="Escanear mercadería"
      />
      <AltaRapidaSheet
        codigo={desconocido}
        abierto={desconocido !== null}
        onCerrar={() => setDesconocido(null)}
        onCreada={(v) => {
          setDesconocido(null);
          invalidarResoluciones();
          agregar(v);
        }}
      />
      <DialogoRecibir
        abierto={recibir !== null}
        onCerrar={() => {
          setRecibir(null);
          if (idVisible) toast.info(`La compra ${idVisible} quedó guardada como borrador`);
        }}
        proveedor={proveedor?.nombre ?? "el proveedor"}
        deposito={deposito?.nombre ?? "el galpón"}
        unidades={unidades}
        cambios={recibir?.cambios ?? null}
        enviando={enviando === "recibir"}
        onConfirmar={(a) => void confirmarRecibir(a)}
      />
    </>
  );
}
