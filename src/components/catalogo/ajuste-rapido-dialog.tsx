"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ajusteAction } from "@/app/(app)/p/[slug]/stock/movimientos/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { conSigno } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface VarianteParaAjuste {
  varianteId: string;
  nombre: string;
  porDeposito: Record<string, number>;
}

/**
 * Ajuste por conteo: el usuario dice cuántas hay en realidad; el servidor
 * calcula la diferencia contra el stock actual (con bloqueo) y genera el
 * AJUSTE_POSITIVO/NEGATIVO. Acá solo se muestra la diferencia estimada.
 */
export function AjusteRapidoDialog({
  variante,
  depositos,
  depositoInicial,
  onOpenChange,
}: {
  variante: VarianteParaAjuste | null;
  depositos: { id: string; nombre: string }[];
  depositoInicial?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [depositoId, setDepositoId] = useState(depositoInicial ?? depositos[0]?.id ?? "");
  const [real, setReal] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  const sistema = variante?.porDeposito[depositoId] ?? 0;
  const realNum = real.trim() === "" ? null : Number(real);
  const diferencia = realNum !== null && Number.isInteger(realNum) ? realNum - sistema : null;

  function cerrar() {
    setReal("");
    setMotivo("");
    setErrores({});
    onOpenChange(false);
  }

  async function confirmar() {
    if (!variante) return;
    setEnviando(true);
    const r = await ajusteAction({
      depositoId,
      varianteId: variante.varianteId,
      cantidadReal: real,
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      if (r.error.fields) {
        setErrores(
          Object.fromEntries(Object.entries(r.error.fields).map(([k, v]) => [k, v[0] ?? ""])),
        );
      } else toast.error("No se pudo ajustar", r.error.message);
      return;
    }
    toast.success(
      "Stock ajustado",
      `${r.data.nombre}: ${r.data.stockAnterior} → ${r.data.cantidadReal} (${conSigno(r.data.diferencia)})`,
    );
    cerrar();
    router.refresh();
  }

  return (
    <Dialog
      open={variante !== null}
      onOpenChange={(o) => (o ? onOpenChange(true) : cerrar())}
      title="Ajustar stock"
      description={variante?.nombre}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            loading={enviando}
            disabled={diferencia === null || diferencia === 0}
          >
            Confirmar ajuste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Depósito"
          options={depositos.map((d) => ({
            value: d.id,
            label: `${d.nombre} (${variante?.porDeposito[d.id] ?? 0} u.)`,
          }))}
          value={depositoId}
          onChange={(e) => setDepositoId(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-2 rounded-control p-3">
            <p className="text-muted text-xs">Sistema</p>
            <p className="text-2xl font-semibold tabular-nums">{sistema}</p>
          </div>
          <Input
            label="Conteo real"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            value={real}
            onChange={(e) => setReal(e.target.value.replace(/\D/g, ""))}
            error={errores.cantidadReal}
            className="text-2xl font-semibold tabular-nums"
          />
        </div>
        {diferencia !== null && (
          <p
            className={cn(
              "rounded-control px-3 py-2 text-sm font-medium",
              diferencia === 0
                ? "bg-surface-2 text-muted"
                : diferencia > 0
                  ? "bg-success-soft text-success-soft-foreground"
                  : "bg-warning-soft text-warning-soft-foreground",
            )}
          >
            {diferencia === 0
              ? "Coincide con el sistema: no hay nada que ajustar."
              : `Se registra un ajuste ${diferencia > 0 ? "positivo" : "negativo"} de ${Math.abs(diferencia)} unidad${Math.abs(diferencia) === 1 ? "" : "es"} (${sistema} → ${realNum}).`}
          </p>
        )}
        <Textarea
          label="Motivo"
          required
          rows={2}
          placeholder="Ej: recuento, rotura, vencido…"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
          hint="Obligatorio (mínimo 5 caracteres). Queda en el historial."
        />
      </div>
    </Dialog>
  );
}
