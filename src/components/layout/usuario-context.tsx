"use client";

import type { Modulo } from "@prisma/client";
import { createContext, useContext, type ReactNode } from "react";

import { puede, type Accion, type UsuarioSesion } from "@/lib/permisos";

/**
 * El usuario llega desde el servidor ((app)/layout.tsx lo lee de la DB en
 * cada request) — nunca de un token leído en el cliente. Esto solo decide
 * qué se MUESTRA: la autorización real está en páginas y acciones.
 */
const UsuarioContext = createContext<UsuarioSesion | null>(null);

export function UsuarioProvider({
  usuario,
  children,
}: {
  usuario: UsuarioSesion;
  children: ReactNode;
}) {
  return <UsuarioContext.Provider value={usuario}>{children}</UsuarioContext.Provider>;
}

export function useUsuario(): UsuarioSesion {
  const usuario = useContext(UsuarioContext);
  if (!usuario) throw new Error("useUsuario() requiere <UsuarioProvider>");
  return usuario;
}

export function usePuede(modulo: Modulo, accion: Accion): boolean {
  return puede(useUsuario(), modulo, accion);
}

/** Renderiza `children` solo si el usuario puede hacer `accion` en `modulo`. */
export function Puede({
  modulo,
  accion,
  children,
  fallback = null,
}: {
  modulo: Modulo;
  accion: Accion;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePuede(modulo, accion) ? <>{children}</> : <>{fallback}</>;
}
