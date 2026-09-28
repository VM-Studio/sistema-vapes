"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

import { anularCompraAction, recibirCompraAction } from "../actions";

export interface CambioCosto {
  nombre: string;
  antes: string;
  despues: string;
}

export function AccionesCompra({
  id,
  numero,
  estado,
  unidades,
  deposito,
  cambiosDeCosto,
  puedeEditar,
  puedeAnular,
}: {
  id: string;
  numero: number;
  estado: "BORRADOR" | "RECIBIDA" | "ANULADA";
  unidades: number;
  deposito: string;
  cambiosDeCosto: CambioCosto[];
  puedeEditar: boolean;
  puedeAnular: boolean;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  if (estado === "ANULADA" || (!puedeEditar && !puedeAnular)) return null;

  async function recibir(actualizarCostos: boolean) {
    setEnviando(true);
    const r = await recibirCompraAction({ id, actualizarCostos });
    setEnviando(false);
    setRecibiendo(false);
    if (!r.ok) return toast.error("No se pudo recibir", r.error.message);
    invalidarResoluciones();
    toast.success(
      `Compra #${numero} recibida`,
      `Ingresaron ${formatearNumero(r.data.unidades)} unidades${r.data.costosActualizados ? ` · ${r.data.costosActualizados} costo(s) actualizado(s)` : ""}.`,
    );
    router.refresh();
  }

  async function anular() {
    setEnviando(true);
    const r = await anularCompraAction({ id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setErrorMotivo(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo anular", r.error.message);
      return;
    }
    setAnulando(false);
    invalidarResoluciones();
    toast.success(
      `Compra #${numero} anulada`,
      r.data.devoluciones
        ? `${r.data.devoluciones} devolución(es) al proveedor registradas.`
        : undefined,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
      {puedeAnular && (
        <Button variant="secondary" className="text-danger" onClick={() => setAnulando(true)}>
          Anular compra
        </Button>
      )}
      {estado === "BORRADOR" && puedeEditar && (
        <>
          <Link
            href={ruta(`/compras/${id}/editar`)}
            className={buttonVariants({ variant: "secondary" })}
          >
            Editar borrador
          </Link>
          <Button onClick={() => setRecibiendo(true)}>Recibir mercadería</Button>
        </>
      )}

      <Dialog
        open={recibiendo}
        onOpenChange={setRecibiendo}
        title={`Recibir la compra #${numero}`}
        description={`Ingresan ${formatearNumero(unidades)} unidades a ${deposito}.`}
        footer={
          cambiosDeCosto.length > 0 ? (
            <>
              <Button variant="secondary" onClick={() => void recibir(false)} loading={enviando}>
                Recibir sin actualizar costos
              </Button>
              <Button onClick={() => void recibir(true)} loading={enviando}>
                Recibir y actualizar costos
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setRecibiendo(false)} disabled={enviando}>
                Volver
              </Button>
              <Button onClick={() => void recibir(false)} loading={enviando}>
                Recibir
              </Button>
            </>
          )
        }
      >
        {cambiosDeCosto.length > 0 ? (
          <>
            <p className="text-sm font-medium">
              ¿Actualizar los precios de costo con los de esta compra?
            </p>
            <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-sm">
              {cambiosDeCosto.map((c) => {
                const antes = Number(c.antes);
                const despues = Number(c.despues);
                const pct = antes > 0 ? ((despues - antes) / antes) * 100 : null;
                return (
                  <li key={c.nombre} className="flex justify-between gap-3">
                    <span className="truncate">{c.nombre}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatearPesos(antes)} → <strong>{formatearPesos(despues)}</strong>
                      {pct !== null && (
                        <span className={cn("ml-1", pct > 0 ? "text-danger" : "text-success")}>
                          ({pct > 0 ? "+" : ""}
                          {pct.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-muted text-sm">Los costos coinciden con los cargados.</p>
        )}
      </Dialog>

      <Dialog
        open={anulando}
        onOpenChange={setAnulando}
        title={`¿Anular la compra #${numero}?`}
        description={
          estado === "RECIBIDA"
            ? `Se registra una devolución al proveedor por cada producto: salen ${formatearNumero(unidades)} unidades de ${deposito}. Si alguna ya no está en stock, no se anula nada.`
            : "Es un borrador: no mueve stock, solo lo descarta."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setAnulando(false)} disabled={enviando}>
              Volver
            </Button>
            <Button variant="danger" onClick={() => void anular()} loading={enviando}>
              Anular
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          required
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errorMotivo}
        />
      </Dialog>
    </div>
  );
}
