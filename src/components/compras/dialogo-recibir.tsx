"use client";

import { Loader2 } from "lucide-react";

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
        <p className="text-muted flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Comparando con los precios de{" "}
          {proveedor}…
        </p>
      ) : hayCambios ? (
        <>
          <p className="text-sm font-medium">
            ¿Actualizar el precio de {proveedor} con estos costos?
          </p>
          <ul
            aria-label="Precios que cambian"
            className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-sm"
          >
            {cambios.map((c) => (
              <li key={c.productoId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{c.nombreCompleto}</span>
                <span className="shrink-0 tabular-nums">
                  {c.antes === null ? (
                    <>
                      sin precio → <strong>{formatearPesos(c.despues)}</strong>
                    </>
                  ) : (
                    <>
                      de {formatearMonto(c.antes, c.monedaAntes)} a{" "}
                      <strong>{formatearPesos(c.despues)}</strong>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted text-xs">
            Si hay varios sabores del mismo producto con costos distintos, queda el del último
            cargado.
          </p>
        </>
      ) : (
        <p className="text-muted text-sm">Los costos coinciden con los precios de {proveedor}.</p>
      )}
    </Dialog>
  );
}
