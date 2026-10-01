import { GlobalShell } from "@/components/layout/global-shell";
import { requirePaginaUsuario } from "@/server/auth/permissions";

/** Selector de sistemas (/paneles): todavía no hay panel elegido, va con la barra global. */
export default async function SelectorLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  return <GlobalShell restringido={usuario.debeCambiarPassword}>{children}</GlobalShell>;
}
