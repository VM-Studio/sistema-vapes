import { AvisoActualizacion } from "@/components/pwa/aviso-actualizacion";
import { BannerInstalar } from "@/components/pwa/banner-instalar";
import { UsuarioProvider } from "@/components/layout/usuario-context";
import { requirePaginaUsuario } from "@/server/auth/permissions";

/**
 * Layout protegido: carga el usuario (DB, cada request) y se lo pasa a la UI
 * por contexto. El middleware ya garantizó que la sesión es válida; esto
 * vuelve a verificarlo (defensa en profundidad). El esqueleto visual lo pone
 * cada grupo: (global) para lo de fuera de los paneles, p/[slug] para un panel.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  return (
    <UsuarioProvider usuario={usuario}>
      {children}
      <AvisoActualizacion />
      {!usuario.debeCambiarPassword && <BannerInstalar />}
    </UsuarioProvider>
  );
}
