"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  ACCION_LABEL,
  ACCIONES,
  accionesDe,
  MODULO_AYUDA,
  MODULO_LABEL,
  normalizarPermiso,
  type Accion,
  type PermisoModulo,
} from "@/lib/permisos";

import { actualizarPermisosAction } from "../../actions";

const CAMPO: Record<Accion, "puedeVer" | "puedeCrear" | "puedeEditar" | "puedeEliminar"> = {
  ver: "puedeVer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

/**
 * Grilla módulo × acción. Reglas (mismas que Zod y el CHECK de la DB):
 * apagar "Ver" apaga todo; encender cualquier acción enciende "Ver".
 */
export function PermisosForm({
  usuarioId,
  permisosIniciales,
}: {
  usuarioId: string;
  permisosIniciales: PermisoModulo[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [guardados, setGuardados] = useState(permisosIniciales);
  const [permisos, setPermisos] = useState(permisosIniciales);
  const [guardando, setGuardando] = useState(false);

  const hayCambios = useMemo(
    () => JSON.stringify(permisos) !== JSON.stringify(guardados),
    [permisos, guardados],
  );

  function cambiar(modulo: PermisoModulo["modulo"], accion: Accion, valor: boolean) {
    setPermisos((ps) =>
      ps.map((p) =>
        p.modulo === modulo ? normalizarPermiso({ ...p, [CAMPO[accion]]: valor }, accion) : p,
      ),
    );
  }

  async function guardar() {
    setGuardando(true);
    const r = await actualizarPermisosAction({ usuarioId, permisos });
    setGuardando(false);
    if (!r.ok) return toast.error("No se pudieron guardar los permisos", r.error.message);
    setGuardados(r.data);
    setPermisos(r.data);
    toast.success("Permisos guardados");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Desktop: tabla */}
      <div className="border-border bg-surface hidden overflow-hidden rounded-xl border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Permisos por módulo</caption>
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Módulo
              </th>
              {ACCIONES.map((a) => (
                <th key={a} scope="col" className="w-28 px-4 py-3 text-center font-medium">
                  {ACCION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {permisos.map((p) => (
              <tr key={p.modulo}>
                <th scope="row" className="px-4 py-1 text-left font-medium">
                  {MODULO_LABEL[p.modulo]}
                  {MODULO_AYUDA[p.modulo] && (
                    <span className="text-muted block text-xs font-normal">
                      {MODULO_AYUDA[p.modulo]}
                    </span>
                  )}
                </th>
                {ACCIONES.map((a) => (
                  <td key={a} className="px-4 py-1">
                    <div className="flex justify-center">
                      {accionesDe(p.modulo).includes(a) ? (
                        <Switch
                          checked={p[CAMPO[a]]}
                          onCheckedChange={(v) => cambiar(p.modulo, a, v)}
                          label={`${ACCION_LABEL[a]} ${MODULO_LABEL[p.modulo]}`}
                          labelOculto
                        />
                      ) : (
                        <span className="text-muted" aria-hidden>
                          —
                        </span>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: una card por módulo */}
      <ul className="flex flex-col gap-2 md:hidden">
        {permisos.map((p) => (
          <li key={p.modulo} className="border-border bg-surface rounded-xl border px-4 py-3">
            <p className="font-medium">{MODULO_LABEL[p.modulo]}</p>
            {MODULO_AYUDA[p.modulo] && (
              <p className="text-muted text-xs">{MODULO_AYUDA[p.modulo]}</p>
            )}
            <div className="mt-1 grid grid-cols-2 gap-x-6">
              {accionesDe(p.modulo).map((a) => (
                <Switch
                  key={a}
                  checked={p[CAMPO[a]]}
                  onCheckedChange={(v) => cambiar(p.modulo, a, v)}
                  label={ACCION_LABEL[a]}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Acciones: fijas sobre la bottom bar en mobile */}
      <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t px-4 py-3 backdrop-blur md:static md:justify-end md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none [&>*]:flex-1 md:[&>*]:flex-none">
        <Button
          variant="secondary"
          onClick={() => setPermisos(guardados)}
          disabled={!hayCambios || guardando}
        >
          Descartar
        </Button>
        <Button onClick={guardar} loading={guardando} disabled={!hayCambios}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
