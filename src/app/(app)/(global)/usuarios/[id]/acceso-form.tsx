"use client";

import { ScanBarcode, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LogoPanel } from "@/components/layout/logo-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import {
  MODULOS_DE_PANEL,
  normalizarPermiso,
  permisosPerfilEscaneo,
  type Accion,
  type PermisoModulo,
} from "@/lib/permisos";

import { actualizarAccesoAction } from "../actions";
import { CAMPO, GrillaPermisos } from "./grilla-permisos";

interface PanelOpcion {
  id: string;
  nombre: string;
  logoUrl: string | null;
  colorAcento: string | null;
  activo: boolean;
}

const grillaVacia = (panelId: string, todo = false): PermisoModulo[] =>
  MODULOS_DE_PANEL.map((modulo) => ({
    panelId,
    modulo,
    puedeVer: todo,
    puedeCrear: todo,
    puedeEditar: todo,
    puedeEliminar: todo,
  }));

/**
 * Acceso por panel: un checkbox por sistema; al marcarlo aparece su grilla
 * módulo × acción. Un dueño tiene todo: la grilla se muestra deshabilitada.
 */
export function AccesoForm({
  usuarioId,
  esOwner,
  paneles,
  habilitadosIniciales,
  permisosIniciales,
  panelesEscaneo = [],
  perfilInicial,
}: {
  usuarioId: string;
  esOwner: boolean;
  paneles: PanelOpcion[];
  habilitadosIniciales: string[];
  permisosIniciales: PermisoModulo[];
  /** Paneles con galpones de escaneo remoto: ofrecen el preset «Escaneo (Charly)». */
  panelesEscaneo?: string[];
  /** Recién creado con el perfil «Escaneo (Charly)»: se precarga el preset (falta guardar). */
  perfilInicial?: "escaneo";
}) {
  const router = useRouter();
  const toast = useToast();
  const inicial = useMemo(
    () => ({
      habilitados: habilitadosIniciales,
      grillas: Object.fromEntries(
        paneles.map((p) => {
          const guardada = permisosIniciales.filter((x) => x.panelId === p.id);
          return [p.id, guardada.length > 0 ? guardada : grillaVacia(p.id)];
        }),
      ) as Record<string, PermisoModulo[]>,
    }),
    [habilitadosIniciales, paneles, permisosIniciales],
  );
  const [guardado, setGuardado] = useState(inicial);
  const conPreset = perfilInicial === "escaneo" && !esOwner && panelesEscaneo.length > 0;
  const [habilitados, setHabilitados] = useState(() =>
    conPreset ? [...new Set([...inicial.habilitados, ...panelesEscaneo])] : inicial.habilitados,
  );
  const [grillas, setGrillas] = useState(() =>
    conPreset
      ? {
          ...inicial.grillas,
          ...Object.fromEntries(panelesEscaneo.map((id) => [id, permisosPerfilEscaneo(id)])),
        }
      : inicial.grillas,
  );
  const [guardando, setGuardando] = useState(false);

  const hayCambios =
    JSON.stringify({ h: [...habilitados].sort(), g: grillas }) !==
    JSON.stringify({ h: [...guardado.habilitados].sort(), g: guardado.grillas });

  /** Preset «Escaneo (Charly)»: en este panel solo «Escaneo remoto», nada más. */
  function aplicarPerfilEscaneo(panelId: string) {
    setHabilitados((hs) => (hs.includes(panelId) ? hs : [...hs, panelId]));
    setGrillas((gs) => ({ ...gs, [panelId]: permisosPerfilEscaneo(panelId) }));
  }

  function alternarPanel(panelId: string, activo: boolean) {
    setHabilitados((hs) => (activo ? [...hs, panelId] : hs.filter((h) => h !== panelId)));
  }

  function cambiar(
    panelId: string,
    modulo: PermisoModulo["modulo"],
    accion: Accion,
    valor: boolean,
  ) {
    setGrillas((gs) => ({
      ...gs,
      [panelId]: gs[panelId]!.map((p) =>
        p.modulo === modulo ? normalizarPermiso({ ...p, [CAMPO[accion]]: valor }, accion) : p,
      ),
    }));
  }

  async function guardar() {
    setGuardando(true);
    const r = await actualizarAccesoAction({
      usuarioId,
      paneles: habilitados.map((panelId) => ({
        panelId,
        permisos: grillas[panelId]!.map((p) => ({
          modulo: p.modulo,
          puedeVer: p.puedeVer,
          puedeCrear: p.puedeCrear,
          puedeEditar: p.puedeEditar,
          puedeEliminar: p.puedeEliminar,
        })),
      })),
    });
    setGuardando(false);
    if (!r.ok) return toast.error("No se pudo guardar el acceso", r.error.message);
    setGuardado({ habilitados, grillas });
    toast.success("Acceso guardado", "Se aplica en su próximo clic.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {esOwner && (
        <p className="border-border bg-surface text-small rounded-control flex items-start gap-2.5 border p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          Es dueño: accede a todos los sistemas y a todos sus módulos. Los permisos no se pueden
          restringir.
        </p>
      )}
      {conPreset && hayCambios && (
        <p
          className="bg-warning-soft text-warning-soft-foreground text-small rounded-control flex items-start gap-2.5 p-4"
          data-testid="aviso-perfil-escaneo"
        >
          <ScanBarcode className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          Perfil «Escaneo ({NOMBRE_ESCANEO})» cargado: solo va a ver las ventas que le pidan
          escanear. Revisá y tocá «Guardar acceso».
        </p>
      )}
      {paneles.map((panel) => {
        const activo = esOwner || habilitados.includes(panel.id);
        return (
          <section
            key={panel.id}
            aria-label={panel.nombre}
            className="border-border bg-surface rounded-card overflow-hidden border"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 md:px-5">
              <Checkbox
                id={`panel-${panel.id}`}
                checked={activo}
                disabled={esOwner}
                onChange={(e) => alternarPanel(panel.id, e.target.checked)}
                label={
                  <span className="font-semibold">
                    Accede a {panel.nombre}
                    {!panel.activo && (
                      <span className="text-muted text-small ml-2 font-normal">(desactivado)</span>
                    )}
                  </span>
                }
              />
              <span className="flex items-center gap-2">
                {!esOwner && panelesEscaneo.includes(panel.id) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => aplicarPerfilEscaneo(panel.id)}
                    title={`Solo «Escaneo remoto»: ve y escanea las ventas que le pidan en ${panel.nombre}`}
                  >
                    <ScanBarcode strokeWidth={1.75} /> Perfil Escaneo ({NOMBRE_ESCANEO})
                  </Button>
                )}
                <LogoPanel panel={panel} size={24} />
              </span>
            </div>
            {activo && (
              <div className="border-border border-t">
                <GrillaPermisos
                  titulo={panel.nombre}
                  permisos={esOwner ? grillaVacia(panel.id, true) : grillas[panel.id]!}
                  onCambiar={(m, a, v) => cambiar(panel.id, m, a, v)}
                  deshabilitada={esOwner}
                />
              </div>
            )}
          </section>
        );
      })}
      {!esOwner && (
        <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setHabilitados(guardado.habilitados);
              setGrillas(guardado.grillas);
            }}
            disabled={!hayCambios || guardando}
          >
            Descartar
          </Button>
          <Button onClick={guardar} loading={guardando} disabled={!hayCambios}>
            Guardar acceso
          </Button>
        </div>
      )}
    </div>
  );
}
