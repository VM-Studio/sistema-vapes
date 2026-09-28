"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DialogoRecibir } from "@/components/compras/dialogo-recibir";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { formatearNumero } from "@/lib/format";
import type { CambioPrecioProveedor } from "@/server/services/compra.service";

import { anularCompraAction, recibirCompraAction } from "../actions";

export function AccionesCompra({
  id,
  idVisible,
  estado,
  unidades,
  deposito,
  proveedor,
  cambios,
  puedeEditar,
  puedeAnular,
}: {
  id: string;
  idVisible: string;
  estado: "BORRADOR" | "RECIBIDA" | "ANULADA";
  unidades: number;
  deposito: string;
  proveedor: string;
  cambios: CambioPrecioProveedor[];
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

  async function recibir(actualizarPrecioProveedor: boolean) {
    setEnviando(true);
    const r = await recibirCompraAction({ id, actualizarPrecioProveedor });
    setEnviando(false);
    setRecibiendo(false);
    if (!r.ok) return toast.error("No se pudo recibir", r.error.message);
    invalidarResoluciones();
    toast.success(
      `Compra ${idVisible} recibida`,
      `Ingresaron ${formatearNumero(r.data.unidades)} unidades a ${deposito}${r.data.preciosActualizados ? ` · ${r.data.preciosActualizados} precio(s) de ${proveedor} actualizado(s)` : ""}.`,
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
      `Compra ${idVisible} anulada`,
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

      <DialogoRecibir
        abierto={recibiendo}
        onCerrar={() => setRecibiendo(false)}
        proveedor={proveedor}
        deposito={deposito}
        unidades={unidades}
        cambios={cambios}
        enviando={enviando}
        onConfirmar={(a) => void recibir(a)}
      />

      <Dialog
        open={anulando}
        onOpenChange={setAnulando}
        title={`¿Anular la compra ${idVisible}?`}
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
