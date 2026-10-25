import { Modulo } from "@prisma/client";
import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { PanelProvider } from "@/components/layout/panel-context";
import { RecordarPanel } from "@/components/layout/recordar-panel";
import { SincronizacionOffline } from "@/components/pwa/sincronizacion-offline";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { ScannerProvider } from "@/features/scanner/scanner-provider";
import { tieneMercadoLibre } from "@/lib/medios-pago";
import { esOwner, esPerfilEscaneo, puede } from "@/lib/permisos";
import { requirePaginaPanelUsuario } from "@/server/auth/permissions";
import { obtenerCotizacionesSeguro } from "@/server/services/cambio.service";
import {
  obtenerConfigEscaner,
  obtenerConfigFacturacion,
  obtenerConfigVentas,
} from "@/server/services/configuracion.service";

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
  const [jar, configEscaner, cotizaciones, facturacion, configVentas] = await Promise.all([
    cookies(),
    obtenerConfigEscaner(ctx),
    veCambio ? obtenerCotizacionesSeguro() : Promise.resolve(null),
    obtenerConfigFacturacion(ctx),
    obtenerConfigVentas(ctx),
  ]);
  const colapsado = jar.get(COOKIE_SIDEBAR)?.value === "colapsado";
  // «Escaneo (Charly)»: sin navegación ni catálogo offline, solo su pantalla y salir.
  const soloEscaneo = esPerfilEscaneo(ctx.usuario);

  if (soloEscaneo) {
    return (
      <PanelProvider panel={ctx.panel}>
        <ScannerProvider config={configEscaner}>
          <AppShell sidebarColapsadoInicial={colapsado} restringido>
            {children}
          </AppShell>
        </ScannerProvider>
      </PanelProvider>
    );
  }

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
            // Facturas: con la facturación habilitada o si cobra por Mercado Libre
            // (la carga de las facturas de esas ventas vive ahí).
            funciones={{
              facturacion: facturacion.habilitada || tieneMercadoLibre(configVentas),
            }}
          >
            {children}
          </AppShell>
        </SincronizacionOffline>
      </ScannerProvider>
    </PanelProvider>
  );
}
