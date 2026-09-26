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

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
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
        {u.rol === RolUsuario.EMPLEADO && (
          <Link
            href={`/usuarios/${u.id}/permisos`}
            className={cn(
              buttonVariants({ variant: "ghost", size: compacto ? "sm" : "icon" }),
              clase,
            )}
            aria-label={`Permisos de ${u.nombre}`}
            title="Permisos"
          >
            <ShieldCheck />
            {compacto && "Permisos"}
          </Link>
        )}
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

  const columnas: DataTableColumn<UsuarioListado>[] = [
    {
      key: "nombre",
      header: "Nombre",
      cell: (u) => (
        <span className="font-medium">
          {u.nombre}
          {u.id === usuarioActualId && (
            <span className="text-muted ml-2 text-xs font-normal">(vos)</span>
          )}
        </span>
      ),
    },
    { key: "email", header: "Email", cell: (u) => <span className="text-muted">{u.email}</span> },
    { key: "estado", header: "Rol y estado", cell: (u) => <BadgesEstado u={u} /> },
    {
      key: "ultimoLogin",
      header: "Último ingreso",
      cell: (u) => (
        <span className="text-muted whitespace-nowrap">{formatearFechaHora(u.ultimoLogin)}</span>
      ),
    },
    {
      key: "acciones",
      header: <span className="sr-only">Acciones</span>,
      cell: (u) => acciones(u, false),
      className: "w-px",
    },
  ];

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Quién puede entrar al sistema y qué puede hacer"
        actions={
          <Button onClick={() => setEditor({ modo: "crear" })}>
            <Plus /> Nuevo usuario
          </Button>
        }
      />

      <DataTable
        caption="Usuarios"
        columns={columnas}
        rows={usuarios}
        getRowKey={(u) => u.id}
        empty={<EmptyState icon={Users} title="No hay usuarios" />}
        renderMobile={(u) => (
          <div className="border-border bg-surface rounded-xl border p-4">
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {u.nombre}
                {u.id === usuarioActualId && (
                  <span className="text-muted ml-2 text-xs font-normal">(vos)</span>
                )}
              </p>
              <p className="text-muted text-sm break-all">{u.email}</p>
              <div className="mt-1.5">
                <BadgesEstado u={u} />
              </div>
              <p className="text-muted mt-1.5 text-xs">
                Último ingreso: {formatearFechaHora(u.ultimoLogin)}
              </p>
            </div>
            {acciones(u, true)}
          </div>
        )}
      />

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
