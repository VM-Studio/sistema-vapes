import type { Metadata } from "next";

import { LogoPanel } from "@/components/layout/logo-panel";
import { panelesActivos } from "@/server/auth/paneles-acceso";
import { nombreNegocio } from "@/server/services/identidad.service";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, paneles, negocio] = await Promise.all([
    searchParams,
    panelesActivos().catch(() => []),
    nombreNegocio(),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 text-center">
        <p className="text-muted text-sm font-medium">{negocio}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Ingresar</h1>
        <p className="text-muted text-sm">Usá tu email y contraseña</p>
      </div>
      <div className="border-border bg-surface shadow-card rounded-2xl border p-6">
        <LoginForm next={next} />
      </div>
      {paneles.length > 0 && (
        <ul className="flex items-center justify-center gap-5" aria-label="Sistemas">
          {paneles.map((p) => (
            <li key={p.id} className="flex flex-col items-center gap-1.5">
              <LogoPanel panel={p} size={32} />
              <span className="text-muted text-xs">{p.nombre}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
