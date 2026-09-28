"use client";

import { RolUsuario } from "@prisma/client";
import {
  Check,
  Clock,
  Copy,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  UserX,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LogoPanel } from "@/components/layout/logo-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { UsuarioListado } from "@/server/services/usuario.service";

import { darDeBajaUsuarioAction, resetearPasswordAction, revocarSesionesAction } from "./actions";
import { CrearUsuarioForm, EditarUsuarioForm, FORM_USUARIO_ID } from "./usuario-form";

type Editor = { modo: "crear" } | { modo: "editar"; usuario: UsuarioListado } | null;
type Confirmacion = { tipo: "reset" | "baja" | "sesiones"; usuario: UsuarioListado } | null;

/** Paneles a los que accede: chips con logo (los dueños acceden a todos). */
function ChipsPaneles({ u }: { u: UsuarioListado }) {
  if (u.rol === RolUsuario.OWNER)
    return <span className="text-muted text-sm">Todos los sistemas</span>;
  if (u.paneles.length === 0)
    return <span className="text-warning-soft-foreground text-sm">Sin sistemas habilitados</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sistemas habilitados">
      {u.paneles.map((p) => (
        <li
          key={p.id}
          className="border-border bg-surface-2 flex min-h-8 items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-1 text-sm font-medium"
        >
          <LogoPanel panel={p} size={22} className="rounded-full" />
          {p.nombre}
        </li>
      ))}
    </ul>
  );
}

function BadgesEstado({ u }: { u: UsuarioListado }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant={u.rol === RolUsuario.OWNER ? "primary" : "neutral"}>
        {u.rol === RolUsuario.OWNER ? "Dueño" : "Empleado"}
      </Badge>
      {u.activo ? (
        <Badge variant="success">Activo</Badge>
      ) : (
        <Badge variant="danger">Inactivo</Badge>
      )}
      {u.debeCambiarPassword && <Badge variant="warning">Contraseña temporal</Badge>}
    </div>
  );
}

export function UsuariosView({
  usuarios,
  usuarioActualId,
}: {
  usuarios: UsuarioListado[];
  usuarioActualId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editor, setEditor] = useState<Editor>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmacion, setConfirmacion] = useState<Confirmacion>(null);
  const [temporal, setTemporal] = useState<{ nombre: string; password: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  function cerrarEditor() {
    setEditor(null);
    router.refresh();
  }

  async function confirmar() {
    if (!confirmacion) return;
    const { tipo, usuario } = confirmacion;
    if (tipo === "sesiones") {
      const r = await revocarSesionesAction({ id: usuario.id });
      if (!r.ok) return toast.error("No se pudieron cerrar las sesiones", r.error.message);
      setConfirmacion(null);
      toast.success(
        `Sesiones de ${usuario.nombre} cerradas`,
        `${r.data.revocadas} dispositivo(s): tiene que volver a ingresar.`,
      );
    } else if (tipo === "reset") {
      const r = await resetearPasswordAction({ id: usuario.id });
      if (!r.ok) return toast.error("No se pudo resetear", r.error.message);
      setConfirmacion(null);
      setCopiado(false);
      setTemporal({ nombre: usuario.nombre, password: r.data.passwordTemporal });
    } else {
      const r = await darDeBajaUsuarioAction({ id: usuario.id });
      if (!r.ok) return toast.error("No se pudo dar de baja", r.error.message);
      setConfirmacion(null);
      toast.success(`${usuario.nombre} fue dado de baja`);
    }
    router.refresh();
  }

  async function copiar() {
    if (!temporal) return;
    await navigator.clipboard.writeText(temporal.password);
    setCopiado(true);
  }

  function acciones(u: UsuarioListado, compacto: boolean) {
    const esYo = u.id === usuarioActualId;
    const clase = compacto ? "min-w-0" : undefined;
    return (
      <div
        className={cn(
          compacto
            ? // mobile: grilla que se adapta a 1-4 acciones sin desbordar los 375px
              "border-border mt-3 grid grid-cols-2 gap-1 border-t pt-3"
            : "flex justify-end gap-1",
        )}
      >
        <Button
          variant="ghost"
          size={compacto ? "sm" : "icon"}
          className={clase}
          onClick={() => setEditor({ modo: "editar", usuario: u })}
          aria-label={`Editar a ${u.nombre}`}
          title="Editar"
        >
          <Pencil />
          {compacto && "Editar"}
        </Button>
        <Link
          href={`/usuarios/${u.id}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: compacto ? "sm" : "icon" }),
            clase,
          )}
          aria-label={`Acceso y sesiones de ${u.nombre}`}
          title="Acceso y sesiones"
        >
          <ShieldCheck />
          {compacto && "Acceso"}
        </Link>
        {!esYo && (
          <>
            <Button
              variant="ghost"
              size={compacto ? "sm" : "icon"}
              className={clase}
              onClick={() => setConfirmacion({ tipo: "reset", usuario: u })}
              aria-label={`Resetear contraseña de ${u.nombre}`}
              title="Resetear contraseña"
            >
              <KeyRound />
              {compacto && "Resetear"}
            </Button>
            <Button
              variant="ghost"
              size={compacto ? "sm" : "icon"}
              className={clase}
              onClick={() => setConfirmacion({ tipo: "sesiones", usuario: u })}
              aria-label={`Cerrar sesiones de ${u.nombre}`}
              title="Cerrar sus sesiones"
            >
              <LogOut />
              {compacto && "Sesiones"}
            </Button>
            <Button
              variant="ghost"
              size={compacto ? "sm" : "icon"}
              className={cn(clase, "text-danger hover:bg-danger-soft")}
              onClick={() => setConfirmacion({ tipo: "baja", usuario: u })}
              aria-label={`Dar de baja a ${u.nombre}`}
              title="Dar de baja"
            >
              <UserX />
              {compacto && "Baja"}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién entra, a qué sistemas y qué puede hacer en cada uno"
        actions={
          <Button onClick={() => setEditor({ modo: "crear" })}>
            <Plus /> Nuevo usuario
          </Button>
        }
      />

      {usuarios.length === 0 ? (
        <EmptyState icon={Users} title="No hay usuarios" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {usuarios.map((u) => (
            <li
              key={u.id}
              className="border-border bg-surface shadow-card flex flex-col gap-4 rounded-2xl border p-5"
            >
              <div className="flex items-start gap-3">
                <Avatar nombre={u.nombre} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate font-semibold">
                    {u.nombre}
                    {u.id === usuarioActualId && (
                      <span className="text-muted ml-2 text-xs font-normal">(vos)</span>
                    )}
                  </p>
                  <p className="text-muted truncate text-sm">{u.email}</p>
                </div>
              </div>
              <BadgesEstado u={u} />
              <ChipsPaneles u={u} />
              <p className="text-muted flex items-center gap-1.5 text-xs">
                <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
                Último acceso: {u.ultimoLogin ? formatearFechaHora(u.ultimoLogin) : "nunca"}
              </p>
              <div className="mt-auto">{acciones(u, true)}</div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editor !== null}
        onOpenChange={(o) => !o && setEditor(null)}
        title={editor?.modo === "editar" ? "Editar usuario" : "Nuevo usuario"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_USUARIO_ID} loading={enviando}>
              {editor?.modo === "editar" ? "Guardar" : "Crear usuario"}
            </Button>
          </>
        }
      >
        {editor?.modo === "crear" && (
          <CrearUsuarioForm onListo={cerrarEditor} onEnviando={setEnviando} />
        )}
        {editor?.modo === "editar" && (
          <EditarUsuarioForm
            key={editor.usuario.id}
            usuario={editor.usuario}
            esUnoMismo={editor.usuario.id === usuarioActualId}
            onListo={cerrarEditor}
            onEnviando={setEnviando}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmacion !== null}
        onOpenChange={(o) => !o && setConfirmacion(null)}
        title={
          confirmacion?.tipo === "baja"
            ? `¿Dar de baja a ${confirmacion.usuario.nombre}?`
            : confirmacion?.tipo === "sesiones"
              ? `¿Cerrar las sesiones de ${confirmacion.usuario.nombre}?`
              : `¿Resetear la contraseña de ${confirmacion?.usuario.nombre}?`
        }
        description={
          confirmacion?.tipo === "baja"
            ? "No va a poder ingresar más y su sesión se corta de inmediato. Su historial (ventas, movimientos) se conserva."
            : confirmacion?.tipo === "sesiones"
              ? "Se cierra en todos sus dispositivos (celular, computadora). Puede volver a ingresar con su contraseña."
              : "Se genera una contraseña temporal que vas a ver una sola vez. Va a tener que cambiarla al ingresar."
        }
        confirmLabel={
          confirmacion?.tipo === "baja"
            ? "Dar de baja"
            : confirmacion?.tipo === "sesiones"
              ? "Cerrar sesiones"
              : "Resetear"
        }
        danger={confirmacion?.tipo === "baja"}
        onConfirm={confirmar}
      />

      <Dialog
        open={temporal !== null}
        onOpenChange={(o) => !o && setTemporal(null)}
        title="Contraseña temporal"
        description={
          <>
            Pasale esta contraseña a <strong>{temporal?.nombre}</strong>.{" "}
            <strong>No se va a volver a mostrar.</strong>
          </>
        }
        footer={
          <Button onClick={() => setTemporal(null)} fullWidth>
            Listo, ya la copié
          </Button>
        }
      >
        <div className="border-border bg-surface-2 flex items-center gap-2 rounded-lg border p-2 pl-4">
          <code className="flex-1 font-mono text-lg tracking-wider select-all">
            {temporal?.password}
          </code>
          <Button variant="secondary" size="icon" onClick={copiar} aria-label="Copiar contraseña">
            {copiado ? <Check className="text-success" /> : <Copy />}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
