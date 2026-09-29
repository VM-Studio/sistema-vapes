"use client";

import { Modulo } from "@prisma/client";
import { Pencil, Plus, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { usePuede } from "@/components/layout/usuario-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSwitch,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import { crearCategoriaSchema, type CrearCategoria } from "@/lib/validations/clasificacion";
import type { ClasificacionListada } from "@/server/services/clasificacion.service";

import {
  activoCategoriaAction,
  activoMarcaAction,
  actualizarCategoriaAction,
  actualizarMarcaAction,
  crearCategoriaAction,
  crearMarcaAction,
} from "./actions";

type Tipo = "categoria" | "marca";

const TEXTOS: Record<Tipo, { titulo: string; singular: string; subtitulo: string }> = {
  categoria: {
    titulo: "Categorías",
    singular: "categoría",
    subtitulo: "Agrupan los productos en el catálogo y los reportes.",
  },
  marca: { titulo: "Marcas", singular: "marca", subtitulo: "Fabricante de cada producto." },
};

const ACCIONES = {
  categoria: {
    crear: crearCategoriaAction,
    actualizar: actualizarCategoriaAction,
    activo: activoCategoriaAction,
  },
  marca: { crear: crearMarcaAction, actualizar: actualizarMarcaAction, activo: activoMarcaAction },
} as const;

const FORM_ID = "form-clasificacion";

/** Categorías y marcas: mismo comportamiento (listado + Sheet + toggle activo). */
export function ClasificacionView({ tipo, filas }: { tipo: Tipo; filas: ClasificacionListada[] }) {
  const router = useRouter();
  const toast = useToast();
  const textos = TEXTOS[tipo];
  const puedeCrear = usePuede(Modulo.CONFIGURACION, "crear");
  const puedeEditar = usePuede(Modulo.CONFIGURACION, "editar");
  const [editando, setEditando] = useState<ClasificacionListada | "nuevo" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiarActivo(f: ClasificacionListada, activo: boolean) {
    const r = await ACCIONES[tipo].activo({ id: f.id, activo });
    if (!r.ok) return toast.error("No se pudo cambiar", r.error.message);
    toast.success(activo ? `${f.nombre} activada` : `${f.nombre} desactivada`);
    router.refresh();
  }

  const switchActivo = (f: ClasificacionListada, label: string, className?: string) => (
    <Switch
      className={className}
      checked={f.activo}
      onCheckedChange={(v) => cambiarActivo(f, v)}
      disabled={!puedeEditar}
      label={label}
      labelOculto={label !== "Activa"}
    />
  );

  return (
    <>
      <PageHeader
        title={textos.titulo}
        subtitle={textos.subtitulo}
        actions={
          puedeCrear && (
            <Button onClick={() => setEditando("nuevo")} className="hidden md:inline-flex">
              <Plus strokeWidth={1.75} /> Nueva {textos.singular}
            </Button>
          )
        }
      />
      {puedeCrear && (
        <BarraAccion soloMobile>
          <Button onClick={() => setEditando("nuevo")}>
            <Plus strokeWidth={1.75} /> Nueva {textos.singular}
          </Button>
        </BarraAccion>
      )}
      <DataTable
        caption={textos.titulo}
        rows={filas}
        getRowKey={(f) => f.id}
        empty={
          <EmptyState
            icon={Tag}
            title={`Todavía no hay ${textos.titulo.toLowerCase()}`}
            description={textos.subtitulo}
            action={
              puedeCrear && (
                <Button onClick={() => setEditando("nuevo")}>
                  <Plus strokeWidth={1.75} /> Nueva {textos.singular}
                </Button>
              )
            }
          />
        }
        columns={[
          {
            key: "nombre",
            header: "Nombre",
            cell: (f) => <span className="font-medium">{f.nombre}</span>,
          },
          ...(tipo === "categoria"
            ? [
                {
                  key: "desc",
                  header: "Descripción",
                  cell: (f: ClasificacionListada) => (
                    <span className="text-muted">{f.descripcion ?? "—"}</span>
                  ),
                },
              ]
            : []),
          {
            key: "productos",
            header: "Productos activos",
            className: "text-right",
            cell: (f) => f.productosActivos,
          },
          {
            key: "activo",
            header: "Activa",
            className: "w-24",
            cell: (f) => switchActivo(f, `Activa ${f.nombre}`),
          },
          {
            key: "acciones",
            header: <span className="sr-only">Acciones</span>,
            className: "w-px",
            cell: (f) =>
              puedeEditar && (
                <IconButton onClick={() => setEditando(f)} aria-label={`Editar ${f.nombre}`}>
                  <Pencil strokeWidth={1.75} />
                </IconButton>
              ),
          },
        ]}
        renderMobile={(f) => (
          <div className="bg-card rounded-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{f.nombre}</span>
                {f.descripcion && <span className="text-muted text-sm">{f.descripcion}</span>}
                <span className="text-muted text-sm">{f.productosActivos} productos activos</span>
              </div>
              {puedeEditar && (
                <IconButton onClick={() => setEditando(f)} aria-label={`Editar ${f.nombre}`}>
                  <Pencil strokeWidth={1.75} />
                </IconButton>
              )}
            </div>
            {switchActivo(f, "Activa", "mt-3 border-t border-border pt-1")}
          </div>
        )}
      />
      <Sheet
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
        title={editando === "nuevo" ? `Nueva ${textos.singular}` : `Editar ${textos.singular}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {editando !== null && (
          <ClasificacionForm
            key={editando === "nuevo" ? "nuevo" : editando.id}
            tipo={tipo}
            fila={editando === "nuevo" ? null : editando}
            onEnviando={setEnviando}
            onListo={() => {
              setEditando(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function ClasificacionForm({
  tipo,
  fila,
  onListo,
  onEnviando,
}: {
  tipo: Tipo;
  fila: ClasificacionListada | null;
  onListo: () => void;
  onEnviando: (e: boolean) => void;
}) {
  const toast = useToast();
  // Mismo schema para ambas: la marca simplemente no usa "descripción".
  const form = useZodForm(crearCategoriaSchema, {
    defaultValues: {
      nombre: fila?.nombre ?? "",
      descripcion: fila?.descripcion ?? "",
      activo: fila?.activo ?? true,
    },
  });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando(enviando), [enviando, onEnviando]);

  async function onSubmit(data: CrearCategoria) {
    const acciones = ACCIONES[tipo];
    const datos = tipo === "categoria" ? data : { nombre: data.nombre, activo: data.activo };
    const r: ActionResult<{ id: string }> = fila
      ? await acciones.actualizar({ ...datos, id: fila.id })
      : await acciones.crear(datos);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    toast.success(
      fila
        ? "Cambios guardados"
        : `${TEXTOS[tipo].singular[0]!.toUpperCase()}${TEXTOS[tipo].singular.slice(1)} creada`,
    );
    onListo();
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={FORM_ID}>
      <FormInput name="nombre" label="Nombre" required />
      {tipo === "categoria" && <FormInput name="descripcion" label="Descripción" />}
      <FormSwitch
        name="activo"
        label="Activa"
        hint="No se puede desactivar si tiene productos activos."
      />
    </Form>
  );
}
