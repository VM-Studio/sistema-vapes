"use client";

import { Switch } from "@/components/ui/switch";
import {
  ACCION_LABEL,
  ACCIONES,
  accionesDe,
  MODULO_AYUDA,
  MODULO_LABEL,
  type Accion,
  type PermisoModulo,
} from "@/lib/permisos";

export const CAMPO: Record<Accion, "puedeVer" | "puedeCrear" | "puedeEditar" | "puedeEliminar"> = {
  ver: "puedeVer",
  crear: "puedeCrear",
  editar: "puedeEditar",
  eliminar: "puedeEliminar",
};

/** Grilla módulo × acción de UN panel (tabla en desktop, cards en mobile). */
export function GrillaPermisos({
  titulo,
  permisos,
  onCambiar,
  deshabilitada = false,
}: {
  titulo: string;
  permisos: PermisoModulo[];
  onCambiar: (modulo: PermisoModulo["modulo"], accion: Accion, valor: boolean) => void;
  deshabilitada?: boolean;
}) {
  return (
    <>
      <div className="hidden md:block">
        <table className="text-small w-full">
          <caption className="sr-only">Permisos en {titulo}</caption>
          <thead className="border-border bg-card text-muted border-b">
            <tr>
              <th scope="col" className="h-10 px-5 text-left font-medium">
                Módulo
              </th>
              {ACCIONES.map((a) => (
                <th key={a} scope="col" className="h-10 w-24 px-3 text-center font-medium">
                  {ACCION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {permisos.map((p) => (
              <tr key={p.modulo}>
                <th scope="row" className="px-5 py-1.5 text-left font-medium">
                  {MODULO_LABEL[p.modulo]}
                  {MODULO_AYUDA[p.modulo] && (
                    <span className="text-muted block text-xs font-normal">
                      {MODULO_AYUDA[p.modulo]}
                    </span>
                  )}
                </th>
                {ACCIONES.map((a) => (
                  <td key={a} className="px-3 py-1">
                    <div className="flex justify-center">
                      {accionesDe(p.modulo).includes(a) ? (
                        <Switch
                          checked={p[CAMPO[a]]}
                          onCheckedChange={(v) => onCambiar(p.modulo, a, v)}
                          label={`${ACCION_LABEL[a]} ${MODULO_LABEL[p.modulo]} en ${titulo}`}
                          labelOculto
                          disabled={deshabilitada}
                        />
                      ) : (
                        <span className="text-subtle" aria-hidden>
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
      <ul className="divide-border divide-y md:hidden">
        {permisos.map((p) => (
          <li key={p.modulo} className="px-4 py-3">
            <p className="font-medium">{MODULO_LABEL[p.modulo]}</p>
            {MODULO_AYUDA[p.modulo] && (
              <p className="text-muted text-xs">{MODULO_AYUDA[p.modulo]}</p>
            )}
            <div className="mt-1 grid grid-cols-2 gap-x-6">
              {accionesDe(p.modulo).map((a) => (
                <Switch
                  key={a}
                  checked={p[CAMPO[a]]}
                  onCheckedChange={(v) => onCambiar(p.modulo, a, v)}
                  label={ACCION_LABEL[a]}
                  disabled={deshabilitada}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
