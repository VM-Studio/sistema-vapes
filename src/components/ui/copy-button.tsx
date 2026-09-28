"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function CopyButton({
  valor,
  etiqueta = "Copiar",
  className,
}: {
  valor: string;
  etiqueta?: string;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(valor);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className={cn(
        "text-muted hover:bg-surface-2 hover:text-foreground inline-flex size-9 items-center justify-center rounded-lg transition-colors",
        className,
      )}
      aria-label={copiado ? "Copiado" : `${etiqueta} ${valor}`}
      title={copiado ? "Copiado" : etiqueta}
    >
      {copiado ? (
        <Check className="text-success size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Copy className="size-4" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}
