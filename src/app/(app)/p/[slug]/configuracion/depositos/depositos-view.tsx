"use client";

import { Modulo } from "@prisma/client";
import { Pencil, Plus, Star, Warehouse } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
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
import { formatearNumero } from "@/lib/format";
import { crearDepositoSchema, type CrearDeposito } from "@/lib/validations/deposito";
import type { DepositoListado } from "@/server/services/deposito.service";

import { activoDepositoAction, actualizarDepositoAction, crearDepositoAction } from "../actions";

const FORM_ID = "form-deposito";

export function DepositosView({ depositos }: { depositos: DepositoListado[] }) {
  const router = useRouter();
  const toast = useToast();
  const puedeCrear = usePuede(Modulo.CONFIGURACION, "crear");
  const puedeEditar = usePuede(Modulo.CONFIGURACION, "editar");
  const [editando, setEditando] = useState<DepositoListado | "nuevo" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiarActivo(d: DepositoListado, activo: boolean) {
    const r = await activoDepositoAction({ id: d.id, activo });
    if (!r.ok) return toast.error("No se pudo cambiar", r.error.message);
    toast.success(activo ? `${d.nombre} activado` : `${d.nombre} desactivado`);
    router.refresh();
  }

  const nombreCelda = (d: DepositoListado) => (
    <span className="flex items-center gap-2 font-medium">
      {d.nombre}
      {d.esPrincipal && (
        <Badge variant="primary">
          <Star className="size-3" aria-hidden /> Principal
        </Badge>
      )}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Depósitos"
        subtitle="El principal es el que se usa por defecto en ventas e ingresos."
        actions={
          puedeCrear && (
            <Button onClick={() => setEditando("nuevo")}>
              <Plus /> Nuevo depósito
            </Button>
          )
        }
      />
      <DataTable
        caption="Depósitos"
        rows={depositos}
        getRowKey={(d) => d.id}
        empty={<EmptyState icon={Warehouse} title="No hay depósitos" />}
        columns={[
          { key: "nombre", header: "Nombre", cell: nombreCelda },
          {
            key: "direccion",
            header: "Dirección",
            cell: (d) => <span className="text-muted">{d.direccion ?? "—"}</span>,
          },
          {
            key: "unidades",
            header: "Unidades",
            className: "text-right tabular-nums",
            cell: (d) => formatearNumero(d.unidades),
          },
          {
            key: "activo",
            header: "Activo",
            className: "w-24",
            cell: (d) => (
              <Switch
                checked={d.activo}
                onCheckedChange={(v) => cambiarActivo(d, v)}
                disabled={!puedeEditar}
                label={`Activo ${d.nombre}`}
                labelOculto
              />
            ),
          },
          {
            key: "acciones",
            header: <span className="sr-only">Acciones</span>,
            className: "w-px",
            cell: (d) =>
              puedeEditar && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditando(d)}
                  aria-label={`Editar ${d.nombre}`}
                >
                  <Pencil />
                </Button>
              ),
          },
        ]}
        renderMobile={(d) => (
          <div className="border-border bg-surface rounded-control border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                {nombreCelda(d)}
                <span className="text-muted text-sm">{d.direccion ?? "Sin dirección"}</span>
                <span className="text-sm">
                  <strong className="tabular-nums">{formatearNumero(d.unidades)}</strong> unidades
                </span>
              </div>
              {puedeEditar && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditando(d)}
                  aria-label={`Editar ${d.nombre}`}
                >
                  <Pencil />
                </Button>
              )}
            </div>
            <Switch
              className="border-border mt-2 border-t pt-2"
              checked={d.activo}
              onCheckedChange={(v) => cambiarActivo(d, v)}
              disabled={!puedeEditar}
              label="Activo"
            />
          </div>
        )}
      />
      <Sheet
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
        title={editando === "nuevo" ? "Nuevo depósito" : "Editar depósito"}
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
          <DepositoForm
            key={editando === "nuevo" ? "nuevo" : editando.id}
            deposito={editando === "nuevo" ? null : editando}
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

function DepositoForm({
  deposito,
  onListo,
  onEnviando,
}: {
  deposito: DepositoListado | null;
  onListo: () => void;
  onEnviando: (e: boolean) => void;
}) {
  const toast = useToast();
  const form = useZodForm(crearDepositoSchema, {
    defaultValues: {
      nombre: deposito?.nombre ?? "",
      direccion: deposito?.direccion ?? "",
      activo: deposito?.activo ?? true,
      esPrincipal: deposito?.esPrincipal ?? false,
    },
  });
  const enviando = form.formState.isSubmitting;
  useEffect(() => onEnviando(enviando), [enviando, onEnviando]);

  async function onSubmit(data: CrearDeposito) {
    const r = deposito
      ? await actualizarDepositoAction({ ...data, id: deposito.id })
      : await crearDepositoAction(data);
    if (!r.ok) return aplicarErroresServidor(form, r.error);
    toast.success(deposito ? "Depósito actualizado" : "Depósito creado");
    onListo();
  }

  return (
    <Form form={form} onSubmit={onSubmit} id={FORM_ID}>
      <FormInput name="nombre" label="Nombre" required maxLength={60} />
      <FormInput name="direccion" label="Dirección" />
      <FormSwitch
        name="esPrincipal"
        label="Depósito principal"
        hint={
          deposito?.esPrincipal
            ? "Para cambiarlo, marcá otro depósito como principal."
            : "Al marcarlo, el principal actual deja de serlo."
        }
        disabled={deposito?.esPrincipal}
      />
      <FormSwitch
        name="activo"
        label="Activo"
        hint="No se puede desactivar un depósito con stock."
      />
    </Form>
  );
}
