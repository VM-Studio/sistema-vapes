import { MessageCircle } from "lucide-react";

import { mostrarTelefono, linkWhatsApp } from "@/lib/validations/cliente";
import { cn } from "@/lib/utils";

/** Teléfono del cliente + acceso directo a WhatsApp. */
export function TelefonoWhatsApp({
  telefono,
  className,
}: {
  telefono: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="tabular-nums">{mostrarTelefono(telefono)}</span>
      <a
        href={linkWhatsApp(telefono)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-success hover:bg-success-soft inline-flex size-9 items-center justify-center rounded-control"
        aria-label={`WhatsApp a ${mostrarTelefono(telefono)}`}
        title="Abrir WhatsApp"
      >
        <MessageCircle className="size-[1.125rem]" strokeWidth={1.75} aria-hidden />
      </a>
    </span>
  );
}
