"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

import { actualizarComisionAction } from "../actions";

/** "5.00" → "5"; null → "". */
const aTexto = (v: string | null) => (v === null ? "" : String(Number(v)));

/** Comisión orientativa de un empleado: % sobre ventas unitarias y mayoristas. */
export function ComisionForm({
  usuarioId,
  unitariaPct,
  mayoristaPct,
}: {
  usuarioId: string;
  unitariaPct: string | null;
  mayoristaPct: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [unitaria, setUnitaria] = useState(aTexto(unitariaPct));
  const [mayorista, setMayorista] = useState(aTexto(mayoristaPct));
  const [errores, setErrores] = useState<Record<string, string[] | undefined>>({});
  const [guardando, setGuardando] = useState(false);
  const hayCambios = unitaria !== aTexto(unitariaPct) || mayorista !== aTexto(mayoristaPct);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const r = await actualizarComisionAction({
      id: usuarioId,
      comisionUnitariaPct: unitaria.replace(",", "."),
      comisionMayoristaPct: mayorista.replace(",", "."),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.fields ?? {});
      return toast.error("No se pudo guardar la comisión", r.error.message);
    }
    setErrores({});
    toast.success("Comisión guardada");
    router.refresh();
  }

  return (
    <form
      onSubmit={guardar}
      className="border-border bg-surface flex flex-col gap-4 rounded-card border p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Comisión unitaria %"
          inputMode="decimal"
          placeholder="Sin comisión"
          value={unitaria}
          onChange={(e) => setUnitaria(e.target.value)}
          error={errores.comisionUnitariaPct?.[0]}
        />
        <Input
          label="Comisión mayorista %"
          inputMode="decimal"
          placeholder="Sin comisión"
          value={mayorista}
          onChange={(e) => setMayorista(e.target.value)}
          error={errores.comisionMayoristaPct?.[0]}
        />
      </div>
      <p className="text-muted flex items-start gap-2 text-sm">
        <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        Es orientativa: el dashboard muestra una comisión estimada sobre lo que vendió en cada
        período. No genera pagos ni movimientos.
      </p>
      <div>
        <Button type="submit" disabled={!hayCambios || guardando}>
          {guardando ? "Guardando…" : "Guardar comisión"}
        </Button>
      </div>
    </form>
  );
}
