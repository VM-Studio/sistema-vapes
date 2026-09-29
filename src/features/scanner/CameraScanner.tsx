"use client";

import { Camera, CameraOff, Flashlight, FlashlightOff, Repeat, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { useDialogElement } from "@/components/ui/use-dialog-element";
import { normalizarCodigoBarras } from "@/lib/barcode";
import { cn } from "@/lib/utils";

/**
 * Escáner con la cámara del celular (o la webcam).
 * - Motor: BarcodeDetector nativo si el navegador lo trae (Chrome Android,
 *   Safari iOS 17+); si no, @zxing/browser. Se detecta en runtime.
 * - Cooldown de 1200 ms entre lecturas (no lee el mismo código 15 veces);
 *   modo ráfaga (contar unidades iguales): acepta repetidos cada 600 ms.
 * - La cámara se libera (track.stop) al cerrar, al ocultar la pestaña y al desmontar.
 */

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];
const COOLDOWN_MS = 1200;
const COOLDOWN_RAFAGA_MS = 600;

type Estado = "intro" | "iniciando" | "activo" | "denegado" | "sin-camara" | "error";
export type MotorCamara = "nativo" | "zxing";

export interface MensajeCamara {
  tipo: "ok" | "error";
  texto: string;
  detalle?: string;
  /** Cambia en cada lectura para reiniciar la animación aunque el texto se repita. */
  clave: number;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

async function crearDetectorNativo(): Promise<BarcodeDetectorLike | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!BD) return null;
  try {
    const soportados = await BD.getSupportedFormats();
    const formatos = FORMATOS.filter((f) => soportados.includes(f));
    return formatos.length ? new BD({ formats: formatos }) : null;
  } catch {
    return null;
  }
}

export function CameraScanner({
  open,
  onOpenChange,
  onDetect,
  mensaje,
  titulo = "Escanear con la cámara",
  permitirRafaga = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetect: (codigo: string, fuente: "camara" | "manual") => void;
  mensaje?: MensajeCamara | null;
  titulo?: string;
  permitirRafaga?: boolean;
}) {
  const { ref, onBackdropClick } = useDialogElement(open, onOpenChange);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detenerDeteccion = useRef<(() => void) | null>(null);
  const ultimo = useRef<{ codigo: string; t: number } | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const rafagaRef = useRef(false);
  /** Cambia en cada detener(): un getUserMedia que llega tarde (ya se cerró) se libera en el acto. */
  const sesion = useRef(0);

  const [estado, setEstado] = useState<Estado>("intro");
  const [motor, setMotor] = useState<MotorCamara | null>(null);
  const [torch, setTorch] = useState<{ disponible: boolean; encendida: boolean }>({
    disponible: false,
    encendida: false,
  });
  const [rafaga, setRafaga] = useState(false);
  const [manual, setManual] = useState("");
  rafagaRef.current = rafaga;

  const aceptar = useCallback((crudo: string) => {
    const codigo = normalizarCodigoBarras(crudo.trim());
    if (!codigo) return;
    const t = performance.now();
    const cooldown = rafagaRef.current ? COOLDOWN_RAFAGA_MS : COOLDOWN_MS;
    if (ultimo.current && t - ultimo.current.t < cooldown) return;
    ultimo.current = { codigo, t };
    onDetectRef.current(codigo, "camara");
  }, []);

  /** Libera todo: detección y tracks de la cámara (se apaga el indicador del navegador). */
  const detener = useCallback(() => {
    sesion.current++;
    detenerDeteccion.current?.();
    detenerDeteccion.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorch({ disponible: false, encendida: false });
  }, []);

  const iniciar = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado("sin-camara");
      return;
    }
    setEstado("iniciando");
    const mia = sesion.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (e) {
      const nombre = e instanceof DOMException ? e.name : "";
      setEstado(
        nombre === "NotAllowedError" || nombre === "SecurityError"
          ? "denegado"
          : nombre === "NotFoundError" || nombre === "OverconstrainedError"
            ? "sin-camara"
            : "error",
      );
      return;
    }
    if (mia !== sesion.current) {
      // Se cerró (o se ocultó la pestaña) mientras se pedía la cámara.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      detener();
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    if (mia !== sesion.current) return;
    const track = stream.getVideoTracks()[0];
    const capacidades = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
      torch?: boolean;
    };
    setTorch({ disponible: Boolean(capacidades.torch), encendida: false });
    setEstado("activo");

    const nativo = await crearDetectorNativo();
    if (mia !== sesion.current) return;
    if (nativo) {
      setMotor("nativo");
      let activo = true;
      const tick = async () => {
        if (!activo) return;
        if (video.readyState >= 2) {
          try {
            const r = await nativo.detect(video);
            if (r[0]?.rawValue) aceptar(r[0].rawValue);
          } catch {
            /* frame no disponible: seguir */
          }
        }
        if (activo) setTimeout(tick, 120);
      };
      void tick();
      detenerDeteccion.current = () => {
        activo = false;
      };
    } else {
      setMotor("zxing");
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      if (mia !== sesion.current) return; // se cerró mientras cargaba zxing
      const controles = await reader.decodeFromVideoElement(video, (resultado) => {
        if (resultado) aceptar(resultado.getText());
      });
      if (mia !== sesion.current) return controles.stop();
      detenerDeteccion.current = () => controles.stop();
    }
  }, [aceptar, detener]);

  // Abrir: si el permiso ya estaba dado, arranca directo; si no, pantalla previa explicando por qué.
  useEffect(() => {
    if (!open) {
      detener();
      return;
    }
    ultimo.current = null;
    let cancelado = false;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "camera" as PermissionName });
        if (!cancelado && p?.state === "granted") return void iniciar();
      } catch {
        /* Safari/Firefox: sin Permissions API para cámara */
      }
      if (!cancelado) setEstado("intro");
    })();
    return () => {
      cancelado = true;
    };
  }, [open, iniciar, detener]);

  // Pestaña oculta → se libera la cámara; al volver (si sigue abierto) se reanuda.
  useEffect(() => {
    if (!open) return;
    const alCambiar = () => {
      if (document.visibilityState === "hidden") {
        detener();
        setEstado("intro");
      } else if (!streamRef.current) {
        void iniciar();
      }
    };
    document.addEventListener("visibilitychange", alCambiar);
    return () => document.removeEventListener("visibilitychange", alCambiar);
  }, [open, iniciar, detener]);

  // Al desmontar: nada de cámaras colgadas.
  useEffect(() => detener, [detener]);

  async function alternarLinterna() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const encender = !torch.encendida;
    try {
      await track.applyConstraints({ advanced: [{ torch: encender } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, encendida: encender }));
    } catch {
      setTorch({ disponible: false, encendida: false });
    }
  }

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      aria-label={titulo}
      data-estado={estado}
      data-motor={motor ?? undefined}
      className="anim-dialog m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white md:m-auto md:h-[80dvh] md:w-[min(720px,92vw)] md:rounded-2xl"
    >
      {open && (
        <div className="relative flex h-full flex-col">
          <header className="pt-safe absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6">
            <p className="pt-3 pl-1 text-sm font-medium">{titulo}</p>
            <div className="flex gap-1 pt-2">
              {permitirRafaga && estado === "activo" && (
                <button
                  type="button"
                  onClick={() => setRafaga((r) => !r)}
                  aria-pressed={rafaga}
                  className={cn(
                    "flex h-11 items-center gap-1.5 rounded-full px-3 text-sm",
                    rafaga ? "bg-white text-black" : "bg-white/15",
                  )}
                  title="Modo ráfaga: acepta el mismo código repetido (para contar unidades iguales)"
                >
                  <Repeat className="size-4" /> Ráfaga
                </button>
              )}
              {torch.disponible && (
                <button
                  type="button"
                  onClick={alternarLinterna}
                  aria-pressed={torch.encendida}
                  aria-label={torch.encendida ? "Apagar linterna" : "Encender linterna"}
                  className="flex size-11 items-center justify-center rounded-full bg-white/15"
                >
                  {torch.encendida ? (
                    <FlashlightOff className="size-5" />
                  ) : (
                    <Flashlight className="size-5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Cerrar cámara"
                className="flex size-11 items-center justify-center rounded-full bg-white/15"
              >
                <X className="size-5" />
              </button>
            </div>
          </header>

          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={cn("size-full object-cover", estado !== "activo" && "hidden")}
            />

            {estado === "activo" && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                aria-hidden
              >
                <div className="relative h-40 w-[78%] max-w-md rounded-2xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]">
                  <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-red-500/80" />
                </div>
              </div>
            )}

            {mensaje && estado === "activo" && (
              <div
                key={mensaje.clave}
                role="status"
                className={cn(
                  "absolute inset-x-4 top-20 z-10 mx-auto max-w-md rounded-xl px-4 py-3 text-center shadow-lg",
                  mensaje.tipo === "ok" ? "bg-emerald-600" : "bg-red-600",
                )}
              >
                <p className="font-semibold">{mensaje.texto}</p>
                {mensaje.detalle && <p className="text-sm opacity-90">{mensaje.detalle}</p>}
              </div>
            )}

            {estado !== "activo" && (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                {estado === "intro" && (
                  <>
                    <Camera className="size-12 opacity-80" aria-hidden />
                    <div className="max-w-sm">
                      <p className="text-lg font-semibold">Usar la cámara para escanear</p>
                      <p className="mt-1 text-sm opacity-80">
                        Se usa solo mientras esta pantalla está abierta, para leer códigos de
                        barras. No se graba ni se envía ninguna imagen.
                      </p>
                    </div>
                    <Button size="lg" onClick={() => void iniciar()}>
                      <Camera /> Activar cámara
                    </Button>
                  </>
                )}
                {estado === "iniciando" && (
                  <p className="text-sm opacity-80">Activando la cámara…</p>
                )}
                {estado === "denegado" && (
                  <>
                    <CameraOff className="size-12 opacity-80" aria-hidden />
                    <div className="max-w-sm text-sm">
                      <p className="text-lg font-semibold">No hay permiso para usar la cámara</p>
                      <p className="mt-2 opacity-80">
                        <strong>Chrome / Android:</strong> tocá el candado junto a la dirección →
                        Permisos → Cámara → Permitir.
                      </p>
                      <p className="mt-1 opacity-80">
                        <strong>iPhone (Safari):</strong> Ajustes → Safari → Cámara → Permitir.
                      </p>
                      <p className="mt-2 opacity-80">
                        Mientras tanto podés escribir el código abajo.
                      </p>
                    </div>
                    <Button variant="secondary" onClick={() => void iniciar()}>
                      Reintentar
                    </Button>
                  </>
                )}
                {(estado === "sin-camara" || estado === "error") && (
                  <>
                    <CameraOff className="size-12 opacity-80" aria-hidden />
                    <p className="max-w-sm text-sm opacity-80">
                      {estado === "sin-camara"
                        ? "No se encontró una cámara en este dispositivo."
                        : "No se pudo iniciar la cámara."}{" "}
                      Podés escribir el código abajo.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <form
            className="pb-safe flex gap-2 bg-black/80 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const c = manual.trim();
              if (!c) return;
              onDetectRef.current(normalizarCodigoBarras(c), "manual");
              setManual("");
            }}
          >
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="¿Código dañado? Escribilo acá"
              aria-label="Escribir código manualmente"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                controlClass,
                "h-11 flex-1 border-white/20 bg-white/10 text-white placeholder:text-white/50",
              )}
            />
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </form>
        </div>
      )}
    </dialog>
  );
}
