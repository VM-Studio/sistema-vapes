"use client";

import { Copy, Eye, FileText, Loader2, MessageCircle, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { MenuFila, type AccionFila } from "@/components/ui/menu-fila";
import { useToast } from "@/components/ui/toast";
import { rutaPdf } from "@/lib/pdfs";

import { AceptarCotizacion, type GalponAceptar } from "./aceptar-cotizacion";
import { duplicarCotizacionAction, whatsappCotizacionAction } from "./actions";
import { abrirEnPestana } from "./compartir";

/** Acciones rápidas de una fila del listado. */
export function AccionesFila({
  id,
  codigo,
  puedeCrear,
  convertible,
  puedeVender,
  aceptar = null,
}: {
  id: string;
  codigo: string;
  puedeCrear: boolean;
  convertible: boolean;
  puedeVender: boolean;
  /** «Aceptada ✓» (registra la venta pendiente de pago); null = no se ofrece. */
  aceptar?: { total: string; conCliente: boolean; galpones: GalponAceptar[] } | null;
}) {
  const ruta = useRutaPanel();
  const panel = usePanel();
  const router = useRouter();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);

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
  ];

  const menu = <MenuFila acciones={acciones} label={`Acciones de ${codigo}`} />;
  if (!aceptar) return menu;
  return (
    <span className="inline-flex items-center gap-1">
      <AceptarCotizacion id={id} codigo={codigo} {...aceptar} />
      {menu}
    </span>
  );
}
