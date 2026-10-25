"use client";

import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  RefreshCw,
  RotateCcw,
  ScanBarcode,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUsuario } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import {
  evaluarEscaneo,
  type CampoDiferencia,
  type EvaluacionEscaneo,
  type ItemEscaneo,
  type RechazoEscaneo,
} from "@/lib/escaneo-remoto";
import { esPerfilEscaneo } from "@/lib/permisos";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { VentaParaEscanear } from "@/server/services/escaneo-remoto.service";

import { confirmarEscaneoAction, evaluarEscaneoAction, pendientesEscaneoAction } from "./actions";

/** Cada cuánto se refresca la lista de ventas pedidas (solo con la pestaña visible). */
const REFRESCO_MS = 15_000;

const unidades = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
const faltanTexto = (n: number) => `${n === 1 ? "Falta" : "Faltan"} ${unidades(n)} por escanear.`;

/**
 * Pantalla del usuario de escaneo, pensada para el celular (375 px) con la
 * cámara o una pistola Bluetooth. Lista → tocar una venta → escanear cada
 * vape: el SERVIDOR evalúa cada código (progreso por ítem y, si no coincide,
 * dónde está la diferencia) y «Vape escaneado» se habilita solo cuando todo
 * coincide exacto.
 */
export function PantallaEscaneo({ inicial }: { inicial: VentaParaEscanear[] }) {
  const toast = useToast();
  const [ventas, setVentas] = useState(inicial);
  const [actualizando, setActualizando] = useState(false);
  const [seleccionada, setSeleccionada] = useState<VentaParaEscanear | null>(null);

  const refrescar = useCallback(async () => {
    setActualizando(true);
    const r = await pendientesEscaneoAction().catch(() => null);
    setActualizando(false);
    if (r?.ok) setVentas(r.data);
  }, []);

  // Polling liviano mientras se ve la lista (y al volver a la pestaña).
  useEffect(() => {
    if (seleccionada) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refrescar();
    };
    const id = window.setInterval(tick, REFRESCO_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [seleccionada, refrescar]);

  if (seleccionada) {
    return (
      <ModoEscaneo
        key={seleccionada.id}
        venta={seleccionada}
        onVolver={() => {
          setSeleccionada(null);
          void refrescar();
        }}
        onListo={(codigo) => {
          toast.success(`${codigo} escaneada`, "Quedó lista para retirar.");
          setVentas((vs) => vs.filter((v) => v.id !== seleccionada.id));
          setSeleccionada(null);
          void refrescar();
        }}
        onYaNoPendiente={(mensaje) => {
          toast.error("Esta venta ya no está para escanear", mensaje);
          setSeleccionada(null);
          void refrescar();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 font-semibold">Ventas para escanear</h1>
          <p className="text-muted text-small">
            Tocá una venta y escaneá cada vape. La lista se actualiza sola.
          </p>
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => void refrescar()}
          aria-label="Actualizar la lista"
          disabled={actualizando}
        >
          <RefreshCw className={cn(actualizando && "animate-spin")} strokeWidth={1.75} />
        </Button>
      </header>

      {ventas.length === 0 ? (
        <EmptyState
          icon={ScanBarcode}
          title="No hay ventas para escanear"
          description="Cuando te pidan escanear una venta aparece acá."
        />
      ) : (
        <ul aria-label="Ventas para escanear" className="flex flex-col gap-3">
          {ventas.map((v) => {
            const total = v.items.reduce((a, i) => a + i.cantidad, 0);
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSeleccionada(v)}
                  className={cn(
                    cardVariants({ variant: "clickable" }),
                    "flex w-full flex-col gap-3 p-4 text-left",
                  )}
                  data-testid="venta-para-escanear"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base font-semibold">{v.codigo}</span>
                    <span className="flex items-center gap-1">
                      <Badge variant="warning">{unidades(total)}</Badge>
                      <ChevronRight className="text-subtle size-5" strokeWidth={1.75} aria-hidden />
                    </span>
                  </span>
                  <span className="text-muted text-small">
                    {v.vendedor} · {formatearFechaHora(v.fecha)} · {v.deposito}
                  </span>
                  <ul className="border-border flex flex-col gap-1.5 border-t pt-3">
                    {v.items.map((i) => (
                      <li key={i.varianteId} className="flex items-baseline gap-2 text-sm">
                        <span className="w-7 shrink-0 text-right font-semibold tabular-nums">
                          {i.cantidad}×
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{productoDe(i, v)}</span>
                          {i.sabor && <span className="text-muted block">{i.sabor}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Ignite V80 · 8000 pitadas". */
function productoDe(i: ItemEscaneo, v: Pick<VentaParaEscanear, "etiquetaEspecificacion">) {
  const espec = i.especificacion.trim();
  return `${i.marca} ${i.modelo}${espec ? ` · ${espec} ${v.etiquetaEspecificacion.toLowerCase()}` : ""}`;
}

function ModoEscaneo({
  venta,
  onVolver,
  onListo,
  onYaNoPendiente,
}: {
  venta: VentaParaEscanear;
  onVolver: () => void;
  onListo: (codigo: string) => void;
  onYaNoPendiente: (mensaje: string) => void;
}) {
  const feedback = useScanFeedback();
  const soloEscaneo = esPerfilEscaneo(useUsuario());
  const [codigos, setCodigos] = useState<string[]>([]);
  const [evaluacion, setEvaluacion] = useState<EvaluacionEscaneo>(() =>
    evaluarEscaneo(venta.items, [], { etiquetaEspecificacion: venta.etiquetaEspecificacion }),
  );
  const [rechazo, setRechazo] = useState<RechazoEscaneo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const clave = useRef(0);
  // Los escaneos se procesan de a uno (la lista de códigos de cada pedido depende del anterior).
  const cola = useRef<Promise<void>>(Promise.resolve());
  const codigosRef = useRef(codigos);
  codigosRef.current = codigos;

  const procesar = useCallback(
    (codigo: string) => {
      cola.current = cola.current.then(async () => {
        const lista = [...codigosRef.current, codigo];
        const r = await evaluarEscaneoAction({ ventaId: venta.id, codigos: lista }).catch(
          () => null,
        );
        if (!r) {
          feedback.error();
          setError("Sin conexión con el servidor: volvé a escanear ese vape.");
          return;
        }
        if (!r.ok) {
          feedback.error();
          if (r.error.code === "VENTA_NO_PENDIENTE") return onYaNoPendiente(r.error.message);
          setError(r.error.message);
          return;
        }
        const ev = r.data;
        const nuevos = ev.aceptados.map((a) => a.codigo);
        codigosRef.current = nuevos;
        setCodigos(nuevos);
        setEvaluacion(ev);
        setError(null);
        const malo = ev.rechazos.at(-1) ?? null;
        setRechazo(malo);
        if (malo) {
          feedback.error();
          setMensaje({
            tipo: "error",
            texto: malo.resumen,
            detalle: malo.detalles.join(" "),
            clave: ++clave.current,
          });
          // El error se lee mejor fuera de la cámara.
          setCamara(false);
        } else {
          feedback.ok();
          const item = venta.items.find((i) => i.varianteId === ev.aceptados.at(-1)?.varianteId);
          const p = ev.progreso.find((x) => x.varianteId === item?.varianteId);
          setMensaje({
            tipo: "ok",
            texto: item?.sabor ?? item?.titulo ?? "Escaneado",
            detalle: p ? `${p.escaneadas} de ${p.cantidad}` : undefined,
            clave: ++clave.current,
          });
        }
      });
    },
    [feedback, onYaNoPendiente, venta.id, venta.items],
  );

  useBarcodeScanner({ onScan: (c) => procesar(c), enabled: !camara && !confirmando });

  async function confirmar() {
    setConfirmando(true);
    await cola.current;
    const r = await confirmarEscaneoAction({
      ventaId: venta.id,
      codigos: codigosRef.current,
    }).catch(() => null);
    setConfirmando(false);
    if (!r) {
      setError("Sin conexión con el servidor. No se guardó: probá de nuevo.");
      return;
    }
    if (!r.ok) {
      if (r.error.code === "VENTA_NO_PENDIENTE") return onYaNoPendiente(r.error.message);
      setError(r.error.message);
      return;
    }
    onListo(r.data.codigo);
  }

  function reiniciar() {
    codigosRef.current = [];
    setCodigos([]);
    setRechazo(null);
    setError(null);
    setEvaluacion(
      evaluarEscaneo(venta.items, [], { etiquetaEspecificacion: venta.etiquetaEspecificacion }),
    );
  }

  const total = venta.items.reduce((a, i) => a + i.cantidad, 0);
  const escaneadas = evaluacion.progreso.reduce((a, p) => a + p.escaneadas, 0);
  const completo = evaluacion.faltantes.length === 0 && escaneadas === total && total > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onVolver} className="-ml-2">
          <ArrowLeft strokeWidth={1.75} /> Ventas
        </Button>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-2xl font-semibold" data-testid="venta-escaneando">
          {venta.codigo}
        </h1>
        <p className="text-muted text-small">
          {venta.vendedor} · {formatearFechaHora(venta.fecha)} · {venta.deposito}
        </p>
      </header>

      <section aria-label="Escanear" className="bg-card rounded-card flex flex-col gap-3 p-4">
        <p className="text-muted text-small flex items-center gap-2">
          <ScanBarcode className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          Escaneá cada vape con la pistola o la cámara.
        </p>
        <ScanInput
          onScan={(c) => procesar(c)}
          onAbrirCamara={() => {
            feedback.prepararAudio();
            setCamara(true);
          }}
          autoFocus={false}
          placeholder="Escaneá o escribí el código"
        />
        <p
          className={cn(
            "rounded-control flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium tabular-nums",
            completo ? "bg-success-soft text-success-soft-foreground" : "bg-surface-3",
          )}
          data-testid="progreso-escaneo"
        >
          <span>{completo ? "Todo coincide" : `Escaneadas ${escaneadas} de ${total}`}</span>
          {completo && <CheckCircle2 className="size-5" strokeWidth={1.75} aria-hidden />}
        </p>
      </section>

      {rechazo && (
        <div
          role="alert"
          className="bg-danger-soft text-danger-soft-foreground rounded-card flex flex-col gap-1.5 p-4"
          data-testid="error-escaneo"
        >
          <p className="flex items-center gap-2 font-semibold">
            <CircleAlert className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {rechazo.resumen}
          </p>
          {rechazo.escaneado && (
            <p className="text-sm">
              Escaneaste: <strong>{rechazo.escaneado}</strong>
            </p>
          )}
          <ul className="flex flex-col gap-0.5 text-sm">
            {rechazo.detalles.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <p className="text-xs opacity-80">Código {rechazo.codigo} · no se contó.</p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="bg-danger-soft text-danger-soft-foreground rounded-card p-4 text-sm"
        >
          {error}
        </p>
      )}

      <ul aria-label="Lo vendido" className="flex flex-col gap-3">
        {venta.items.map((i) => {
          const p = evaluacion.progreso.find((x) => x.varianteId === i.varianteId);
          const x = p?.escaneadas ?? 0;
          const listo = x >= i.cantidad;
          const conError = rechazo?.varianteIdItem === i.varianteId;
          const campos = conError ? rechazo.campos : [];
          const detalle = (c: CampoDiferencia) =>
            conError ? rechazo.detalles[rechazo.campos.indexOf(c)] : undefined;
          return (
            <li
              key={i.varianteId}
              className={cn(
                "bg-card rounded-card flex flex-col gap-2 border-2 p-4",
                conError ? "border-danger" : listo ? "border-success-soft" : "border-transparent",
              )}
              data-testid="item-escaneo"
              data-error={conError ? campos.join(",") : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Campo
                    etiqueta="Modelo"
                    valor={`${i.marca} ${i.modelo}`}
                    error={campos.includes("producto") ? detalle("producto") : undefined}
                  />
                  {i.especificacion.trim() && (
                    <Campo
                      etiqueta={venta.etiquetaEspecificacion}
                      valor={i.especificacion}
                      error={campos.includes("pitadas") ? detalle("pitadas") : undefined}
                    />
                  )}
                  <Campo
                    etiqueta="Sabor"
                    valor={i.sabor ?? "Sin sabor"}
                    destacado
                    error={campos.includes("sabor") ? detalle("sabor") : undefined}
                  />
                </div>
                <span
                  className={cn(
                    "rounded-control flex shrink-0 flex-col items-center px-3 py-1.5 tabular-nums",
                    listo
                      ? "bg-success-soft text-success-soft-foreground"
                      : campos.includes("unidades")
                        ? "bg-danger-soft text-danger-soft-foreground"
                        : "bg-surface-3",
                  )}
                  aria-label={`${x} de ${i.cantidad} escaneadas`}
                  data-testid="contador-item"
                >
                  <span className="text-xl leading-tight font-semibold">
                    {x}/{i.cantidad}
                  </span>
                  <span className="text-xs">{listo ? "listo" : "unid."}</span>
                </span>
              </div>
              {campos.includes("unidades") && (
                <p className="text-danger text-small font-medium">{detalle("unidades")}</p>
              )}
            </li>
          );
        })}
      </ul>

      {/* Barra de acción pegada abajo (sobre la bottom bar si quien mira tiene navegación). */}
      <div
        className={cn(
          "border-border bg-surface md:rounded-card sticky z-20 -mx-4 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:mx-0 md:border",
          soloEscaneo
            ? "bottom-0"
            : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4",
        )}
      >
        <div className="flex flex-col gap-2">
          {!completo && (
            <p className="text-muted text-small text-center" data-testid="faltan-escanear">
              {evaluacion.faltantes.length
                ? faltanTexto(evaluacion.faltantes.reduce((a, f) => a + f.faltan, 0))
                : ""}
            </p>
          )}
          <div className="flex gap-2">
            {codigos.length > 0 && (
              <Button
                variant="secondary"
                size="lg"
                onClick={reiniciar}
                disabled={confirmando}
                aria-label="Empezar de nuevo"
              >
                <RotateCcw strokeWidth={1.75} />
              </Button>
            )}
            <Button
              size="lg"
              className="min-w-0 flex-1"
              disabled={!completo}
              loading={confirmando}
              onClick={() => void confirmar()}
            >
              <CheckCircle2 strokeWidth={1.75} /> Vape escaneado
            </Button>
          </div>
        </div>
      </div>

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c) => procesar(c)}
        mensaje={mensaje}
        permitirRafaga
        titulo={`Escanear ${venta.codigo}`}
      />
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  error,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  error?: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={cn("flex flex-col", error && "text-danger")}
      data-campo-error={error ? "" : undefined}
    >
      <span className="flex items-baseline gap-2">
        <span className={cn("text-xs", error ? "font-semibold" : "text-muted")}>{etiqueta}</span>
        <span className={cn(destacado ? "text-base font-semibold" : "text-sm font-medium")}>
          {valor}
        </span>
      </span>
      {error && <span className="text-small font-medium">{error}</span>}
    </div>
  );
}
