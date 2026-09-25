"use client";

import { useEffect, useRef, useState } from "react";

import type { OpcionesDeteccion } from "./capturador";
import type { FuenteEscaneo, Sufijo } from "./config";
import { useContextoEscaner } from "./scanner-provider";

export interface UseBarcodeScannerOptions {
  onScan: (codigo: string, meta: { fuente: FuenteEscaneo }) => void;
  /** default true */
  enabled?: boolean;
  /** default: Configuración > Escáner (4) */
  minLength?: number;
  /** default: Configuración > Escáner (50 ms) */
  maxIntervalMs?: number;
  /** default: Configuración > Escáner (Enter y Tab) */
  sufijos?: Sufijo[];
  /** default: Configuración > Escáner ("") */
  prefijo?: string;
  /** default: nunca ignora (pero protege el input con foco de la ráfaga). */
  ignorarSiFocoEn?: (el: Element) => boolean;
}

/**
 * Escucha la pistola lectora (HID keyboard wedge) sin necesitar un input con
 * foco. No agrega listeners propios: se registra en el ScannerProvider (un
 * único listener global). Si hay varios montados, el último gana.
 *
 * Para cámara y carga manual, los componentes llaman al mismo onScan con
 * fuente "camara" / "manual".
 */
/** Contador de montajes: el render va de padre a hijo, así que el hijo recibe un número mayor. */
let contadorMontajes = 0;

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength,
  maxIntervalMs,
  sufijos,
  prefijo,
  ignorarSiFocoEn,
}: UseBarcodeScannerOptions): void {
  const { config, registrar } = useContextoEscaner();
  const [orden] = useState(() => ++contadorMontajes);

  // Refs: el consumidor registrado siempre llama a la versión más nueva de onScan/opciones
  // sin re-registrarse (re-registrar lo movería al tope de la pila).
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const opcionesRef = useRef<OpcionesDeteccion>({
    minLength: minLength ?? config.minLength,
    maxIntervalMs: maxIntervalMs ?? config.maxIntervalMs,
    sufijos: sufijos ?? config.sufijos,
    prefijo: prefijo ?? config.prefijo,
    ignorarSiFocoEn,
  });
  opcionesRef.current = {
    minLength: minLength ?? config.minLength,
    maxIntervalMs: maxIntervalMs ?? config.maxIntervalMs,
    sufijos: sufijos ?? config.sufijos,
    prefijo: prefijo ?? config.prefijo,
    ignorarSiFocoEn,
  };

  useEffect(() => {
    if (!enabled) return;
    const consumidor = {
      orden,
      onScan: (codigo: string) => onScanRef.current(codigo, { fuente: "pistola" as const }),
      get opciones() {
        return opcionesRef.current;
      },
    };
    return registrar(consumidor);
  }, [enabled, registrar, orden]);
}
