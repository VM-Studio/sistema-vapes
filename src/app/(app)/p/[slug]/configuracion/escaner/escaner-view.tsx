"use client";

import { Modulo } from "@prisma/client";
import { CheckCircle2, ScanBarcode, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { EventoDiagnostico } from "@/features/scanner/capturador";
import {
  configEscanerSchema,
  SUFIJOS,
  type ConfigEscaner,
  type Sufijo,
} from "@/features/scanner/config";
import { useContextoEscaner } from "@/features/scanner/scanner-provider";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { cn } from "@/lib/utils";

import { guardarConfigEscanerAction } from "../actions";

interface Lectura {
  id: number;
  ok: boolean;
  texto: string;
  detalle: string;
}

let secuencia = 0;

export function EscanerView({ config }: { config: ConfigEscaner }) {
  const router = useRouter();
  const toast = useToast();
  const puedeEditar = usePuede(Modulo.CONFIGURACION, "editar");
  const [valores, setValores] = useState({
    ...config,
    maxIntervalMs: String(config.maxIntervalMs),
    minLength: String(config.minLength),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  const parseado = configEscanerSchema.safeParse(valores);
  const vigente: ConfigEscaner = parseado.success ? parseado.data : config;
  const cambiado = JSON.stringify(vigente) !== JSON.stringify(config);

  async function guardar() {
    setGuardando(true);
    const r = await guardarConfigEscanerAction(valores);
    setGuardando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudo guardar", r.error.message);
      return;
    }
    setErrores({});
    toast.success("Configuración del escáner guardada", "Se aplica en todas las pantallas.");
    router.refresh();
  }

  const alternarSufijo = (s: Sufijo, on: boolean) =>
    setValores((v) => ({
      ...v,
      sufijos: on ? [...new Set([...v.sufijos, s])] : v.sufijos.filter((x) => x !== s),
    }));

  return (
    <>
      <PageHeader
        title="Escáner"
        subtitle="Pistolas USB/Bluetooth en modo teclado: se detectan por la velocidad de tipeo, sin tocar ningún campo."
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SectionCard
          title="Parámetros"
          description="Cómo reconoce el sistema lo que escribe la pistola."
          contentClassName="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">
              Sufijo que manda la pistola al terminar
            </legend>
            {SUFIJOS.map((s) => (
              <Checkbox
                key={s}
                label={s}
                checked={valores.sufijos.includes(s)}
                onChange={(e) => alternarSufijo(s, e.target.checked)}
                disabled={!puedeEditar}
              />
            ))}
            {(errores.sufijos || (!parseado.success && valores.sufijos.length === 0)) && (
              <p className="text-danger text-sm">{errores.sufijos ?? "Elegí al menos un sufijo"}</p>
            )}
          </fieldset>
          <Input
            label="Prefijo (opcional)"
            hint="Si la pistola antepone algo al código (ej: ]C1), se quita."
            value={valores.prefijo}
            onChange={(e) => setValores((v) => ({ ...v, prefijo: e.target.value }))}
            error={errores.prefijo}
            disabled={!puedeEditar}
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Máx. entre teclas (ms)"
              hint="10 a 200. Una pistola tarda 5–30 ms."
              inputMode="numeric"
              value={valores.maxIntervalMs}
              onChange={(e) =>
                setValores((v) => ({ ...v, maxIntervalMs: e.target.value.replace(/\D/g, "") }))
              }
              error={errores.maxIntervalMs}
              disabled={!puedeEditar}
            />
            <Input
              label="Largo mínimo"
              hint="2 a 20 caracteres."
              inputMode="numeric"
              value={valores.minLength}
              onChange={(e) =>
                setValores((v) => ({ ...v, minLength: e.target.value.replace(/\D/g, "") }))
              }
              error={errores.minLength}
              disabled={!puedeEditar}
            />
          </div>
          <Switch
            label="Sonidos y vibración al escanear"
            checked={valores.sonidos}
            onCheckedChange={(s) => setValores((v) => ({ ...v, sonidos: s }))}
            disabled={!puedeEditar}
          />
          {puedeEditar && (
            <Button
              onClick={() => void guardar()}
              loading={guardando}
              disabled={!cambiado || !parseado.success}
              className="self-end"
            >
              Guardar
            </Button>
          )}
        </SectionCard>
        <ProbarPistola config={vigente} cambiado={cambiado} />
      </div>
    </>
  );
}

/** Diagnóstico en vivo con los parámetros del formulario (aunque no estén guardados). */
function ProbarPistola({ config, cambiado }: { config: ConfigEscaner; cambiado: boolean }) {
  const { suscribirDiagnostico } = useContextoEscaner();
  const feedback = useScanFeedback();
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [intervalos, setIntervalos] = useState<number[]>([]);
  const rafaga = useRef<number[]>([]);

  useBarcodeScanner({
    onScan: () => {},
    minLength: config.minLength,
    maxIntervalMs: config.maxIntervalMs,
    sufijos: config.sufijos,
    prefijo: config.prefijo,
  });

  useEffect(
    () =>
      suscribirDiagnostico((e: EventoDiagnostico) => {
        if (e.tipo === "tecla") {
          if (e.intervaloMs === null) rafaga.current = [];
          else rafaga.current.push(e.intervaloMs);
          return;
        }
        const tiempos = rafaga.current;
        rafaga.current = [];
        setIntervalos(tiempos);
        const promedio = tiempos.length
          ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)
          : null;
        const detalleTiempos =
          promedio === null
            ? ""
            : `promedio ${promedio} ms, máx. ${Math.max(...tiempos)} ms entre teclas`;
        const lectura: Lectura =
          e.tipo === "escaneo"
            ? {
                id: ++secuencia,
                ok: true,
                texto: e.codigo,
                detalle: [e.crudo !== e.codigo && `crudo «${e.crudo}»`, detalleTiempos]
                  .filter(Boolean)
                  .join(" · "),
              }
            : {
                id: ++secuencia,
                ok: false,
                texto: e.buffer,
                detalle: [`descartado: ${e.motivo}`, detalleTiempos].filter(Boolean).join(" · "),
              };
        if (lectura.ok) feedback.ok();
        setLecturas((l) => [lectura, ...l].slice(0, 12));
      }),
    [suscribirDiagnostico, feedback],
  );

  return (
    <SectionCard
      title="Probar pistola"
      description="Diagnóstico en vivo, con los valores del formulario."
      contentClassName="flex flex-col gap-4"
    >
      <p className="text-muted text-small">
        Escaneá cualquier código con la pistola. Probá también con el foco en el campo de abajo: el
        código <strong>no</strong> tiene que aparecer escrito ahí.
        {cambiado && " Se prueba con los valores del formulario, aunque todavía no los guardaste."}
      </p>
      <Input
        label="Campo de prueba"
        placeholder="Hacé foco acá y escaneá"
        autoComplete="off"
        onFocus={feedback.prepararAudio}
      />
      {intervalos.length > 0 && (
        <div
          aria-label="Tiempos entre teclas del último intento"
          className="border-border bg-surface rounded-control flex h-12 items-end gap-0.5 border p-1.5"
        >
          {intervalos.map((ms, i) => (
            <span
              key={i}
              title={`${ms} ms`}
              className={cn(
                "rounded-inner w-1.5",
                ms <= config.maxIntervalMs ? "bg-success" : "bg-danger",
              )}
              style={{
                height: `${Math.max(8, Math.min(100, (ms / Math.max(config.maxIntervalMs * 2, 1)) * 100))}%`,
              }}
            />
          ))}
        </div>
      )}
      {lecturas.length === 0 ? (
        <div className="border-border bg-surface text-muted text-small rounded-control flex flex-col items-center gap-2 border border-dashed p-8">
          <ScanBarcode className="text-subtle size-10" strokeWidth={1.25} aria-hidden />
          Esperando un escaneo…
        </div>
      ) : (
        <ul aria-label="Lecturas" aria-live="polite" className="flex flex-col gap-2">
          {lecturas.map((l) => (
            <li
              key={l.id}
              className={cn(
                "rounded-control flex items-start gap-2 px-3 py-2",
                l.ok ? "bg-success-soft" : "bg-danger-soft",
              )}
            >
              {l.ok ? (
                <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-label="Leído" />
              ) : (
                <XCircle className="text-danger mt-0.5 size-4 shrink-0" aria-label="Descartado" />
              )}
              <span className="min-w-0">
                <span className="block font-mono text-sm break-all">{l.texto}</span>
                {l.detalle && <span className="text-muted block text-xs">{l.detalle}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
