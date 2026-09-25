"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { linkWhatsApp } from "@/lib/whatsapp";

import { compartirReporteAction } from "../actions";

/** Genera el PDF, lo publica con un link privado y abre WhatsApp con el link. */
export function CompartirReporte({ slug, query }: { slug: string; query: string }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  async function compartir() {
    setCargando(true);
    const r = await compartirReporteAction({ slug, query });
    setCargando(false);
    if (!r.ok) return toast.error("No se pudo generar el PDF", r.error.message);
    window.open(
      linkWhatsApp(null, `${r.data.texto}\n${location.origin}${r.data.url}`),
      "_blank",
      "noopener",
    );
  }
  return (
    <Button onClick={compartir} loading={cargando}>
      <MessageCircle /> Enviar por WhatsApp
    </Button>
  );
}
