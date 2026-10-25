"use client";

import { CheckCircle2, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { firmarRemitoAction } from "@/app/(app)/p/[slug]/ganancia/actions";
import { firmarConTokenAction } from "@/app/firma/[token]/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { FirmaCanvas } from "./firma-canvas";

/**
 * El vendedor firma su remito y toca «Firmado»: desde el link público
 * (`token`) o logueado (`liquidacionId`). Después se les manda a los dueños.
 */
export function FirmarRemito({
  nombre,
  modo,
}: {
  nombre: string;
  modo: { token: string } | { liquidacionId: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [firma, setFirma] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);

  async function firmar() {
    if (!firma) return setError("Firmá en el recuadro antes de tocar «Firmado»");
    setEnviando(true);
    const r =
      "token" in modo
        ? await firmarConTokenAction({ token: modo.token, firma })
        : await firmarRemitoAction({ id: modo.liquidacionId, firma });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.firma?.[0] ?? r.error.message);
      return toast.error("No se pudo firmar", r.error.message);
    }
    setListo(true);
    toast.success("¡Remito firmado!");
    router.refresh();
  }

  if (listo)
    return (
      <div className="bg-success-soft text-success-soft-foreground rounded-card flex items-center gap-3 p-4">
        <CheckCircle2 className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
        <p className="text-sm font-medium">Firmado. Les llegó el remito a los dueños.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="firmar-remito">
      <FirmaCanvas
        label={`Tu firma (${nombre})`}
        onChange={(v) => {
          setFirma(v);
          if (v) setError(undefined);
        }}
        error={error}
      />
      <Button size="lg" fullWidth onClick={() => void firmar()} loading={enviando}>
        <PenLine strokeWidth={1.75} aria-hidden /> Firmado
      </Button>
    </div>
  );
}
