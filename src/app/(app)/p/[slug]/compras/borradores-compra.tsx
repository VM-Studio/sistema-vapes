"use client";

import { FilePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";
import { formatearNumero } from "@/lib/format";
import { formatearFechaHora } from "@/lib/utils";
import type { BorradorCompraListado } from "@/server/services/borrador-compra.service";

import { descartarBorradorCompraAction } from "./actions";

/**
 * «Compras en curso»: los borradores que se guardaron solos mientras se
 * armaba una compra nueva. «Continuar» la retoma tal cual quedó; «Descartar»
 * la borra (pide confirmación). Arriba del listado de Compras.
 */
export function BorradoresCompra({ borradores }: { borradores: BorradorCompraListado[] }) {
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const [preguntando, setPreguntando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  async function descartar(id: string) {
    setEnviando(id);
    const r = await descartarBorradorCompraAction({ id });
    setEnviando(null);
    setPreguntando(null);
    if (!r.ok) return toast.error("No se pudo descartar", r.error.message);
    toast.success("Borrador descartado");
    router.refresh();
  }

  return (
    <SectionCard
      title={`Compras en curso (${borradores.length})`}
      description="Borradores que se guardaron solos mientras armabas la compra. Seguí donde la dejaste."
      className="mb-6"
      contentClassName="pt-3"
    >
      <ul aria-label="Borradores de compras" className="divide-border flex flex-col divide-y">
        {borradores.map((b) => (
          <li
            key={b.id}
            data-testid="borrador-compra"
            className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="bg-surface text-muted rounded-control flex size-10 shrink-0 items-center justify-center">
                <FilePen className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{b.proveedor ?? "Sin proveedor"}</span>
                <span className="text-muted text-small">
                  {formatearNumero(b.items)} {b.items === 1 ? "ítem" : "ítems"} ·{" "}
                  {formatearNumero(b.unidades)} u. · de {b.usuario} · guardado{" "}
                  {formatearFechaHora(b.updatedAt)}
                </span>
              </div>
            </div>
            {preguntando === b.id ? (
              <div className="flex items-center justify-end gap-2">
                <span className="text-small">¿Descartar lo cargado?</span>
                <Button
                  variant="danger"
                  size="sm"
                  loading={enviando === b.id}
                  onClick={() => void descartar(b.id)}
                >
                  Sí, descartar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={enviando === b.id}
                  onClick={() => setPreguntando(null)}
                >
                  No
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreguntando(b.id)}
                  aria-label={`Descartar el borrador de ${b.proveedor ?? "compra"}`}
                >
                  <Trash2 strokeWidth={1.75} /> Descartar
                </Button>
                <Link
                  href={ruta(`/compras/nueva?borrador=${b.id}`)}
                  className={buttonVariants({ size: "sm" })}
                >
                  Continuar
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
