"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";

import { transferirAhoraAction } from "./movimientos/actions";

export interface FilaATransferir {
  varianteId: string;
  nombre: string;
  /** Unidades del sabor en el galpón de origen. */
  disponible: number;
}

/**
 * "Transferir a {otro galpón}" desde la fila del stock: cantidad (y destino
 * si hay más de un galpón más) y listo. La transferencia se crea y se
 * completa en el acto: el stock se mueve ya y el total del panel no cambia.
 */
export function TransferirSheet({
  fila,
  origen,
  destinos,
  onCerrar,
}: {
  fila: FilaATransferir | null;
  origen: { id: string; nombre: string };
  destinos: { id: string; nombre: string }[];
  onCerrar: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [destinoId, setDestinoId] = useState(destinos[0]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const destino = destinos.find((d) => d.id === destinoId);

  async function confirmar() {
    if (!fila || !destino) return;
    setEnviando(true);
    setError(null);
    const r = await transferirAhoraAction({
      varianteId: fila.varianteId,
      depositoOrigenId: origen.id,
      depositoDestinoId: destino.id,
      cantidad,
      notas: notas.trim() || undefined,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    invalidarResoluciones();
    toast.success(
      `Transferencia #${r.data.numero} completada`,
      `${r.data.unidades} u. de ${fila.nombre}: ${origen.nombre} → ${destino.nombre}`,
    );
    onCerrar();
    router.refresh();
  }

  return (
    <Sheet
      open={fila !== null}
      onOpenChange={(o) => !o && onCerrar()}
      title={destinos.length === 1 ? `Transferir a ${destinos[0]!.nombre}` : "Transferir"}
      description={fila?.nombre}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} loading={enviando} disabled={!destino || cantidad < 1}>
            Transferir {cantidad} u.
          </Button>
        </>
      }
    >
      {fila && (
        <div className="flex flex-col gap-4">
          <p className="bg-surface-2 flex items-center gap-2 rounded-control px-3 py-2.5 text-sm">
            <strong>{origen.nombre}</strong>
            <ArrowRight className="text-muted size-4" strokeWidth={1.75} aria-label="a" />
            <strong>{destino?.nombre ?? "—"}</strong>
            <span className="text-muted ml-auto tabular-nums">
              Hay {fila.disponible} en {origen.nombre}
            </span>
          </p>
          {destinos.length > 1 && (
            <Select
              label="Galpón de destino"
              options={destinos.map((d) => ({ value: d.id, label: d.nombre }))}
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
            />
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Cantidad
            <CantidadInput
              etiqueta="Cantidad a transferir"
              valor={cantidad}
              onCambio={setCantidad}
              min={1}
              max={Math.max(1, fila.disponible)}
              className="text-2xl font-semibold"
            />
          </label>
          <Input
            label="Nota (opcional)"
            value={notas}
            maxLength={500}
            onChange={(e) => setNotas(e.target.value)}
          />
          {error && (
            <p className="text-danger text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
