import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { UsuarioProvider } from "@/components/layout/usuario-context";
import { COOKIE_SIDEBAR } from "@/config/ui";
import { requirePaginaUsuario } from "@/server/auth/permissions";

/**
 * Layout protegido: carga el usuario (DB, cada request) y se lo pasa a la UI
 * por contexto. El middleware ya garantizó que la sesión es válida; esto
 * vuelve a verificarlo (defensa en profundidad).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  const colapsado = (await cookies()).get(COOKIE_SIDEBAR)?.value === "colapsado";

  return (
    <UsuarioProvider usuario={usuario}>
      <AppShell sidebarColapsadoInicial={colapsado} restringido={usuario.debeCambiarPassword}>
        {children}
      </AppShell>
    </UsuarioProvider>
  );
}
