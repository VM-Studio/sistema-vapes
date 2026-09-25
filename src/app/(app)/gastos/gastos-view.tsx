"use client";

import type { MedioPago } from "@prisma/client";
import { BellRing, Camera, ImageIcon, Plus, Repeat, Trash2, Wallet } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";
import { MEDIOS_PAGO_GASTO } from "@/lib/validations/finanzas";

import { ETIQUETA_MEDIO } from "../ventas/nueva/tipos";
import { actualizarGastoAction, crearGastoAction, eliminarGastoAction } from "./actions";

interface Opcion {
  id: string;
  nombre: string;
}

interface Gasto {
  id: string;
  fecha: Date;
  categoriaId: string;
  categoria: string;
  descripcion: string;
  monto: string;
  medioPago: MedioPago;
  depositoId: string | null;
  deposito: string | null;
  cajaId: string | null;
  comprobanteUrl: string | null;
  recurrente: boolean;
  usuario: string;
  diaISO?: string;
}

interface Recurrente {
  id: string;
  categoria: string;
  categoriaId: string;
  descripcion: string;
  monto: string;
  medioPago: MedioPago;
  depositoId: string | null;
}

type Borrador = Partial<Gasto> & { diaISO?: string };

export function GastosView({
  gastos,
  categorias,
  depositos,
  recurrentes,
  hoy,
  abierto,
  permisos,
  filtros,
  resumen,
  vacio,
}: {
  gastos: Gasto[];
  categorias: Opcion[];
  depositos: Opcion[];
  recurrentes: Recurrente[];
  hoy: string;
  abierto: (Gasto & { diaISO: string }) | null;
  permisos: { crear: boolean; editar: boolean; eliminar: boolean };
  filtros: ReactNode;
  resumen: ReactNode;
  vacio: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [form, setForm] = useState<Borrador | null>(abierto);

  function cerrar() {
    setForm(null);
    if (params.get("gasto")) {
      const q = new URLSearchParams(params.toString());
      q.delete("gasto");
      router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {permisos.crear && (
        <div className="flex justify-end">
          <Button onClick={() => setForm({ diaISO: hoy })} className="w-full md:w-auto">
            <Plus /> Nuevo gasto
          </Button>
        </div>
      )}
      {recurrentes.length > 0 && (
        <section
          className="bg-warning-soft text-warning-soft-foreground flex flex-col gap-2 rounded-xl p-4"
          aria-label="Recurrentes pendientes"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="size-4" aria-hidden />
            Gastos recurrentes del mes pasado que todavía no cargaste este mes
          </p>
          <ul className="flex flex-col gap-1">
            {recurrentes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {r.categoria}: {r.descripcion} · {formatearPesos(r.monto)}
                </span>
                {permisos.crear && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setForm({
                        diaISO: hoy,
                        categoriaId: r.categoriaId,
                        descripcion: r.descripcion,
                        monto: r.monto,
                        medioPago: r.medioPago,
                        depositoId: r.depositoId,
                        recurrente: true,
                      })
                    }
                  >
                    Cargar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {filtros}
      {resumen}
      <DataTable
        caption="Gastos"
        rows={gastos}
        getRowKey={(g) => g.id}
        empty={vacio}
        columns={[
          {
            key: "fecha",
            header: "Fecha",
            cell: (g) => <span className="text-muted">{formatearFecha(g.fecha)}</span>,
          },
          { key: "categoria", header: "Categoría", cell: (g) => g.categoria },
          {
            key: "descripcion",
            header: "Descripción",
            cell: (g) => (
              <button
                type="button"
                className="text-left hover:underline disabled:no-underline"
                disabled={!permisos.editar}
                onClick={() => setForm(g)}
              >
                {g.descripcion}
                <Marcas g={g} />
              </button>
            ),
          },
          { key: "medio", header: "Medio", cell: (g) => ETIQUETA_MEDIO[g.medioPago] },
          {
            key: "deposito",
            header: "Depósito",
            cell: (g) => g.deposito ?? <span className="text-muted">General</span>,
          },
          {
            key: "monto",
            header: "Monto",
            className: "text-right tabular-nums font-medium",
            cell: (g) => formatearPesos(g.monto),
          },
        ]}
        renderMobile={(g) => (
          <button
            type="button"
            onClick={() => permisos.editar && setForm(g)}
            className="border-border bg-surface block w-full rounded-xl border p-4 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{g.descripcion}</span>
              <span className="font-semibold tabular-nums">{formatearPesos(g.monto)}</span>
            </div>
            <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 text-xs">
              {formatearFecha(g.fecha)} · {g.categoria} · {ETIQUETA_MEDIO[g.medioPago]}
              {g.deposito ? ` · ${g.deposito}` : ""}
              <Marcas g={g} />
            </p>
          </button>
        )}
      />
      {form && (
        <GastoSheet
          inicial={form}
          categorias={categorias}
          depositos={depositos}
          hoy={hoy}
          puedeEliminar={permisos.eliminar}
          onClose={cerrar}
        />
      )}
    </div>
  );
}

function Marcas({ g }: { g: Gasto }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {g.recurrente && (
        <Badge variant="primary">
          <Repeat className="size-3" aria-hidden /> Recurrente
        </Badge>
      )}
      {g.cajaId && (
        <Badge>
          <Wallet className="size-3" aria-hidden /> De la caja
        </Badge>
      )}
      {g.comprobanteUrl && (
        <Badge>
          <ImageIcon className="size-3" aria-hidden /> Ticket
        </Badge>
      )}
    </span>
  );
}

function GastoSheet({
  inicial,
  categorias,
  depositos,
  hoy,
  puedeEliminar,
  onClose,
}: {
  inicial: Borrador;
  categorias: Opcion[];
  depositos: Opcion[];
  hoy: string;
  puedeEliminar: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [borrar, setBorrar] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const editando = Boolean(inicial.id);
  const dia = inicial.diaISO ?? (inicial.fecha ? hoyAR(new Date(inicial.fecha)) : hoy);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const datos = new FormData(e.currentTarget);
    const r = editando ? await actualizarGastoAction(datos) : await crearGastoAction(datos);
    setEnviando(false);
    if (!r.ok) {
      setErrores(r.error.fields ?? {});
      return toast.error(
        editando ? "No se pudo guardar" : "No se pudo cargar el gasto",
        r.error.message,
      );
    }
    toast.success(
      editando ? "Gasto actualizado" : "Gasto cargado",
      !editando && "cajaId" in r.data && r.data.cajaId ? "Salió de la caja abierta." : undefined,
    );
    onClose();
    router.refresh();
  }

  async function eliminar() {
    const r = await eliminarGastoAction({ id: inicial.id });
    setBorrar(false);
    if (!r.ok) return toast.error("No se pudo borrar", r.error.message);
    toast.success("Gasto borrado");
    onClose();
    router.refresh();
  }

  const err = (k: string) => errores[k]?.[0];
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={editando ? "Editar gasto" : "Nuevo gasto"}
      description={
        inicial.cajaId
          ? "Salió de la caja: el monto, medio, depósito y fecha ya no se cambian."
          : undefined
      }
      footer={
        <>
          {editando && puedeEliminar && (
            <Button
              variant="secondary"
              className="text-danger"
              onClick={() => setBorrar(true)}
              disabled={enviando}
            >
              <Trash2 /> Borrar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-gasto" loading={enviando}>
            {editando ? "Guardar" : "Cargar gasto"}
          </Button>
        </>
      }
    >
      <form
        id="form-gasto"
        onSubmit={enviar}
        className="flex flex-col gap-4"
        encType="multipart/form-data"
      >
        {editando && <input type="hidden" name="id" value={inicial.id} />}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Fecha"
            name="fecha"
            type="date"
            required
            defaultValue={dia}
            max={hoy}
            error={err("fecha")}
            disabled={Boolean(inicial.cajaId)}
          />
          <Input
            label="Monto"
            name="monto"
            inputMode="decimal"
            required
            defaultValue={inicial.monto ? String(Number(inicial.monto)) : ""}
            placeholder="0"
            error={err("monto")}
            readOnly={Boolean(inicial.cajaId)}
          />
        </div>
        {inicial.cajaId && <input type="hidden" name="fecha" value={dia} />}
        <Select
          label="Categoría"
          name="categoriaGastoId"
          required
          defaultValue={inicial.categoriaId ?? ""}
          placeholder="Elegí una categoría"
          options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
          error={err("categoriaGastoId")}
        />
        <Textarea
          label="Descripción"
          name="descripcion"
          required
          rows={2}
          maxLength={300}
          defaultValue={inicial.descripcion ?? ""}
          error={err("descripcion")}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Medio de pago"
            name="medioPago"
            defaultValue={inicial.medioPago ?? "EFECTIVO"}
            options={MEDIOS_PAGO_GASTO.map((m) => ({ value: m, label: ETIQUETA_MEDIO[m] }))}
            error={err("medioPago")}
            disabled={Boolean(inicial.cajaId)}
          />
          <Select
            label="Depósito"
            name="depositoId"
            defaultValue={inicial.depositoId ?? ""}
            options={[
              { value: "", label: "General (del negocio)" },
              ...depositos.map((d) => ({ value: d.id, label: d.nombre })),
            ]}
            error={err("depositoId")}
            disabled={Boolean(inicial.cajaId)}
          />
        </div>
        {inicial.cajaId && (
          <>
            <input type="hidden" name="medioPago" value={inicial.medioPago} />
            <input type="hidden" name="depositoId" value={inicial.depositoId ?? ""} />
          </>
        )}
        <p className="text-muted -mt-2 text-xs">
          En efectivo, con depósito y fecha de hoy: sale de la caja abierta de ese depósito.
        </p>
        <label className="border-border hover:bg-surface-2 flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 text-sm">
          <Camera className="text-muted size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {foto ??
              (inicial.comprobanteUrl
                ? "Reemplazar la foto del ticket"
                : "Foto del ticket (opcional)")}
          </span>
          <input
            type="file"
            name="comprobante"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            onChange={(e) => setFoto(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        {err("comprobante") && <p className="text-danger text-sm">{err("comprobante")}</p>}
        {inicial.comprobanteUrl && (
          <a
            href={inicial.comprobanteUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm hover:underline"
          >
            Ver la foto actual
          </a>
        )}
        <Checkbox
          name="recurrente"
          label="Es recurrente (todos los meses)"
          defaultChecked={inicial.recurrente ?? false}
        />
      </form>
      <ConfirmDialog
        open={borrar}
        onOpenChange={setBorrar}
        title="¿Borrar este gasto?"
        description={
          inicial.cajaId
            ? "La plata vuelve a la caja (ingreso extra)."
            : "Deja de contar en los reportes."
        }
        confirmLabel="Borrar"
        danger
        onConfirm={eliminar}
      />
    </Sheet>
  );
}
