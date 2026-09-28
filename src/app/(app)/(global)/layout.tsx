import { GlobalShell } from "@/components/layout/global-shell";
import { requirePaginaUsuario } from "@/server/auth/permissions";

/** Pantallas fuera de los paneles: selector, usuarios, configuración, cuenta, ayuda. */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const usuario = await requirePaginaUsuario({ permitirCambioPendiente: true });
  return <GlobalShell restringido={usuario.debeCambiarPassword}>{children}</GlobalShell>;
}
