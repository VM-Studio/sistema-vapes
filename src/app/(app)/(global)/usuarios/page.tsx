import type { Metadata } from "next";

import { requirePaginaOwner } from "@/server/auth/permissions";
import { listarUsuarios } from "@/server/services/usuario.service";

import { UsuariosView } from "./usuarios-view";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  const owner = await requirePaginaOwner();
  const usuarios = await listarUsuarios();
  return <UsuariosView usuarios={usuarios} usuarioActualId={owner.id} />;
}
