import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { GlobalShell } from "@/components/layout/global-shell";
import { PanelProvider } from "@/components/layout/panel-context";
import { COOKIE_SIDEBAR, COOKIE_ULTIMO_PANEL } from "@/config/ui";
import { tieneMercadoLibre } from "@/lib/medios-pago";
import { accedeAPanel, esPerfilEscaneo } from "@/lib/permisos";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { panelesActivos } from "@/server/auth/paneles-acceso";
import {
  obtenerConfigFacturacion,
  obtenerConfigVentas,
} from "@/server/services/configuracion.service";

/**
 * Pantallas fuera de los paneles: usuarios, configuración, cuenta, ayuda.
 * Se muestran DENTRO de la barra y el menú lateral del último panel abierto
 * (cookie; si no hay, el primero al que accede): la navegación no desaparece
 * al entrar a Usuarios o Configuración. Solo si el usuario no accede a ningún
 * panel, o tiene que cambiar la contraseña, van con la barra global.
 * El selector de sistemas (/paneles) tiene su propio layout en (selector).
 */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  if (usuario.debeCambiarPassword || esPerfilEscaneo(usuario)) {
    return <GlobalShell restringido>{children}</GlobalShell>;
  }

  const jar = await cookies();
  const accesibles = (await panelesActivos()).filter((p) => accedeAPanel(usuario, p.id));
  const ultimo = jar.get(COOKIE_ULTIMO_PANEL)?.value;
  const panel = accesibles.find((p) => p.slug === ultimo) ?? accesibles[0];
  if (!panel) {
    return <GlobalShell restringido={false}>{children}</GlobalShell>;
  }

  const [facturacion, configVentas] = await Promise.all([
    obtenerConfigFacturacion({ panelId: panel.id }),
    obtenerConfigVentas({ panelId: panel.id }),
  ]);
  return (
    <PanelProvider panel={panel}>
      <AppShell
        sidebarColapsadoInicial={jar.get(COOKIE_SIDEBAR)?.value === "colapsado"}
        restringido={false}
        fueraDelPanel
        funciones={{ facturacion: facturacion.habilitada || tieneMercadoLibre(configVentas) }}
      >
        {children}
      </AppShell>
    </PanelProvider>
  );
}
