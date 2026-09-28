"use client";

import type { EstadoCotizacion } from "@prisma/client";
import { Check, Copy, FileText, MessageCircle, Pencil, Send, ShoppingCart, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";

import {
  cambiarEstadoCotizacionAction,
  duplicarCotizacionAction,
  pdfCotizacionAction,
  prepararConversionAction,
} from "../actions";

type Cambio = { titulo: string; antes: string; despues: string };

export function AccionesCotizacion({
  id,
  codigo,
  estado,
  vencida,
  whatsapp,
  editable,
  puedeCrear,
  convertible,
  convertirAlCargar,
}: {
  id: string;
  codigo: string;
  estado: EstadoCotizacion;
  vencida: boolean;
  whatsapp: string;
  editable: boolean;
  puedeCrear: boolean;
  convertible: boolean;
  convertirAlCargar: boolean;
}) {
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cambios, setCambios] = useState<Cambio[] | null>(null);
  const iniciado = useRef(false);

  const abierta = estado === "BORRADOR" || estado === "ENVIADA";

  async function estadoA(destino: "ENVIADA" | "ACEPTADA" | "RECHAZADA") {
    setOcupado(destino);
    const r = await cambiarEstadoCotizacionAction({
      id,
      estado: destino,
      ...(destino === "RECHAZADA" && motivo.trim() ? { motivo: motivo.trim() } : {}),
    });
    setOcupado(null);
    setRechazo(false);
    if (!r.ok) return toast.error("No se pudo cambiar el estado", r.error.message);
    router.refresh();
  }

  async function generarPdf() {
    setOcupado("pdf");
    const r = await pdfCotizacionAction({ id });
    setOcupado(null);
    if (!r.ok) return toast.error("No se pudo generar el PDF", r.error.message);
    setPdf(r.data.url);
    window.open(r.data.url, "_blank", "noopener");
  }

  async function duplicarla() {
    setOcupado("duplicar");
    const r = await duplicarCotizacionAction({ id });
    setOcupado(null);
    if (!r.ok) return toast.error("No se pudo duplicar", r.error.message);
    toast.success(`Copia de ${codigo}`, r.data.codigo);
    router.push(ruta(`/cotizador/${r.data.id}/editar`));
  }

  const irAVenta = (recalcular: boolean) =>
    router.push(ruta(`/ventas?nueva=1&cotizacion=${id}${recalcular ? "&recalcular=1" : ""}`));

  async function convertir() {
    if (!vencida) return irAVenta(false);
    setOcupado("convertir");
    const r = await prepararConversionAction({ id });
    setOcupado(null);
    if (!r.ok) return toast.error("No se puede convertir", r.error.message);
    setCambios(r.data.cambios);
  }

  const convertirRef = useRef(convertir);
  convertirRef.current = convertir;
  useEffect(() => {
    if (convertirAlCargar && convertible && !iniciado.current) {
      iniciado.current = true;
      void convertirRef.current();
    }
  }, [convertirAlCargar, convertible]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {convertible && (
          <Button onClick={() => void convertir()} loading={ocupado === "convertir"}>
            <ShoppingCart strokeWidth={1.75} /> Convertir en venta
          </Button>
        )}
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "secondary" })}
          data-testid="whatsapp-cotizacion"
        >
          <MessageCircle strokeWidth={1.75} /> WhatsApp
        </a>
        <Button variant="secondary" onClick={() => void generarPdf()} loading={ocupado === "pdf"}>
          <FileText strokeWidth={1.75} /> PDF
        </Button>
        {editable && (
          <Link
            href={ruta(`/cotizador/${id}/editar`)}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Pencil strokeWidth={1.75} /> Editar
          </Link>
        )}
        {puedeCrear && (
          <Button
            variant="secondary"
            onClick={() => void duplicarla()}
            loading={ocupado === "duplicar"}
          >
            <Copy strokeWidth={1.75} /> Duplicar
          </Button>
        )}
      </div>
      {puedeCrear && abierta && !vencida && (
        <div className="flex flex-wrap gap-2">
          {estado === "BORRADOR" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void estadoA("ENVIADA")}
              loading={ocupado === "ENVIADA"}
            >
              <Send strokeWidth={1.75} /> Marcar enviada
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void estadoA("ACEPTADA")}
            loading={ocupado === "ACEPTADA"}
          >
            <Check strokeWidth={1.75} /> Marcar aceptada
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setRechazo(true)}
          >
            <X strokeWidth={1.75} /> Marcar rechazada
          </Button>
        </div>
      )}
      {pdf && (
        <a
          href={pdf}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary text-sm hover:underline"
          data-testid="pdf-cotizacion"
        >
          Abrir el PDF de {codigo}
        </a>
      )}

      <Dialog
        open={rechazo}
        onOpenChange={setRechazo}
        title={`Rechazar ${codigo}`}
        footer={
          <Button
            variant="danger"
            onClick={() => void estadoA("RECHAZADA")}
            loading={ocupado === "RECHAZADA"}
          >
            Marcar rechazada
          </Button>
        }
      >
        <Input
          label="Motivo (opcional)"
          value={motivo}
          maxLength={500}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Dialog>

      <Dialog
        open={cambios !== null}
        onOpenChange={(o) => !o && setCambios(null)}
        title={`${codigo} está vencida`}
        description="Se va a vender con los precios de hoy."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCambios(null)}>
              Cancelar
            </Button>
            <Button onClick={() => irAVenta(true)}>Convertir con precios de hoy</Button>
          </>
        }
      >
        {cambios && cambios.length === 0 ? (
          <p className="text-sm">Los precios no cambiaron desde que se cotizó.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm tabular-nums" data-testid="cambios-precio">
            {cambios?.map((c) => (
              <li key={c.titulo} className="flex justify-between gap-3">
                <span>{c.titulo}</span>
                <span>
                  <s className="text-muted">{formatearPesos(c.antes)}</s>{" "}
                  <strong>{formatearPesos(c.despues)}</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
