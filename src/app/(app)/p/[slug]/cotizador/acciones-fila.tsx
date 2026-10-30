"use client";

import {
  Ban,
  Copy,
  Eye,
  FileText,
  Loader2,
  MessageCircle,
  Pencil,
  ShoppingCart,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { MenuFila, type AccionFila } from "@/components/ui/menu-fila";
import { useToast } from "@/components/ui/toast";
import { rutaPdf } from "@/lib/pdfs";

import { AceptarCotizacion, type GalponAceptar } from "./aceptar-cotizacion";
import { duplicarCotizacionAction, whatsappCotizacionAction } from "./actions";
import { DialogoAnularCotizacion } from "./anular-cotizacion";
import { abrirEnPestana } from "./compartir";

/** Acciones rápidas de una fila del listado. */
export function AccionesFila({
  id,
  codigo,
  puedeCrear,
  convertible,
  puedeVender,
  editable = false,
  anulable = false,
  aceptar = null,
}: {
  id: string;
  codigo: string;
  puedeCrear: boolean;
  convertible: boolean;
  puedeVender: boolean;
  /** COTIZADOR "crear" y en un estado editable: ofrece «Editar». */
  editable?: boolean;
  /** COTIZADOR "crear" y sin convertir ni anular: ofrece «Anular» (con confirmación). */
  anulable?: boolean;
  /** «Aceptada ✓» (registra la venta pendiente de pago); null = no se ofrece. */
  aceptar?: { total: string; conCliente: boolean; galpones: GalponAceptar[] } | null;
}) {
  const ruta = useRutaPanel();
  const panel = usePanel();
  const router = useRouter();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);

  async function compartir() {
    setOcupado("whatsapp");
    const error = await abrirEnPestana(() => whatsappCotizacionAction({ id }));
    setOcupado(null);
    if (error) toast.error("No se pudo abrir", error);
  }

  async function duplicarla() {
    setOcupado("duplicar");
    const r = await duplicarCotizacionAction({ id });
    setOcupado(null);
    if (!r.ok) return toast.error("No se pudo duplicar", r.error.message);
    toast.success(`Copia de ${codigo}`, r.data.codigo);
    router.push(ruta(`/cotizador/${r.data.id}/editar`));
  }

  if (ocupado) {
    return (
      <span
        className="text-muted inline-flex size-9 items-center justify-center"
        role="status"
        aria-label={`Procesando ${codigo}`}
      >
        <Loader2 className="size-5 animate-spin" strokeWidth={1.75} aria-hidden />
      </span>
    );
  }

  const acciones: AccionFila[] = [
    { label: "Ver", icon: Eye, href: ruta(`/cotizador/${id}`) },
    ...(editable ? [{ label: "Editar", icon: Pencil, href: ruta(`/cotizador/${id}/editar`) }] : []),
    ...(puedeCrear ? [{ label: "Duplicar", icon: Copy, onSelect: () => void duplicarla() }] : []),
    { label: "WhatsApp", icon: MessageCircle, onSelect: () => void compartir() },
    { label: "PDF", icon: FileText, href: rutaPdf.cotizacion(panel.slug, id), externo: true },
    ...(convertible && puedeVender
      ? [
          {
            label: "Convertir en venta",
            icon: ShoppingCart,
            href: ruta(`/cotizador/${id}?convertir=1`),
          },
        ]
      : []),
    ...(anulable
      ? [{ label: "Anular", icon: Ban, peligro: true, onSelect: () => setAnulando(true) }]
      : []),
  ];

  const menu = (
    <>
      <MenuFila acciones={acciones} label={`Acciones de ${codigo}`} />
      {anulable && (
        <DialogoAnularCotizacion
          id={id}
          codigo={codigo}
          open={anulando}
          onOpenChange={setAnulando}
        />
      )}
    </>
  );
  if (!aceptar) return menu;
  return (
    <span className="inline-flex items-center gap-1">
      <AceptarCotizacion id={id} codigo={codigo} {...aceptar} />
      {menu}
    </span>
  );
}
