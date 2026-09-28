"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { rutaPanel, type PanelBasico } from "@/lib/paneles";

/**
 * Panel actual (lo resuelve el layout de /p/[slug] en el servidor). Fuera de
 * un panel (/usuarios, /cuenta...) no hay provider: usePanelOpcional() → null.
 */
const PanelContext = createContext<PanelBasico | null>(null);

export function PanelProvider({ panel, children }: { panel: PanelBasico; children: ReactNode }) {
  return <PanelContext.Provider value={panel}>{children}</PanelContext.Provider>;
}

export function usePanelOpcional(): PanelBasico | null {
  return useContext(PanelContext);
}

export function usePanel(): PanelBasico {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error("usePanel() requiere estar dentro de /p/[slug] (<PanelProvider>)");
  return panel;
}

/** ruta("/productos") → "/p/{slug}/productos" del panel actual. */
export function useRutaPanel(): (ruta?: string) => string {
  const panel = usePanel();
  return useMemo(
    () =>
      (ruta = "") =>
        rutaPanel(panel.slug, ruta),
    [panel.slug],
  );
}
