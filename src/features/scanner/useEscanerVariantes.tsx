"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { AltaRapidaSheet } from "@/components/catalogo/alta-rapida-sheet";
import { usePanel } from "@/components/layout/panel-context";

import { CameraScanner, type MensajeCamara } from "./CameraScanner";
import { CodigoDesconocidoSheet } from "./CodigoDesconocidoSheet";
import type { FuenteEscaneo } from "./config";
import { invalidarResoluciones, resolverCodigo } from "./resolver-codigo";
import type { VarianteEscaneada } from "./tipos";
import { useBarcodeScanner } from "./useBarcodeScanner";
import { useScanFeedback } from "./useScanFeedback";

interface Opciones {
  /** Qué hacer con un sabor reconocido (agregar a la lista, abrir la ficha…). */
  onVariante: (v: VarianteEscaneada, fuente: FuenteEscaneo) => void;
  habilitado?: boolean;
  /** Si el sabor no sirve en este contexto (ej: sin stock en origen), devolver un mensaje de error. */
  validar?: (v: VarianteEscaneada) => string | null;
  permitirRafaga?: boolean;
  tituloCamara?: string;
  /**
   * Código desconocido: "opciones" (default) pregunta si asociarlo a un sabor
   * existente o darlo de alta; "directa" abre el alta rápida de una.
   */
  altaRapida?: "opciones" | "directa";
}

/**
 * Todo el escaneo de una pantalla en un hook: pistola (listener global vía
 * ScannerProvider), cámara, carga manual, resolución del código con caché,
 * feedback (beep/vibración) y los Sheets de código desconocido / alta rápida.
 * Devuelve `ui` (cámara + sheets) para renderizar una vez en la pantalla.
 */
export function useEscanerVariantes({
  onVariante,
  habilitado = true,
  validar,
  permitirRafaga,
  tituloCamara,
  altaRapida = "opciones",
}: Opciones) {
  const feedback = useScanFeedback();
  const panel = usePanel();
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const [alta, setAlta] = useState<string | null>(null);
  const [ultima, setUltima] = useState<VarianteEscaneada | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onVarianteRef = useRef(onVariante);
  onVarianteRef.current = onVariante;
  const validarRef = useRef(validar);
  validarRef.current = validar;
  const clave = useRef(0);

  const aceptarVariante = useCallback(
    (v: VarianteEscaneada, fuente: FuenteEscaneo) => {
      const problema = validarRef.current?.(v);
      if (problema) {
        feedback.error(problema, v.titulo);
        setMensaje({ tipo: "error", texto: problema, detalle: v.titulo, clave: ++clave.current });
        return;
      }
      feedback.ok();
      setUltima(v);
      setMensaje({
        tipo: "ok",
        texto: v.titulo,
        detalle: `Stock total: ${v.stockTotal}`,
        clave: ++clave.current,
      });
      onVarianteRef.current(v, fuente);
    },
    [feedback],
  );

  const procesar = useCallback(
    async (codigo: string, fuente: FuenteEscaneo) => {
      const r = await resolverCodigo(panel.id, codigo);
      if (!r.ok) {
        feedback.error("No se pudo buscar el código", r.error.message);
        return;
      }
      if (r.data.encontrado) {
        aceptarVariante(r.data.variante, fuente);
      } else {
        feedback.error();
        setMensaje({
          tipo: "error",
          texto: "Código desconocido",
          detalle: codigo,
          clave: ++clave.current,
        });
        setCamara(false);
        if (altaRapida === "directa") setAlta(r.data.codigo);
        else setDesconocido(r.data.codigo);
      }
      // Solo si se estaba tipeando a mano: con la pistola, enfocar un input abriría el teclado del celular.
      if (fuente === "manual") inputRef.current?.focus();
    },
    [aceptarVariante, feedback, panel.id, altaRapida],
  );

  // Pistola: pausada mientras hay un Sheet abierto (ahí se tipea).
  useBarcodeScanner({
    onScan: (c, m) => void procesar(c, m.fuente),
    enabled: habilitado && desconocido === null && alta === null,
  });

  const ui: ReactNode = (
    <>
      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c, f) => void procesar(c, f)}
        mensaje={mensaje}
        permitirRafaga={permitirRafaga}
        titulo={tituloCamara}
      />
      <CodigoDesconocidoSheet
        codigo={desconocido}
        onClose={() => setDesconocido(null)}
        onAsociado={(v) => aceptarVariante(v, "manual")}
        onCrear={(c) => {
          setDesconocido(null);
          setAlta(c);
        }}
      />
      <AltaRapidaSheet
        codigo={alta}
        abierto={alta !== null}
        onCerrar={() => setAlta(null)}
        onCreada={(v) => {
          if (alta) invalidarResoluciones(alta);
          setAlta(null);
          aceptarVariante(v, "manual");
        }}
      />
    </>
  );

  return {
    /** Para ScanInput / carga manual. */
    procesar,
    /** Para el buscador manual: agrega un sabor elegido de la lista (mismo feedback que un escaneo). */
    agregar: (v: VarianteEscaneada) => aceptarVariante(v, "manual"),
    abrirCamara: () => {
      feedback.prepararAudio();
      setCamara(true);
    },
    camaraAbierta: camara,
    /** true mientras hay un Sheet (código desconocido / alta rápida) abierto. */
    sheetAbierto: desconocido !== null || alta !== null,
    ultima,
    inputRef,
    ui,
  };
}
