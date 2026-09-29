import { MessageCircle } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { mostrarTelefono, linkWhatsApp } from "@/lib/validations/cliente";
import { cn } from "@/lib/utils";

/** Teléfono del cliente + acceso directo a WhatsApp (botón secundario chico). */
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
        className={cn(
          buttonVariants({ variant: "secondary", size: "icon" }),
          "text-foreground md:size-8 [&_svg]:size-4",
        )}
        aria-label={`WhatsApp a ${mostrarTelefono(telefono)}`}
        title="Abrir WhatsApp"
      >
        <MessageCircle strokeWidth={1.75} aria-hidden />
      </a>
    </span>
  );
}
