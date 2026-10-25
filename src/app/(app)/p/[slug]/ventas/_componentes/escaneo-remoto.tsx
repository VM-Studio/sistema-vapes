"use client";

import { Clock, PackageCheck, ScanBarcode, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { EstadoEscaneoVenta } from "@/server/services/escaneo-remoto.service";

import { cancelarEscaneoAction, pedirEscaneoAction } from "../actions";

/** Badge del escaneo remoto en listados y detalle (nada si no se pidió). */
export function EscaneoBadge({
  escaneo,
  anulada = false,
}: {
  escaneo: EstadoEscaneoVenta;
  anulada?: boolean;
}) {
  if (!escaneo.estado || anulada) return null;
  if (escaneo.estado === "PENDIENTE")
    return (
      <Badge variant="warning" data-testid="badge-escaneo">
        <Clock strokeWidth={2} aria-hidden /> Esperando escaneo de {NOMBRE_ESCANEO}
      </Badge>
    );
  return (
    <Badge
      variant="success"
      data-testid="badge-escaneo"
      title={escaneo.escaneadaAt ? formatearFechaHora(escaneo.escaneadaAt) : undefined}
    >
      <PackageCheck strokeWidth={2} aria-hidden /> Escaneado por{" "}
      {escaneo.escaneadaPor ?? NOMBRE_ESCANEO} · listo para retirar
    </Badge>
  );
}

/**
 * Tarjeta «Escanea Charly» del detalle de la venta: estado, quién y cuándo, y
 * los botones para pedirlo o cancelarlo (vendedor de la venta o dueño).
 */
export function EscaneoRemotoVenta({
  ventaId,
  escaneo,
  deposito,
  unidades,
  motivoNoEscaneable,
  puedeGestionar,
}: {
  ventaId: string;
  escaneo: EstadoEscaneoVenta;
  deposito: string;
  unidades: number;
  /** null = se puede pedir. */
  motivoNoEscaneable: string | null;
  /** Vendedor de la venta o dueño, con VENTAS "crear". */
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  async function ejecutar(accion: "pedir" | "cancelar") {
    setEnviando(true);
    const r = await (accion === "pedir" ? pedirEscaneoAction : cancelarEscaneoAction)({
      ventaId,
    }).catch(() => null);
    setEnviando(false);
    if (!r) return toast.error("Sin conexión con el servidor", "Probá de nuevo.");
    if (!r.ok) return toast.error("No se pudo", r.error.message);
    toast.success(
      accion === "pedir"
        ? `Le pediste a ${NOMBRE_ESCANEO} que escanee ${r.data.codigo}`
        : `Cancelaste el escaneo de ${r.data.codigo}`,
    );
    router.refresh();
  }

  const escaneada = escaneo.estado === "ESCANEADA";
  const pendiente = escaneo.estado === "PENDIENTE";

  return (
    <section
      aria-label={`Escanea ${NOMBRE_ESCANEO}`}
      data-testid="escaneo-remoto-venta"
      className={cn(
        "rounded-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between",
        escaneada
          ? "bg-success-soft text-success-soft-foreground"
          : pendiente
            ? "bg-warning-soft text-warning-soft-foreground"
            : "bg-card",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {escaneada ? (
          <PackageCheck className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        ) : (
          <ScanBarcode className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        )}
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          {escaneada ? (
            <>
              <p className="font-semibold">
                Escaneado por {escaneo.escaneadaPor ?? NOMBRE_ESCANEO} · listo para retirar
              </p>
              <p>
                {escaneo.escaneadaAt && `${formatearFechaHora(escaneo.escaneadaAt)} · `}
                Todo coincidió con lo vendido. Stock descontado de {deposito}: {unidades}{" "}
                {unidades === 1 ? "unidad" : "unidades"}.
              </p>
            </>
          ) : pendiente ? (
            <>
              <p className="font-semibold">Esperando escaneo de {NOMBRE_ESCANEO}</p>
              <p>
                Pedido por {escaneo.pedidoPor}
                {escaneo.pedidoAt && ` el ${formatearFechaHora(escaneo.pedidoAt)}`}. El stock ya se
                descontó de {deposito}.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Escanea {NOMBRE_ESCANEO}</p>
              <p className="text-muted">
                Opcional: {NOMBRE_ESCANEO} escanea los vapes en {deposito} y te avisa cuando están
                listos para retirar.
              </p>
            </>
          )}
        </div>
      </div>
      {puedeGestionar && pendiente && (
        <Button
          variant="secondary"
          onClick={() => void ejecutar("cancelar")}
          loading={enviando}
          className="md:shrink-0"
        >
          <X strokeWidth={1.75} /> Cancelar pedido
        </Button>
      )}
      {puedeGestionar && !escaneo.estado && motivoNoEscaneable === null && (
        <Button onClick={() => void ejecutar("pedir")} loading={enviando} className="md:shrink-0">
          <ScanBarcode strokeWidth={1.75} /> Escanea {NOMBRE_ESCANEO}
        </Button>
      )}
    </section>
  );
}
