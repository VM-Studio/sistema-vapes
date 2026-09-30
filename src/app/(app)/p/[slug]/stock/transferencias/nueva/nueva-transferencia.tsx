"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleCheck,
  FileText,
  MessageCircle,
  Minus,
  PackageOpen,
  Plus,
  ScanBarcode,
  Send,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { abrirEnPestana } from "@/app/(app)/p/[slug]/cotizador/compartir";
import { VariantePicker } from "@/components/catalogo/variante-picker";
import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stepper } from "@/components/ui/stepper";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearNumero } from "@/lib/format";
import { linkWhatsAppTexto } from "@/lib/movimientos-ui";
import { cn } from "@/lib/utils";

import { moverAhoraAction, registrarEnvioAction, remitoTransferenciaAction } from "../actions";

interface Deposito {
  id: string;
  nombre: string;
  esPrincipal: boolean;
}

interface Item {
  variante: VarianteEncontrada;
  cantidad: number;
}

interface Resultado {
  id: string;
  codigo: string;
  unidades: number;
  remitoUrl: string | null;
  whatsapp: string;
  /** true = "Mover ahora" (ya se movió); false = envío pendiente de recepción. */
  movida: boolean;
  origen: string;
  destino: string;
  sabores: number;
}

type Paso = "galpones" | "productos" | "confirmar" | "exito";
const PASOS = ["Origen y destino", "Productos", "Confirmar"];
const INDICE: Record<Paso, number> = { galpones: 0, productos: 1, confirmar: 2, exito: 3 };

const stockEn = (v: VarianteEncontrada, depositoId: string | null) =>
  v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;

export function NuevaTransferencia({
  depositos,
  unidades,
  origenInicial,
  destinoInicial,
  varianteInicial,
}: {
  depositos: Deposito[];
  /** Unidades actuales por galpón (se muestran en las tarjetas). */
  unidades: Record<string, number>;
  origenInicial: string | null;
  destinoInicial: string | null;
  /** Sabor precargado (viene de "Transferir" en la fila de Stock). */
  varianteInicial: VarianteEncontrada | null;
}) {
  const panel = usePanel();
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();

  const destinoValido = destinoInicial !== origenInicial ? destinoInicial : null;
  const [origenId, setOrigenId] = useState<string | null>(origenInicial);
  const [destinoId, setDestinoId] = useState<string | null>(destinoValido);
  const [paso, setPaso] = useState<Paso>(origenInicial && destinoValido ? "productos" : "galpones");
  const [items, setItems] = useState<Item[]>(
    varianteInicial ? [{ variante: varianteInicial, cantidad: 1 }] : [],
  );
  const [resaltado, setResaltado] = useState<{ id: string; n: number } | null>(null);
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState<"ahora" | "envio" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [generandoRemito, setGenerandoRemito] = useState(false);

  const origen = depositos.find((d) => d.id === origenId) ?? null;
  const destino = depositos.find((d) => d.id === destinoId) ?? null;
  const total = items.reduce((a, i) => a + i.cantidad, 0);
  const excedidos = items.filter((i) => i.cantidad > stockEn(i.variante, origenId));
  const etiquetaEspec = panel.etiquetaEspecificacion || "Especificación";

  const agregar = useCallback((v: VarianteEncontrada) => {
    setItems((its) =>
      its.some((i) => i.variante.varianteId === v.varianteId)
        ? its.map((i) =>
            i.variante.varianteId === v.varianteId
              ? { variante: v, cantidad: Math.min(99_999, i.cantidad + 1) }
              : i,
          )
        : [{ variante: v, cantidad: 1 }, ...its],
    );
    setResaltado((r) => ({ id: v.varianteId, n: (r?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!resaltado) return;
    const t = setTimeout(() => setResaltado(null), 1600);
    return () => clearTimeout(t);
  }, [resaltado]);

  const escaner = useEscanerVariantes({
    onVariante: (v) => agregar(v),
    // Solo en el paso Productos (ni la pistola hace nada en los otros).
    habilitado: paso === "productos",
    permitirRafaga: true,
    tituloCamara: origen && destino ? `${origen.nombre} → ${destino.nombre}` : "Transferencia",
  });

  const cambiarCantidad = (id: string, cantidad: number) =>
    setItems((its) =>
      its.map((i) =>
        i.variante.varianteId === id ? { ...i, cantidad: Math.max(1, cantidad) } : i,
      ),
    );
  const quitar = (id: string) => setItems((its) => its.filter((i) => i.variante.varianteId !== id));

  async function confirmar(modo: "ahora" | "envio") {
    if (!origenId || !destinoId || !origen || !destino) return;
    setEnviando(modo);
    setError(null);
    const input = {
      depositoOrigenId: origenId,
      depositoDestinoId: destinoId,
      observacion: observacion.trim() || undefined,
      items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
    };
    const r = modo === "ahora" ? await moverAhoraAction(input) : await registrarEnvioAction(input);
    setEnviando(null);
    if (!r.ok) {
      setError(r.error.message);
      toast.error("No se pudo registrar la transferencia", r.error.message);
      return;
    }
    if (modo === "ahora") invalidarResoluciones(); // el stock cambió: próximos escaneos frescos
    setResultado({
      id: r.data.id,
      codigo: r.data.codigo,
      unidades: r.data.unidades,
      remitoUrl: r.data.remitoUrl,
      whatsapp: r.data.whatsapp,
      movida: modo === "ahora",
      origen: origen.nombre,
      destino: destino.nombre,
      sabores: items.length,
    });
    setPaso("exito");
    router.refresh();
  }

  async function verRemito() {
    if (!resultado) return;
    setGenerandoRemito(true);
    const e = await abrirEnPestana(async () => {
      const r = await remitoTransferenciaAction({ id: resultado.id });
      if (r.ok) setResultado((x) => (x ? { ...x, remitoUrl: r.data.url } : x));
      return r;
    });
    setGenerandoRemito(false);
    if (e) toast.error("No se pudo generar el remito", e);
  }

  function nueva() {
    setItems([]);
    setObservacion("");
    setResultado(null);
    setError(null);
    setPaso("galpones");
  }

  const cabecera = (
    <>
      <PageHeader
        title="Nueva transferencia"
        className="mb-4 md:mb-5"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Stock", href: ruta("/stock") },
              { label: "Transferencias", href: ruta("/stock/transferencias") },
              { label: "Nueva" },
            ]}
          />
        }
        subtitle={
          origen && destino && paso !== "galpones" ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge variant="primary" className="h-7 px-2.5 text-sm">
                <Warehouse strokeWidth={1.75} aria-hidden />
                <span data-testid="origen-actual">{origen.nombre}</span>
              </Badge>
              <ArrowRight className="text-muted size-4" strokeWidth={1.75} aria-label="a" />
              <Badge variant="neutral" className="h-7 px-2.5 text-sm">
                <span data-testid="destino-actual">{destino.nombre}</span>
              </Badge>
              {paso === "productos" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1 underline-offset-4 hover:underline"
                  onClick={() => setPaso("galpones")}
                >
                  Cambiar
                </Button>
              )}
            </span>
          ) : (
            "Escaneá lo que sale del galpón: cada lectura suma una unidad."
          )
        }
      />
      <Stepper pasos={PASOS} actual={INDICE[paso]} className="mb-6 max-w-lg" />
    </>
  );

  // --- Paso 1: origen y destino ----------------------------------------------------
  if (paso === "galpones") {
    const listo = origenId !== null && destinoId !== null && origenId !== destinoId;
    return (
      <div className="mx-auto flex max-w-3xl flex-col">
        {cabecera}
        {depositos.length < 2 ? (
          <p className="bg-warning-soft text-warning-soft-foreground rounded-control px-4 py-3 text-sm">
            Para transferir hacen falta al menos dos galpones activos. Creá otro en Configuración →
            Depósitos.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            <GrupoGalpones
              titulo="¿De qué galpón sale?"
              nombre="Origen"
              depositos={depositos}
              unidades={unidades}
              elegido={origenId}
              onElegir={(id) => {
                setOrigenId(id);
                if (id === destinoId) setDestinoId(null);
              }}
            />
            <GrupoGalpones
              titulo="¿A qué galpón va?"
              nombre="Destino"
              depositos={depositos}
              unidades={unidades}
              elegido={destinoId}
              deshabilitado={origenId}
              onElegir={setDestinoId}
            />
            <Button
              size="lg"
              className="w-full sm:w-auto sm:self-end"
              disabled={!listo}
              onClick={() => setPaso("productos")}
            >
              {listo && origen && destino
                ? `Continuar: ${origen.nombre} → ${destino.nombre}`
                : "Elegí origen y destino"}
            </Button>
          </div>
        )}
        {escaner.ui}
      </div>
    );
  }

  // --- Éxito -----------------------------------------------------------------------
  if (paso === "exito" && resultado) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-2 md:py-6">
        <Stepper pasos={PASOS} actual={3} className="mb-2 max-w-lg" />
        <Card className="flex flex-col items-center gap-6 p-6 text-center md:p-8">
          <CircleCheck className="text-success size-14" strokeWidth={1.25} aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-muted font-mono text-sm" data-testid="codigo-transferencia">
              {resultado.codigo}
            </p>
            <h1 className="text-h1 font-semibold">
              {resultado.movida
                ? `Moviste ${formatearNumero(resultado.unidades)} unidades`
                : `Envío de ${formatearNumero(resultado.unidades)} unidades registrado`}
            </h1>
            <p className="text-muted text-body">
              {resultado.origen} → {resultado.destino} · {resultado.sabores}{" "}
              {resultado.sabores === 1 ? "sabor" : "sabores"}
              {resultado.movida
                ? ". El stock ya se movió."
                : ". El stock se mueve cuando confirmes la recepción."}
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
            {resultado.remitoUrl ? (
              <a
                href={resultado.remitoUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "secondary", size: "lg" })}
                data-testid="remito-transferencia"
              >
                <FileText strokeWidth={1.75} /> Ver remito (PDF)
              </a>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void verRemito()}
                loading={generandoRemito}
              >
                {!generandoRemito && <FileText strokeWidth={1.75} />} Ver remito (PDF)
              </Button>
            )}
            <a
              href={linkWhatsAppTexto(resultado.whatsapp)}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              <MessageCircle strokeWidth={1.75} /> WhatsApp
            </a>
            <Button size="lg" onClick={nueva}>
              <Plus strokeWidth={1.75} /> Nueva transferencia
            </Button>
          </div>
          <Link
            href={ruta(`/stock/transferencias/${resultado.id}`)}
            className="text-foreground text-sm font-medium underline underline-offset-4 hover:decoration-2"
          >
            Ver el detalle de la transferencia
          </Link>
        </Card>
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 3: confirmar -------------------------------------------------------------
  if (paso === "confirmar" && origen && destino) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col">
        {cabecera}
        <Card className="flex flex-col gap-5 p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h3 font-semibold">Resumen</h2>
            <p className="text-muted text-small tabular-nums">
              {items.length} {items.length === 1 ? "sabor" : "sabores"}
            </p>
          </div>
          <div className="border-border bg-surface rounded-control overflow-x-auto border">
            <table
              className="w-full text-left text-sm tabular-nums"
              aria-label="Resumen de la transferencia"
            >
              <thead className="border-border bg-card text-muted border-b text-xs">
                <tr>
                  {/* Mobile: marca, modelo y especificación en una sola columna. */}
                  <th scope="col" className="h-10 px-3 font-medium sm:hidden">
                    Producto
                  </th>
                  <th scope="col" className="hidden h-10 px-4 font-medium sm:table-cell">
                    Marca
                  </th>
                  <th scope="col" className="hidden h-10 px-4 font-medium sm:table-cell">
                    Modelo
                  </th>
                  <th scope="col" className="hidden h-10 px-4 font-medium sm:table-cell">
                    {etiquetaEspec}
                  </th>
                  <th scope="col" className="h-10 px-3 font-medium sm:px-4">
                    Sabor
                  </th>
                  <th scope="col" className="h-10 px-3 text-right font-medium sm:px-4">
                    Cantidad
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {items.map((i) => (
                  <tr key={i.variante.varianteId}>
                    <td className="px-3 py-3 sm:hidden">
                      {i.variante.marca} {i.variante.modelo}
                      {i.variante.especificacion && (
                        <span className="text-muted block text-xs">
                          {etiquetaEspec} {i.variante.especificacion}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{i.variante.marca}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">{i.variante.modelo}</td>
                    <td className="text-muted hidden px-4 py-3 sm:table-cell">
                      {i.variante.especificacion || "—"}
                    </td>
                    <td className="px-3 py-3 font-medium sm:px-4">{i.variante.sabor ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-semibold sm:px-4">{i.cantidad}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-border border-t">
                <tr>
                  <th
                    scope="row"
                    colSpan={2}
                    className="px-3 py-3 text-right font-semibold sm:hidden"
                  >
                    Total de unidades
                  </th>
                  <th
                    scope="row"
                    colSpan={4}
                    className="hidden px-4 py-3 text-right font-semibold sm:table-cell"
                  >
                    Total de unidades
                  </th>
                  <td
                    className="px-3 py-3 text-right text-base font-semibold sm:px-4"
                    data-testid="total-unidades"
                  >
                    {formatearNumero(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Textarea
            label="Observación (opcional)"
            rows={2}
            maxLength={2000}
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder="Ej: lo lleva Juan en la camioneta"
          />
          {error && (
            <p
              className="bg-danger-soft text-danger rounded-control px-4 py-3 text-sm"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
            <Button
              variant="ghost"
              onClick={() => setPaso("productos")}
              disabled={enviando !== null}
            >
              <ArrowLeft strokeWidth={1.75} /> Volver
            </Button>
            <div className="flex flex-col-reverse gap-2 md:flex-row">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void confirmar("envio")}
                loading={enviando === "envio"}
                disabled={enviando !== null}
              >
                {enviando !== "envio" && <Truck strokeWidth={1.75} />} Registrar envío, confirmar al
                recibir
              </Button>
              <Button
                size="lg"
                onClick={() => void confirmar("ahora")}
                loading={enviando === "ahora"}
                disabled={enviando !== null}
              >
                {enviando !== "ahora" && <Send strokeWidth={1.75} />} Mover ahora
              </Button>
            </div>
          </div>
        </Card>
        {escaner.ui}
      </div>
    );
  }

  // --- Paso 2: productos -------------------------------------------------------------
  return (
    <div className={cn("mx-auto flex max-w-3xl flex-col", items.length > 0 && "pb-28 md:pb-0")}>
      {cabecera}
      <div className="flex flex-col gap-4">
        <Card aria-label="Escáner" className="flex flex-col gap-4 p-5 md:p-6" role="region">
          <div className="flex items-center gap-4">
            <span className="bg-surface text-foreground rounded-card flex size-14 shrink-0 items-center justify-center">
              <ScanBarcode className="size-8" strokeWidth={1.5} aria-hidden />
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              {escaner.ultima ? (
                <>
                  <p className="text-h3 truncate font-semibold">{escaner.ultima.titulo}</p>
                  <p className="text-muted text-small">
                    Hay {stockEn(escaner.ultima, origenId)} en {origen?.nombre}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-h3 font-semibold">Escaneá lo que sale de {origen?.nombre}</p>
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
            depositoId={origenId ?? undefined}
            soloConStock
            yaAgregadas={new Set(items.map((i) => i.variante.varianteId))}
            placeholder={`Buscar a mano en ${origen?.nombre ?? "el origen"}: producto, sabor o código…`}
          />
        </Card>

        <Card className="flex flex-col gap-4 p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h3 font-semibold">A transferir</h2>
            {items.length > 0 && (
              <p className="text-muted text-small tabular-nums">
                {items.length} {items.length === 1 ? "sabor" : "sabores"} · {formatearNumero(total)}{" "}
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
                <span className="text-right">En {origen?.nombre}</span>
                <span className="text-right">Cantidad</span>
              </div>
              <ul
                aria-label="Productos a transferir"
                className="divide-border flex flex-col divide-y"
              >
                {items.map((i) => {
                  const v = i.variante;
                  const disponible = stockEn(v, origenId);
                  const falta = i.cantidad > disponible;
                  const recien = resaltado?.id === v.varianteId;
                  return (
                    <li
                      key={v.varianteId}
                      aria-label={v.titulo}
                      data-falta={falta || undefined}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-3 transition-colors sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_13rem] sm:items-center sm:gap-4",
                        falta ? "bg-danger-soft" : recien && "bg-surface-3",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="leading-tight font-medium break-words">
                          {v.nombreCompleto}
                          {v.sabor && <span className="text-muted font-normal"> — {v.sabor}</span>}
                        </p>
                        <p
                          className={cn(
                            "text-small sm:hidden",
                            falta ? "text-danger" : "text-muted",
                          )}
                        >
                          Hay <span className="tabular-nums">{disponible}</span> en {origen?.nombre}
                        </p>
                        {falta && (
                          <p className="text-danger text-small">
                            Stock insuficiente: solo hay {disponible}.
                          </p>
                        )}
                      </div>
                      <p
                        className={cn(
                          "hidden text-right text-sm tabular-nums sm:block",
                          falta ? "text-danger font-semibold" : "text-muted",
                        )}
                        data-testid="stock-origen"
                      >
                        {disponible}
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

      {items.length > 0 && (
        <div className="border-border bg-surface fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:sticky md:bottom-0 md:mt-6 md:px-0 md:py-4">
          <Button
            size="lg"
            fullWidth
            onClick={() => setPaso("confirmar")}
            disabled={excedidos.length > 0}
          >
            <Check strokeWidth={1.75} /> Continuar con {formatearNumero(total)} unidad
            {total === 1 ? "" : "es"}
          </Button>
          {excedidos.length > 0 && (
            <p className="text-danger mt-1 text-center text-xs" role="alert">
              {excedidos.length === 1
                ? "Un producto no tiene stock suficiente en el origen."
                : `${excedidos.length} productos no tienen stock suficiente en el origen.`}
            </p>
          )}
        </div>
      )}

      {escaner.ui}
    </div>
  );
}

/** Tarjetas de galpón para elegir uno (origen o destino); `deshabilitado` no se puede elegir. */
function GrupoGalpones({
  titulo,
  nombre,
  depositos,
  unidades,
  elegido,
  deshabilitado,
  onElegir,
}: {
  titulo: string;
  nombre: string;
  depositos: Deposito[];
  unidades: Record<string, number>;
  elegido: string | null;
  deshabilitado?: string | null;
  onElegir: (id: string) => void;
}) {
  return (
    <section aria-label={nombre} className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{titulo}</h2>
      <div role="radiogroup" aria-label={nombre} className="grid gap-3 sm:grid-cols-2">
        {depositos.map((d) => {
          const activo = d.id === elegido;
          const bloqueado = d.id === deshabilitado;
          const n = unidades[d.id] ?? 0;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={activo}
              aria-label={`${nombre}: ${d.nombre}`}
              disabled={bloqueado}
              onClick={() => onElegir(d.id)}
              className={cn(
                "bg-card rounded-card relative flex min-h-24 items-center gap-4 p-4 text-left transition-[background-color,box-shadow] duration-150 md:p-5",
                activo ? "ring-foreground ring-2" : "hover:bg-card-hover hover:shadow-card-hover",
                bloqueado && "pointer-events-none opacity-40",
              )}
            >
              <span className="bg-surface text-foreground rounded-control flex size-11 shrink-0 items-center justify-center">
                <Warehouse className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-h3 truncate font-semibold">{d.nombre}</span>
                <span className="text-muted text-small tabular-nums">
                  {formatearNumero(n)} {n === 1 ? "unidad" : "unidades"}
                  {d.esPrincipal && " · Principal"}
                  {bloqueado && " · es el origen"}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "rounded-circle absolute top-4 right-4 flex size-6 items-center justify-center border transition-colors md:top-5 md:right-5",
                  activo
                    ? "border-foreground bg-foreground text-background"
                    : "border-input bg-surface",
                )}
              >
                {activo && <Check className="size-4" strokeWidth={2.25} />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
