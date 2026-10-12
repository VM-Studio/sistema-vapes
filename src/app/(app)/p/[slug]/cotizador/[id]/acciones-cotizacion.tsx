"use client";

import type { EstadoCotizacion } from "@prisma/client";
import { Check, Copy, FileText, MessageCircle, Pencil, Send, ShoppingCart, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { horaCotizacion } from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { rutaPdf } from "@/lib/pdfs";
import type { PreparacionConversion } from "@/server/services/cotizacion.service";

import {
  cambiarEstadoCotizacionAction,
  duplicarCotizacionAction,
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
  const panel = usePanel();
  const router = useRouter();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cambios, setCambios] = useState<Cambio[] | null>(null);
  const [cambioBlue, setCambioBlue] = useState<PreparacionConversion["blue"]>(null);
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
    setCambioBlue(r.data.blue);
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

  const botonConvertir = convertible && (
    <Button onClick={() => void convertir()} loading={ocupado === "convertir"}>
      {ocupado !== "convertir" && <ShoppingCart strokeWidth={1.75} />} Convertir en venta
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {puedeCrear && abierta && !vencida ? (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Cambiar estado"
          >
            <span className="text-muted text-small mr-1 hidden lg:inline">Estado:</span>
            {estado === "BORRADOR" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void estadoA("ENVIADA")}
                loading={ocupado === "ENVIADA"}
              >
                <Send strokeWidth={1.75} /> Marcar enviada
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void estadoA("ACEPTADA")}
              loading={ocupado === "ACEPTADA"}
            >
              <Check strokeWidth={1.75} /> Marcar aceptada
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRechazo(true)}>
              <X strokeWidth={1.75} /> Marcar rechazada
            </Button>
          </div>
        ) : (
          <span className="hidden lg:block" />
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary" })}
            data-testid="whatsapp-cotizacion"
          >
            <MessageCircle strokeWidth={1.75} /> WhatsApp
          </a>
          <a
            href={rutaPdf.cotizacion(panel.slug, id)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary" })}
            data-testid="pdf-cotizacion"
          >
            <FileText strokeWidth={1.75} /> PDF
          </a>
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
              {ocupado !== "duplicar" && <Copy strokeWidth={1.75} />} Duplicar
            </Button>
          )}
          {botonConvertir && <span className="hidden md:contents">{botonConvertir}</span>}
        </div>
      </div>
      {botonConvertir && <BarraAccion soloMobile>{botonConvertir}</BarraAccion>}

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
        {cambioBlue?.cotizado &&
          cambioBlue.hoy &&
          cambioBlue.cotizado.valor !== cambioBlue.hoy.valor && (
            <p
              className="bg-surface-3 rounded-control mb-3 px-4 py-3 text-sm tabular-nums"
              data-testid="cambio-blue"
            >
              Dólar blue venta:{" "}
              <s className="text-muted">{formatearPesos(cambioBlue.cotizado.valor)}</s>{" "}
              <strong>{formatearPesos(cambioBlue.hoy.valor)}</strong> (hoy{" "}
              {horaCotizacion(cambioBlue.hoy.obtenidoAt)}). Los precios en dólares se convierten con
              el de hoy.
            </p>
          )}
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
