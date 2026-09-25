import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { UsuarioProvider } from "@/components/layout/usuario-context";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { ScannerProvider } from "@/features/scanner/scanner-provider";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { obtenerConfigEscaner } from "@/server/services/configuracion.service";

/**
 * Layout protegido: carga el usuario (DB, cada request) y se lo pasa a la UI
 * por contexto. El middleware ya garantizó que la sesión es válida; esto
 * vuelve a verificarlo (defensa en profundidad).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  const [jar, configEscaner] = await Promise.all([cookies(), obtenerConfigEscaner()]);
  const colapsado = jar.get(COOKIE_SIDEBAR)?.value === "colapsado";

  return (
    <UsuarioProvider usuario={usuario}>
      {/* Un único listener global de teclado para la pistola lectora, para toda la app. */}
      <ScannerProvider config={configEscaner}>
        <AppShell sidebarColapsadoInicial={colapsado} restringido={usuario.debeCambiarPassword}>
          {children}
        </AppShell>
      </ScannerProvider>
    </UsuarioProvider>
  );
}
