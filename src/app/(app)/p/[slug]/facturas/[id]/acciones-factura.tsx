"use client";

import { Ban, Hash, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

import { anularFacturaAction, numeroExternoAction, subirPdfFacturaAction } from "../actions";

/** Número fiscal, PDF real (FACTURAS "editar") y anulación (dueños) de una factura. */
export function AccionesFactura({
  id,
  codigo,
  emitida,
  numeroExterno,
  interna,
  puedeEditar,
  puedeAnular,
}: {
  id: string;
  codigo: string;
  emitida: boolean;
  numeroExterno: string | null;
  interna: boolean;
  puedeEditar: boolean;
  puedeAnular: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [dialogo, setDialogo] = useState<null | "numero" | "anular">(null);
  const [numero, setNumero] = useState(numeroExterno ?? "");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!emitida) return null;

  async function correr(
    fn: () => Promise<{ ok: boolean; error?: { message: string } } | null>,
    ok: string,
  ) {
    setOcupado(true);
    const r = await fn().catch(() => null);
    setOcupado(false);
    if (!r) return toast.error("Sin conexión", "Probá de nuevo.");
    if (!r.ok) return toast.error("No se pudo", r.error?.message);
    toast.success(ok, codigo);
    setDialogo(null);
    router.refresh();
  }

  async function subir(file: File) {
    const form = new FormData();
    form.set("id", id);
    form.set("archivo", file);
    await correr(() => subirPdfFacturaAction(form), "PDF subido");
  }

  return (
    <>
      {puedeEditar && !interna && (
        <>
          <Button variant="secondary" onClick={() => setDialogo("numero")}>
            <Hash strokeWidth={1.75} /> Número fiscal
          </Button>
          <Button
            variant="secondary"
            loading={ocupado && dialogo === null}
            onClick={() => archivo.current?.click()}
          >
            <Upload strokeWidth={1.75} /> Subir PDF
          </Button>
          <input
            ref={archivo}
            type="file"
            accept="application/pdf"
            className="hidden"
            aria-label="PDF de la factura"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void subir(f);
            }}
          />
        </>
      )}
      {puedeAnular && (
        <Button variant="danger" onClick={() => setDialogo("anular")}>
          <Ban strokeWidth={1.75} /> Anular
        </Button>
      )}
      <Dialog
        open={dialogo === "numero"}
        onOpenChange={(o) => !o && setDialogo(null)}
        title="Número fiscal"
        description="El número que asignó AFIP al emitirla (punto de venta y número)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogo(null)}>
              Cancelar
            </Button>
            <Button
              loading={ocupado}
              onClick={() =>
                void correr(
                  () => numeroExternoAction({ id, numeroExterno: numero }),
                  "Número guardado",
                )
              }
            >
              Guardar
            </Button>
          </>
        }
      >
        <Input
          label="Número fiscal"
          placeholder="0001-00001234"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
        />
      </Dialog>
      <Dialog
        open={dialogo === "anular"}
        onOpenChange={(o) => !o && setDialogo(null)}
        title={`¿Anular ${codigo}?`}
        description="Queda en el historial como anulada. Si era de una venta, la venta se puede volver a facturar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogo(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={ocupado}
              disabled={motivo.trim().length < 3}
              onClick={() =>
                void correr(() => anularFacturaAction({ id, motivo }), "Factura anulada")
              }
            >
              Anular
            </Button>
          </>
        }
      >
        <Textarea
          label="Motivo"
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Dialog>
    </>
  );
}
