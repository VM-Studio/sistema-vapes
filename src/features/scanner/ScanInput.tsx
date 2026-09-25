"use client";

import { Camera, ScanBarcode } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { normalizarCodigoBarras } from "@/lib/barcode";
import { cn } from "@/lib/utils";

import type { FuenteEscaneo } from "./config";

/**
 * Input de escaneo manual / fallback. La pistola funciona igual SIN foco acá
 * (la captura es global); este input sirve para tipear un código o para
 * pistolas que solo escriben donde hay foco.
 * `soloPistola`: inputMode="none" → en el celular no aparece el teclado en
 * pantalla (con una pistola Bluetooth emparejada).
 */
export function ScanInput({
  onScan,
  onAbrirCamara,
  placeholder = "Escaneá o escribí un código",
  soloPistola = false,
  autoFocus = true,
  className,
  inputRef,
}: {
  onScan: (codigo: string, meta: { fuente: FuenteEscaneo }) => void;
  onAbrirCamara?: () => void;
  placeholder?: string;
  soloPistola?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [valor, setValor] = useState("");
  const propio = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) propio.current?.focus();
  }, [autoFocus]);

  function asignar(el: HTMLInputElement | null) {
    propio.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as React.RefObject<HTMLInputElement | null>).current = el;
  }

  return (
    <form
      className={cn("flex gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const codigo = normalizarCodigoBarras(valor.trim());
        if (!codigo) return;
        onScan(codigo, { fuente: "manual" });
        setValor("");
        propio.current?.focus();
      }}
    >
      <div className="relative flex-1">
        <ScanBarcode
          className="text-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
          aria-hidden
        />
        <input
          ref={asignar}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode={soloPistola ? "none" : "text"}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={placeholder}
          aria-label="Código de barras"
          className={cn(controlClass, "h-12 pl-10 text-base")}
        />
      </div>
      {onAbrirCamara && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="size-12"
          onClick={onAbrirCamara}
          aria-label="Escanear con la cámara"
        >
          <Camera className="size-5" />
        </Button>
      )}
    </form>
  );
}
