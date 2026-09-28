import type { CSSProperties } from "react";
import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { PanelProvider } from "@/components/layout/panel-context";
import { RecordarPanel } from "@/components/layout/recordar-panel";
import { SincronizacionOffline } from "@/components/pwa/sincronizacion-offline";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { ScannerProvider } from "@/features/scanner/scanner-provider";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { obtenerConfigEscaner } from "@/server/services/configuracion.service";

/** Texto legible sobre el color de acento (blanco o casi negro según luminancia). */
function textoSobre(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return l > 0.4 ? "#111113" : "#ffffff";
}

/**
 * Layout de un panel (/p/[slug]): el middleware ya verificó que existe, está
 * activo y que el usuario accede; getPanelActual() lo vuelve a verificar.
 * El color de acento del panel tiñe botón primario e ítems activos
 * (--panel-accent), para que siempre se note en qué sistema estás.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePaginaPanelUsuario();
  const [jar, configEscaner] = await Promise.all([cookies(), obtenerConfigEscaner(ctx)]);
  const colapsado = jar.get(COOKIE_SIDEBAR)?.value === "colapsado";
  const acento = ctx.panel.colorAcento;
  const textoAcento = acento ? textoSobre(acento) : null;
  const estilo = acento
    ? ({ "--panel-accent": acento, "--panel-accent-foreground": textoAcento } as CSSProperties)
    : undefined;

  return (
    <PanelProvider panel={ctx.panel}>
      <RecordarPanel slug={ctx.panel.slug} acento={acento} textoAcento={textoAcento} />
      <div style={estilo} className="contents">
        {/* Un único listener global de teclado para la pistola lectora, para todo el panel. */}
        <ScannerProvider config={configEscaner}>
          <SincronizacionOffline>
            <AppShell
              sidebarColapsadoInicial={colapsado}
              restringido={ctx.usuario.debeCambiarPassword}
            >
              {children}
            </AppShell>
          </SincronizacionOffline>
        </ScannerProvider>
      </div>
    </PanelProvider>
  );
}
