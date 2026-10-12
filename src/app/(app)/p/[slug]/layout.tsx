import { Modulo } from "@prisma/client";
import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { PanelProvider } from "@/components/layout/panel-context";
import { RecordarPanel } from "@/components/layout/recordar-panel";
import { SincronizacionOffline } from "@/components/pwa/sincronizacion-offline";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { ScannerProvider } from "@/features/scanner/scanner-provider";
import { esOwner, puede } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { obtenerCotizacionesSeguro } from "@/server/services/cambio.service";
import { obtenerConfigEscaner } from "@/server/services/configuracion.service";

/**
 * Layout de un panel (/p/[slug]): el middleware ya verificó que existe, está
 * activo y que el usuario accede; getPanelActual() lo vuelve a verificar.
 * Todos los paneles comparten el mismo diseño (blanco y negro): lo que
 * distingue el sistema es su logo en la barra superior.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePaginaPanelUsuario();
  // Widget de cotizaciones: dueños y quien ve el Cotizador (lectura local; nunca espera a las APIs).
  const veCambio = puede(ctx.usuario, ctx.panelId, Modulo.COTIZADOR, "ver");
  const [jar, configEscaner, cotizaciones] = await Promise.all([
    cookies(),
    obtenerConfigEscaner(ctx),
    veCambio ? obtenerCotizacionesSeguro() : Promise.resolve(null),
  ]);
  const colapsado = jar.get(COOKIE_SIDEBAR)?.value === "colapsado";

  return (
    <PanelProvider panel={ctx.panel}>
      <RecordarPanel slug={ctx.panel.slug} />
      {/* Un único listener global de teclado para la pistola lectora, para todo el panel. */}
      <ScannerProvider config={configEscaner}>
        <SincronizacionOffline>
          <AppShell
            sidebarColapsadoInicial={colapsado}
            restringido={ctx.usuario.debeCambiarPassword}
            cambio={cotizaciones ? { cotizaciones, enlace: esOwner(ctx.usuario) } : null}
          >
            {children}
          </AppShell>
        </SincronizacionOffline>
      </ScannerProvider>
    </PanelProvider>
  );
}
