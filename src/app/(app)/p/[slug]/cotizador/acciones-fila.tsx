"use client";

import { Copy, Eye, FileText, MessageCircle, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { duplicarCotizacionAction, pdfCotizacionAction, whatsappCotizacionAction } from "./actions";
import { abrirEnPestana } from "./compartir";

/** Acciones rápidas de una fila del listado. */
export function AccionesFila({
  id,
  codigo,
  puedeCrear,
  convertible,
  puedeVender,
}: {
  id: string;
  codigo: string;
  puedeCrear: boolean;
  convertible: boolean;
  puedeVender: boolean;
}) {
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function compartir(tipo: "pdf" | "whatsapp") {
    setOcupado(tipo);
    const error = await abrirEnPestana(() =>
      tipo === "pdf" ? pdfCotizacionAction({ id }) : whatsappCotizacionAction({ id }),
    );
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

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={ruta(`/cotizador/${id}`)}
        className={buttonVariants({ variant: "ghost", size: "icon" })}
        aria-label={`Ver ${codigo}`}
        title="Ver"
      >
        <Eye strokeWidth={1.75} />
      </Link>
      {puedeCrear && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Duplicar ${codigo}`}
          title="Duplicar"
          loading={ocupado === "duplicar"}
          onClick={() => void duplicarla()}
        >
          <Copy strokeWidth={1.75} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`WhatsApp de ${codigo}`}
        title="WhatsApp"
        loading={ocupado === "whatsapp"}
        onClick={() => void compartir("whatsapp")}
      >
        <MessageCircle strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`PDF de ${codigo}`}
        title="PDF"
        loading={ocupado === "pdf"}
        onClick={() => void compartir("pdf")}
      >
        <FileText strokeWidth={1.75} />
      </Button>
      {convertible && puedeVender && (
        <Link
          href={ruta(`/cotizador/${id}?convertir=1`)}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={`Convertir ${codigo} en venta`}
          title="Convertir en venta"
        >
          <ShoppingCart strokeWidth={1.75} />
        </Link>
      )}
    </div>
  );
}
