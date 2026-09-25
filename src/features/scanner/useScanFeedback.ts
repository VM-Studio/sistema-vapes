"use client";

import { useCallback, useMemo } from "react";

import { useToast } from "@/components/ui/toast";

import { useContextoEscaner } from "./scanner-provider";

let contexto: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  contexto ??= new Ctor();
  if (contexto.state === "suspended") void contexto.resume();
  return contexto;
}

/** Un tono con envolvente corta (sin "click"), generado con Web Audio: no hay archivos de audio. */
function tono(
  frecuencia: number,
  inicio: number,
  duracion: number,
  tipo: OscillatorType = "sine",
  volumen = 0.18,
) {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + inicio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volumen, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duracion + 0.02);
}

function vibrar(patron: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(patron);
}

/**
 * Feedback de escaneo: OK = dos tonos cortos ascendentes + vibración corta;
 * error = un tono grave largo + vibración larga. Respeta Configuración >
 * Escáner > Sonidos (la vibración y los toasts siempre).
 */
export function useScanFeedback() {
  const { config } = useContextoEscaner();
  const toast = useToast();
  const sonidos = config.sonidos;

  /** Llamar en un click/tap: los navegadores solo habilitan el audio tras un gesto del usuario. */
  const prepararAudio = useCallback(() => {
    if (sonidos) audio();
  }, [sonidos]);

  const ok = useCallback(
    (titulo?: string, descripcion?: string) => {
      if (sonidos) {
        tono(1046, 0, 0.07);
        tono(1568, 0.08, 0.09);
      }
      vibrar(80);
      if (titulo) toast.success(titulo, descripcion);
    },
    [sonidos, toast],
  );

  const error = useCallback(
    (titulo?: string, descripcion?: string) => {
      if (sonidos) tono(196, 0, 0.45, "square", 0.12);
      vibrar([200, 80, 200]);
      if (titulo) toast.error(titulo, descripcion);
    },
    [sonidos, toast],
  );

  return useMemo(() => ({ ok, error, prepararAudio }), [ok, error, prepararAudio]);
}
