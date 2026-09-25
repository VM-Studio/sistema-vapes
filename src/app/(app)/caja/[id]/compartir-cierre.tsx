"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { linkWhatsApp } from "@/lib/whatsapp";

import { compartirCierreAction } from "../actions";

export function CompartirCierre({
  cajaId,
  deposito,
  diferencia,
}: {
  cajaId: string;
  deposito: string;
  diferencia: string | null;
}) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  async function compartir() {
    setCargando(true);
    const r = await compartirCierreAction({ cajaId });
    setCargando(false);
    if (!r.ok) return toast.error("No se pudo generar el PDF", r.error.message);
    const texto = [
      `Caja · ${deposito}`,
      diferencia !== null ? `Diferencia: ${formatearPesos(diferencia)}` : null,
      `${location.origin}${r.data.url}`,
    ]
      .filter(Boolean)
      .join("\n");
    window.open(linkWhatsApp(null, texto), "_blank", "noopener");
  }
  return (
    <Button onClick={compartir} loading={cargando}>
      <MessageCircle /> WhatsApp
    </Button>
  );
}
