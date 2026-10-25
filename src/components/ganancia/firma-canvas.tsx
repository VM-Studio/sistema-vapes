"use client";

import { Eraser } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Recuadro para firmar con el dedo, un lápiz o el mouse (Pointer Events).
 * El trazo sale del color de texto del sistema (--foreground) sobre fondo
 * transparente; `onChange` recibe el PNG ("data:image/png;base64,…") al
 * terminar cada trazo, o null si se borró. `touch-action: none` evita que el
 * dedo desplace la página mientras firma.
 */
export function FirmaCanvas({
  label,
  onChange,
  error,
  className,
}: {
  label: string;
  onChange: (png: string | null) => void;
  error?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const conTrazos = useRef(false);
  const [vacia, setVacia] = useState(true);
  const id = useId();

  // Tamaño real del canvas = tamaño en pantalla × devicePixelRatio (trazo nítido).
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ajustar = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const ancho = Math.round(r.width * dpr);
      const alto = Math.round(r.height * dpr);
      if (!ancho || !alto || (c.width === ancho && c.height === alto)) return;
      // Si ya había trazos (girar el celular, captura de pantalla), se conservan escalados.
      let previo: HTMLCanvasElement | null = null;
      if (conTrazos.current && c.width && c.height) {
        previo = document.createElement("canvas");
        previo.width = c.width;
        previo.height = c.height;
        previo.getContext("2d")?.drawImage(c, 0, 0);
      }
      c.width = ancho;
      c.height = alto;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      if (previo) ctx.drawImage(previo, 0, 0, ancho, alto);
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle =
        getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() ||
        "currentColor";
      if (previo) onChange(c.toDataURL("image/png"));
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(c);
    return () => ro.disconnect();
    // onChange cambia en cada render del padre: el ajuste solo depende del tamaño.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function empezar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const p = punto(e);
    ultimo.current = p;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || !ultimo.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = punto(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
  }

  function terminar(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    dibujando.current = false;
    ultimo.current = null;
    conTrazos.current = true;
    setVacia(false);
    onChange(e.currentTarget.toDataURL("image/png"));
  }

  function borrar() {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    conTrazos.current = false;
    setVacia(true);
    onChange(null);
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <Button variant="ghost" size="sm" onClick={borrar} disabled={vacia}>
          <Eraser strokeWidth={1.75} aria-hidden /> Borrar
        </Button>
      </div>
      <div
        className={cn(
          "border-input bg-surface rounded-control relative overflow-hidden border",
          error && "border-danger",
        )}
      >
        <canvas
          id={id}
          ref={ref}
          role="img"
          aria-label={vacia ? `${label}: vacío` : `${label}: firmado`}
          data-testid="firma-canvas"
          className="block h-44 w-full cursor-crosshair touch-none select-none md:h-48"
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
        />
        {vacia && (
          <span className="text-subtle pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm">
            Firmá acá con el dedo o el mouse
          </span>
        )}
        <span
          aria-hidden
          className="border-border pointer-events-none absolute inset-x-6 bottom-10 border-b border-dashed"
        />
      </div>
      {error && <p className="text-danger text-small">{error}</p>}
    </div>
  );
}
