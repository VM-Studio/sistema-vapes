"use client";

import { Hourglass, PackageCheck, PackageOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { EstadoRetiro } from "@/server/services/retiro.service";

import { marcarRetiradaAction } from "../retiro-actions";

/** «Retirada el …» o «Pendiente de retiro» (nada en ventas anuladas). */
export function RetiroBadge({
  retiro,
  anulada = false,
}: {
  retiro: EstadoRetiro;
  anulada?: boolean;
}) {
  if (anulada) return null;
  if (retiro.retiradaAt)
    return (
      <Badge
        variant="neutral"
        data-testid="badge-retiro"
        title={retiro.retiradaPor ? `Marcó ${retiro.retiradaPor}` : undefined}
      >
        <PackageCheck strokeWidth={2} aria-hidden /> Retirada el{" "}
        {formatearFechaHora(retiro.retiradaAt)}
      </Badge>
    );
  return (
    <Badge variant="warning" data-testid="badge-retiro">
      <Hourglass strokeWidth={2} aria-hidden /> Pendiente de retiro
    </Badge>
  );
}

/** Botón «Retirado»: marca que el cliente se llevó la mercadería (no se deshace). */
export function BotonRetirado({
  ventaId,
  codigo,
  variant = "primary",
  size,
  className,
  onListo,
}: {
  ventaId: string;
  codigo: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm";
  className?: string;
  /** Además del refresh (ej: sacarla de una lista local). */
  onListo?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  async function marcar() {
    setEnviando(true);
    const r = await marcarRetiradaAction({ ventaId }).catch(() => null);
    setEnviando(false);
    if (!r) return toast.error("Sin conexión con el servidor", "Probá de nuevo.");
    if (!r.ok) return toast.error("No se pudo marcar como retirada", r.error.message);
    toast.success(`Venta ${r.data.codigo} retirada`, "Quedó registrado que se la llevaron.");
    onListo?.();
    router.refresh();
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void marcar();
      }}
      loading={enviando}
      className={className}
      aria-label={`Marcar la venta ${codigo} como retirada`}
      data-testid="boton-retirado"
    >
      <PackageOpen strokeWidth={1.75} /> Retirado
    </Button>
  );
}

/** Tarjeta del detalle de la venta: estado del retiro y el botón «Retirado». */
export function RetiroVenta({
  ventaId,
  codigo,
  retiro,
  motivoNoRetirable,
  puedeMarcar,
  deposito,
}: {
  ventaId: string;
  codigo: string;
  retiro: EstadoRetiro;
  /** null = se puede marcar. */
  motivoNoRetirable: string | null;
  puedeMarcar: boolean;
  deposito: string;
}) {
  const retirada = retiro.retiradaAt !== null;
  return (
    <section
      aria-label="Retiro"
      data-testid="retiro-venta"
      className={cn(
        "rounded-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between",
        retirada ? "bg-card" : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {retirada ? (
          <PackageCheck className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        ) : (
          <Hourglass className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
        )}
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          {retirada ? (
            <>
              <p className="font-semibold">
                Retirada el {formatearFechaHora(retiro.retiradaAt!)}
                {retiro.retiradaPor && ` · marcó ${retiro.retiradaPor}`}
              </p>
              <p className="text-muted">La mercadería ya salió de {deposito}.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Pendiente de retiro</p>
              <p>
                El stock ya se descontó al vender, pero la mercadería sigue en {deposito} hasta que
                el cliente la retire.
                {motivoNoRetirable && ` ${motivoNoRetirable}`}
              </p>
            </>
          )}
        </div>
      </div>
      {!retirada && puedeMarcar && motivoNoRetirable === null && (
        <BotonRetirado ventaId={ventaId} codigo={codigo} className="md:shrink-0" />
      )}
    </section>
  );
}
