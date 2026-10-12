"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";
import {
  FRECUENCIA_MINUTOS_MAX,
  FRECUENCIA_MINUTOS_MIN,
  MONEDA_CAMBIO_LABEL,
  type MonedaCambioClave,
} from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";

import {
  actualizarCotizacionesAction,
  guardarFrecuenciaAction,
  guardarOverrideAction,
  quitarOverrideAction,
} from "./actions";

export function BotonActualizar() {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  async function actualizar() {
    setEnviando(true);
    const r = await actualizarCotizacionesAction();
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo actualizar", r.error.message);
    const fallidas = r.data.filter((x) => !x.ok).map((x) => MONEDA_CAMBIO_LABEL[x.moneda]);
    if (fallidas.length === 0) toast.success("Cotizaciones actualizadas");
    else
      toast.error(
        `No respondió ninguna fuente para ${fallidas.join(" y ")}`,
        "Queda la última cotización válida. Si urge, cargala a mano.",
      );
    router.refresh();
  }

  return (
    <Button onClick={actualizar} loading={enviando}>
      <RefreshCw strokeWidth={1.75} aria-hidden /> Actualizar ahora
    </Button>
  );
}

export function OverrideForm({
  moneda,
  override,
}: {
  moneda: MonedaCambioClave;
  override: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [valor, setValor] = useState(override ? String(override) : "");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await guardarOverrideAction({ moneda, valor: valor.replace(",", ".") });
    setEnviando(false);
    if (!r.ok) return setError(r.error.fields?.valor?.[0] ?? r.error.message);
    setError(undefined);
    toast.success(`${MONEDA_CAMBIO_LABEL[moneda]} fijado a mano`);
    router.refresh();
  }

  async function quitar() {
    setEnviando(true);
    const r = await quitarOverrideAction(moneda);
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo quitar", r.error.message);
    setValor("");
    toast.success("Vuelve la cotización automática");
    router.refresh();
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-3">
      <Input
        label="Valor manual (pesos por unidad)"
        hint={
          override
            ? `Vigente: ${formatearPesos(override)}. Pisa a la automática hasta que lo quites.`
            : "Opcional: si lo cargás, pisa a la automática hasta que lo quites."
        }
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        error={error}
        aria-label={`Valor manual de ${MONEDA_CAMBIO_LABEL[moneda]}`}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {override !== null && (
          <Button type="button" variant="secondary" onClick={quitar} disabled={enviando}>
            Quitar override
          </Button>
        )}
        <Button type="submit" variant="secondary" loading={enviando} disabled={!valor.trim()}>
          Usar este valor
        </Button>
      </div>
    </form>
  );
}

export function FrecuenciaForm({ minutos }: { minutos: number }) {
  const router = useRouter();
  const toast = useToast();
  const [valor, setValor] = useState(String(minutos));
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await guardarFrecuenciaAction(valor);
    setEnviando(false);
    if (!r.ok)
      return setError(
        r.error.fields?.minutos?.[0] ?? r.error.fields?._form?.[0] ?? r.error.message,
      );
    setError(undefined);
    toast.success("Frecuencia guardada");
    router.refresh();
  }

  return (
    <SectionCard
      title="Frecuencia"
      description="Cada cuántos minutos se vuelven a consultar las fuentes cuando alguien usa una cotización. Con más de 2 horas sin actualizar se marcan como desactualizadas."
    >
      <form onSubmit={guardar} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          aria-label="Minutos entre actualizaciones"
          type="number"
          min={FRECUENCIA_MINUTOS_MIN}
          max={FRECUENCIA_MINUTOS_MAX}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          error={error}
          containerClassName="flex-1"
        />
        <Button type="submit" loading={enviando} disabled={valor === String(minutos)}>
          Guardar
        </Button>
      </form>
    </SectionCard>
  );
}
