"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { resolverVarianteAction } from "./actions";
import { CameraScanner, type MensajeCamara } from "./CameraScanner";
import { CodigoDesconocidoSheet } from "./CodigoDesconocidoSheet";
import type { FuenteEscaneo } from "./config";
import { resolverCodigo } from "./resolver-codigo";
import type { VarianteEscaneada } from "./tipos";
import { useBarcodeScanner } from "./useBarcodeScanner";
import { useScanFeedback } from "./useScanFeedback";

interface Opciones {
  /** Qué hacer con una variante reconocida (agregar al carrito, abrir la ficha…). */
  onVariante: (v: VarianteEscaneada, fuente: FuenteEscaneo) => void;
  habilitado?: boolean;
  /** Si la variante no sirve en este contexto (ej: sin stock en origen), devolver un mensaje de error. */
  validar?: (v: VarianteEscaneada) => string | null;
  permitirRafaga?: boolean;
  tituloCamara?: string;
}

/**
 * Todo el escaneo de una pantalla en un hook: pistola (listener global vía
 * ScannerProvider), cámara, carga manual, resolución del código con caché,
 * feedback (beep/vibración) y el Sheet de "código desconocido".
 * Devuelve `ui` (cámara + sheet) para renderizar una vez en la pantalla.
 * Además, si la URL trae ?agregar=<varianteId> (volviendo de "crear producto"),
 * la agrega sola.
 */
export function useEscanerVariantes({
  onVariante,
  habilitado = true,
  validar,
  permitirRafaga,
  tituloCamara,
}: Opciones) {
  const feedback = useScanFeedback();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const [desconocido, setDesconocido] = useState<string | null>(null);
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
        feedback.error(problema, v.nombreCompleto);
        setMensaje({
          tipo: "error",
          texto: problema,
          detalle: v.nombreCompleto,
          clave: ++clave.current,
        });
        return;
      }
      feedback.ok();
      setUltima(v);
      setMensaje({
        tipo: "ok",
        texto: v.nombreCompleto,
        detalle: `Stock total: ${v.stockTotal}`,
        clave: ++clave.current,
      });
      onVarianteRef.current(v, fuente);
    },
    [feedback],
  );

  const procesar = useCallback(
    async (codigo: string, fuente: FuenteEscaneo) => {
      const r = await resolverCodigo(codigo);
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
        setDesconocido(r.data.codigo);
      }
      // Solo si se estaba tipeando a mano: con la pistola, enfocar un input abriría el teclado del celular.
      if (fuente === "manual") inputRef.current?.focus();
    },
    [aceptarVariante, feedback],
  );

  // Pistola: pausada mientras el Sheet de código desconocido está abierto (ahí se tipea).
  useBarcodeScanner({
    onScan: (c, m) => void procesar(c, m.fuente),
    enabled: habilitado && desconocido === null,
  });

  // Volviendo de "crear producto" con el código escaneado: ?agregar=<varianteId>.
  const agregar = searchParams.get("agregar");
  useEffect(() => {
    if (!agregar) return;
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("agregar");
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
    void resolverVarianteAction({ varianteId: agregar }).then((r) => {
      if (r.ok && r.data) aceptarVariante(r.data, "manual");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando aparece el parámetro
  }, [agregar]);

  const volverA = (() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("agregar");
    return sp.size ? `${pathname}?${sp}` : pathname;
  })();

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
        volverA={volverA}
      />
    </>
  );

  return {
    /** Para ScanInput / carga manual. */
    procesar,
    abrirCamara: () => {
      feedback.prepararAudio();
      setCamara(true);
    },
    camaraAbierta: camara,
    ultima,
    inputRef,
    ui,
  };
}
