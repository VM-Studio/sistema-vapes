"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LogoPanel } from "@/components/layout/logo-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import {
  MODULOS_DE_PANEL,
  normalizarPermiso,
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
}: {
  usuarioId: string;
  esOwner: boolean;
  paneles: PanelOpcion[];
  habilitadosIniciales: string[];
  permisosIniciales: PermisoModulo[];
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
  const [habilitados, setHabilitados] = useState(inicial.habilitados);
  const [grillas, setGrillas] = useState(inicial.grillas);
  const [guardando, setGuardando] = useState(false);

  const hayCambios =
    JSON.stringify({ h: [...habilitados].sort(), g: grillas }) !==
    JSON.stringify({ h: [...guardado.habilitados].sort(), g: guardado.grillas });

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
              <LogoPanel panel={panel} size={24} />
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
