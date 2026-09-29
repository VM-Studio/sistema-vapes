"use client";

import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatearNumero, formatearPesos } from "@/lib/format";
import type { CambioPrecioProveedor } from "@/server/services/compra.service";

import { formatearMonto } from "./formato";

/**
 * Confirmación de "Recibir mercadería". Si hay productos cuyo precio del
 * proveedor cambiaría con los costos de esta compra, pregunta si
 * actualizarlo (listando "de $X a $Y"); si no, solo confirma.
 * `cambios === null`: todavía se están calculando.
 */
export function DialogoRecibir({
  abierto,
  onCerrar,
  proveedor,
  deposito,
  unidades,
  cambios,
  enviando,
  onConfirmar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  proveedor: string;
  deposito: string;
  unidades: number;
  cambios: CambioPrecioProveedor[] | null;
  enviando: boolean;
  onConfirmar: (actualizarPrecioProveedor: boolean) => void;
}) {
  const hayCambios = cambios !== null && cambios.length > 0;
  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => !o && !enviando && onCerrar()}
      title="Recibir mercadería"
      description={`Ingresan ${formatearNumero(unidades)} unidades a ${deposito}.`}
      footer={
        hayCambios ? (
          <>
            <Button variant="secondary" onClick={() => onConfirmar(false)} disabled={enviando}>
              No, recibir sin actualizar
            </Button>
            <Button onClick={() => onConfirmar(true)} loading={enviando}>
              Sí, recibir y actualizar
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
              Volver
            </Button>
            <Button
              onClick={() => onConfirmar(false)}
              loading={enviando}
              disabled={cambios === null}
            >
              Recibir
            </Button>
          </>
        )
      }
    >
      {cambios === null ? (
        <p className="text-muted text-small flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden /> Comparando con
          los precios de {proveedor}…
        </p>
      ) : hayCambios ? (
        <div className="flex flex-col gap-3">
          <p className="text-body font-medium">
            ¿Actualizar el precio de {proveedor} con estos costos?
          </p>
          <div className="border-border bg-surface rounded-card overflow-hidden border">
            <div
              aria-hidden
              className="border-border bg-card text-muted flex h-9 items-center justify-between gap-3 border-b px-3 text-xs font-medium"
            >
              <span>Producto</span>
              <span>Precio actual → nuevo</span>
            </div>
            <ul
              aria-label="Precios que cambian"
              className="divide-border text-small flex max-h-60 flex-col divide-y overflow-y-auto"
            >
              {cambios.map((c) => (
                <li
                  key={c.productoId}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 truncate font-medium">{c.nombreCompleto}</span>
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                    {c.antes === null ? (
                      <span className="text-subtle">sin precio</span>
                    ) : (
                      <span className="text-muted">
                        <span className="sr-only">de </span>
                        {formatearMonto(c.antes, c.monedaAntes)}
                        <span className="sr-only"> a </span>
                      </span>
                    )}
                    <ArrowRight
                      className="text-subtle size-4 shrink-0"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <strong className="font-semibold">{formatearPesos(c.despues)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-subtle text-small">
            Si hay varios sabores del mismo producto con costos distintos, queda el del último
            cargado.
          </p>
        </div>
      ) : (
        <p className="text-muted text-small">
          Los costos coinciden con los precios de {proveedor}.
        </p>
      )}
    </Dialog>
  );
}
