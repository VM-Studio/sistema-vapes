"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { CapturadorEscaneos, type EventoDiagnostico, type OpcionesDeteccion } from "./capturador";
import { CONFIG_ESCANER_DEFAULT, type ConfigEscaner } from "./config";

export interface ConsumidorEscaner {
  onScan: (codigo: string) => void;
  opciones: OpcionesDeteccion;
  /** Orden de montaje (se toma en el render: un hijo siempre queda después que su padre). */
  orden: number;
}

interface ContextoEscaner {
  config: ConfigEscaner;
  /** Registra un consumidor; devuelve la función para desregistrarlo. El último registrado es el activo. */
  registrar: (c: ConsumidorEscaner) => () => void;
  /** Para /configuracion/escaner: cada tecla, intervalo y código detectado, en vivo. */
  suscribirDiagnostico: (cb: (e: EventoDiagnostico) => void) => () => void;
}

const Contexto = createContext<ContextoEscaner | null>(null);

/**
 * El ÚNICO listener global de teclado de la app. Las pantallas no escuchan
 * teclado por su cuenta: registran su onScan acá (useBarcodeScanner). Si hay
 * varias montadas, procesa el escaneo solo la última; al desmontarse, vuelve
 * a quedar activa la anterior. Así dos pantallas nunca procesan el mismo escaneo.
 */
export function ScannerProvider({
  children,
  config = CONFIG_ESCANER_DEFAULT,
  ahora,
}: {
  children: ReactNode;
  config?: ConfigEscaner;
  /** Reloj inyectable (tests). */
  /** Reloj de las teclas (tests). Por defecto: KeyboardEvent.timeStamp. */
  ahora?: (e: KeyboardEvent) => number;
}) {
  const pila = useRef<ConsumidorEscaner[]>([]);
  const diagnosticos = useRef(new Set<(e: EventoDiagnostico) => void>());

  // Activo = el de mayor orden de montaje (el último montado; entre padre e hijo, el hijo).
  const activo = useCallback(
    () =>
      pila.current.reduce<ConsumidorEscaner | null>(
        (a, c) => (!a || c.orden > a.orden ? c : a),
        null,
      ),
    [],
  );

  useEffect(() => {
    const capturador = new CapturadorEscaneos(
      () => activo()?.opciones ?? null,
      (codigo) => activo()?.onScan(codigo),
      ahora,
      (e) => diagnosticos.current.forEach((cb) => cb(e)),
    );
    window.addEventListener("keydown", capturador.onKeyDown, { capture: true });
    window.addEventListener("pointerdown", capturador.onInterrupcion, { capture: true });
    window.addEventListener("focusout", capturador.onInterrupcion, { capture: true });
    return () => {
      window.removeEventListener("keydown", capturador.onKeyDown, { capture: true });
      window.removeEventListener("pointerdown", capturador.onInterrupcion, { capture: true });
      window.removeEventListener("focusout", capturador.onInterrupcion, { capture: true });
      capturador.destruir();
    };
  }, [activo, ahora]);

  const registrar = useCallback((c: ConsumidorEscaner) => {
    pila.current = [...pila.current, c];
    return () => {
      pila.current = pila.current.filter((x) => x !== c);
    };
  }, []);

  const suscribirDiagnostico = useCallback((cb: (e: EventoDiagnostico) => void) => {
    diagnosticos.current.add(cb);
    return () => {
      diagnosticos.current.delete(cb);
    };
  }, []);

  const valor = useMemo(
    () => ({ config, registrar, suscribirDiagnostico }),
    [config, registrar, suscribirDiagnostico],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useContextoEscaner(): ContextoEscaner {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("Falta <ScannerProvider> (está en el layout de la app).");
  return ctx;
}
