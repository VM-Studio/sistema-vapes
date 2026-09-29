"use client";

import { RolUsuario } from "@prisma/client";
import {
  Check,
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
import { cardVariants } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { UsuarioListado } from "@/server/services/usuario.service";

import { darDeBajaUsuarioAction, resetearPasswordAction, revocarSesionesAction } from "./actions";
import { CrearUsuarioForm, EditarUsuarioForm, FORM_USUARIO_ID } from "./usuario-form";

type Editor = { modo: "crear" } | { modo: "editar"; usuario: UsuarioListado } | null;
type Confirmacion = { tipo: "reset" | "baja" | "sesiones"; usuario: UsuarioListado } | null;

/** Sistemas a los que accede: logos chicos en fila (los dueños acceden a todos). */
function LogosPaneles({ u }: { u: UsuarioListado }) {
  if (u.rol === RolUsuario.OWNER) return <span className="text-muted">Todos los sistemas</span>;
  if (u.paneles.length === 0)
    return <span className="text-warning-soft-foreground">Sin sistemas habilitados</span>;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Sistemas habilitados">
      {u.paneles.map((p) => (
        <li key={p.id} className="flex h-6 items-center" title={p.nombre}>
          <LogoPanel panel={p} size={20} />
        </li>
      ))}
    </ul>
  );
}

function Estado({ u }: { u: UsuarioListado }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn("rounded-circle size-2", u.activo ? "bg-success" : "bg-danger")}
        />
        {u.activo ? "Activo" : "Inactivo"}
      </span>
      {u.debeCambiarPassword && <Badge variant="warning">Contraseña temporal</Badge>}
    </span>
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

  function acciones(u: UsuarioListado) {
    const esYo = u.id === usuarioActualId;
    return (
      <div className="border-border flex items-center gap-1 border-t pt-3">
        <Link
          href={`/usuarios/${u.id}`}
          className={cn(buttonVariants({ variant: "secondary" }), "mr-auto")}
          aria-label={`Acceso y sesiones de ${u.nombre}`}
          title="Acceso y sesiones"
        >
          <ShieldCheck strokeWidth={1.75} />
          Acceso
        </Link>
        <IconButton
          onClick={() => setEditor({ modo: "editar", usuario: u })}
          aria-label={`Editar a ${u.nombre}`}
          title="Editar"
        >
          <Pencil strokeWidth={1.75} />
        </IconButton>
        {!esYo && (
          <>
            <IconButton
              onClick={() => setConfirmacion({ tipo: "reset", usuario: u })}
              aria-label={`Resetear contraseña de ${u.nombre}`}
              title="Resetear contraseña"
            >
              <KeyRound strokeWidth={1.75} />
            </IconButton>
            <IconButton
              onClick={() => setConfirmacion({ tipo: "sesiones", usuario: u })}
              aria-label={`Cerrar sesiones de ${u.nombre}`}
              title="Cerrar sus sesiones"
            >
              <LogOut strokeWidth={1.75} />
            </IconButton>
            <IconButton
              className="text-danger hover:bg-danger-soft hover:text-danger"
              onClick={() => setConfirmacion({ tipo: "baja", usuario: u })}
              aria-label={`Dar de baja a ${u.nombre}`}
              title="Dar de baja"
            >
              <UserX strokeWidth={1.75} />
            </IconButton>
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
            <Plus strokeWidth={1.75} /> Nuevo usuario
          </Button>
        }
      />

      {usuarios.length === 0 ? (
        <EmptyState icon={Users} title="No hay usuarios" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {usuarios.map((u) => (
            <li key={u.id} className={cn(cardVariants(), "flex flex-col gap-4 p-4 md:p-5")}>
              <div className="flex items-start gap-3">
                <Avatar nombre={u.nombre} className="size-10" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-h3 truncate font-semibold">
                    {u.nombre}
                    {u.id === usuarioActualId && (
                      <span className="text-muted text-small ml-1.5 font-normal">(vos)</span>
                    )}
                  </p>
                  <p className="text-muted text-small truncate">{u.email}</p>
                </div>
                <Badge
                  variant={u.rol === RolUsuario.OWNER ? "primary" : "neutral"}
                  className={u.rol === RolUsuario.OWNER ? undefined : "bg-surface-3"}
                >
                  {u.rol === RolUsuario.OWNER ? "Dueño" : "Empleado"}
                </Badge>
              </div>
              <dl className="text-small grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
                <dt className="text-muted">Sistemas</dt>
                <dd className="min-w-0">
                  <LogosPaneles u={u} />
                </dd>
                <dt className="text-muted">Estado</dt>
                <dd>
                  <Estado u={u} />
                </dd>
                <dt className="text-muted">Último acceso</dt>
                <dd className="tabular-nums">
                  {u.ultimoLogin ? formatearFechaHora(u.ultimoLogin) : "Nunca"}
                </dd>
              </dl>
              <div className="mt-auto">{acciones(u)}</div>
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
        <div className="border-border bg-surface rounded-control flex items-center gap-2 border p-2 pl-4">
          <code className="text-h3 flex-1 font-mono font-semibold tracking-wider select-all">
            {temporal?.password}
          </code>
          <Button variant="secondary" size="icon" onClick={copiar} aria-label="Copiar contraseña">
            {copiado ? <Check strokeWidth={1.75} /> : <Copy strokeWidth={1.75} />}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
