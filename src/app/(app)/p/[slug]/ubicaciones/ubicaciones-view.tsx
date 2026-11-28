"use client";

import {
  ArrowDown,
  ArrowUp,
  MapPin,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { DatosUbicaciones, UbicacionListada } from "@/server/services/ubicacion.service";

import {
  actualizarUbicacionAction,
  asignarUbicacionAction,
  crearUbicacionAction,
  eliminarUbicacionAction,
  moverUbicacionAction,
} from "./actions";

const SIN = "__sin__";
const TODAS = "";

/** Sin tildes ni mayúsculas, para buscar. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Ubicaciones de productos. Dueños: arman los lugares (crear, renombrar,
 * ordenar, borrar) y asignan cada modelo a uno (de a uno o varios juntos).
 * Charly (perfil de escaneo): lo ve para saber en qué estante buscar.
 */
export function UbicacionesView({
  datos,
  editable,
}: {
  datos: DatosUbicaciones;
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<string>(TODAS);
  const [editando, setEditando] = useState<UbicacionListada | "nueva" | null>(null);
  const [borrando, setBorrando] = useState<UbicacionListada | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [destino, setDestino] = useState<string>("");
  const [guardando, setGuardando] = useState<string | null>(null);

  const porId = useMemo(
    () => new Map(datos.ubicaciones.map((u) => [u.id, u])),
    [datos.ubicaciones],
  );
  const sinUbicacion = datos.productos.filter((p) => !p.ubicacionId).length;
  const visibles = useMemo(() => {
    const t = norm(q.trim());
    return datos.productos.filter(
      (p) =>
        (filtro === TODAS || (filtro === SIN ? !p.ubicacionId : p.ubicacionId === filtro)) &&
        (!t || norm(`${p.nombre} ${porId.get(p.ubicacionId ?? "")?.nombre ?? ""}`).includes(t)),
    );
  }, [datos.productos, filtro, q, porId]);

  const opciones = [
    { value: SIN, label: "Sin ubicación" },
    ...datos.ubicaciones.map((u) => ({ value: u.id, label: u.nombre })),
  ];

  async function asignar(productoIds: string[], ubicacion: string) {
    setGuardando(productoIds.length === 1 ? productoIds[0]! : "varios");
    const r = await asignarUbicacionAction({
      productoIds,
      ubicacionId: ubicacion === SIN ? null : ubicacion,
    });
    setGuardando(null);
    if (!r.ok) return toast.error("No se pudo guardar", r.error.message);
    const nombre = ubicacion === SIN ? "sin ubicación" : porId.get(ubicacion)?.nombre;
    toast.success(
      productoIds.length === 1 ? "Ubicación guardada" : `${r.data.productos} modelos movidos`,
      `Quedaron en ${nombre}.`,
    );
    setElegidos([]);
    setDestino("");
    router.refresh();
  }

  async function mover(u: UbicacionListada, direccion: -1 | 1) {
    const r = await moverUbicacionAction({ id: u.id, direccion });
    if (!r.ok) return toast.error("No se pudo mover", r.error.message);
    router.refresh();
  }

  async function borrar(u: UbicacionListada) {
    const r = await eliminarUbicacionAction({ id: u.id });
    if (!r.ok) return toast.error("No se pudo borrar", r.error.message);
    toast.success(
      `${u.nombre} borrada`,
      r.data.productos ? `${r.data.productos} modelos quedaron sin ubicación.` : undefined,
    );
    if (filtro === u.id) setFiltro(TODAS);
    setBorrando(null);
    router.refresh();
  }

  const todosVisiblesElegidos =
    visibles.length > 0 && visibles.every((p) => elegidos.includes(p.id));

  return (
    <>
      <PageHeader
        title="Ubicaciones de productos"
        subtitle={
          editable
            ? "Armá los lugares del galpón y elegí dónde está cada modelo. Charly lo ve al escanear."
            : "Dónde está guardado cada modelo en el galpón."
        }
        actions={
          editable ? (
            <Button onClick={() => setEditando("nueva")}>
              <Plus strokeWidth={1.75} /> Nueva ubicación
            </Button>
          ) : (
            <Link href={ruta("/escaneo")} className={buttonVariants({ variant: "secondary" })}>
              <ScanBarcode strokeWidth={1.75} /> Volver a escanear
            </Link>
          )
        }
      />

      <SectionCard
        title="Lugares"
        description={
          editable
            ? "Ej.: «Estante A · fila 2». Ordenalos como están en el galpón."
            : "Tocá uno para ver qué modelos hay."
        }
        className="mb-4"
      >
        {datos.ubicaciones.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="Todavía no hay ubicaciones"
            description={
              editable
                ? "Creá los estantes o sectores del galpón con «Nueva ubicación»."
                : "Los dueños todavía no cargaron las ubicaciones."
            }
            className="bg-surface py-8"
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Lugares">
            {datos.ubicaciones.map((u, i) => (
              <li
                key={u.id}
                className={cn(
                  "bg-surface rounded-card flex items-center gap-2 border-2 p-3",
                  filtro === u.id ? "border-foreground" : "border-transparent",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  onClick={() => setFiltro(filtro === u.id ? TODAS : u.id)}
                  aria-pressed={filtro === u.id}
                >
                  <MapPin
                    className="text-muted mt-0.5 size-5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{u.nombre}</span>
                    {u.descripcion && (
                      <span className="text-muted block text-xs">{u.descripcion}</span>
                    )}
                    <span className="text-muted block text-xs">
                      {u.productos} modelo{u.productos === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
                {editable && (
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      size="sm"
                      aria-label={`Subir ${u.nombre}`}
                      disabled={i === 0}
                      onClick={() => void mover(u, -1)}
                    >
                      <ArrowUp strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label={`Bajar ${u.nombre}`}
                      disabled={i === datos.ubicaciones.length - 1}
                      onClick={() => void mover(u, 1)}
                    >
                      <ArrowDown strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label={`Editar ${u.nombre}`}
                      onClick={() => setEditando(u)}
                    >
                      <Pencil strokeWidth={1.75} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      aria-label={`Borrar ${u.nombre}`}
                      onClick={() => setBorrando(u)}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Modelos"
        description={
          sinUbicacion > 0
            ? `${sinUbicacion} modelo${sinUbicacion === 1 ? "" : "s"} sin ubicación todavía.`
            : "Todos los modelos tienen ubicación."
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_16rem]">
          <Input
            aria-label="Buscar modelo"
            placeholder="Buscar marca, modelo o lugar"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label="Filtrar por lugar"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            options={[{ value: TODAS, label: "Todos los lugares" }, ...opciones]}
          />
        </div>

        {editable && elegidos.length > 0 && (
          <div
            className="bg-surface-2 rounded-control mb-3 flex flex-wrap items-center gap-2 p-3"
            role="region"
            aria-label="Mover modelos elegidos"
          >
            <span className="text-sm font-medium">
              {elegidos.length} elegido{elegidos.length === 1 ? "" : "s"} → mover a
            </span>
            <Select
              aria-label="Lugar de destino"
              className="min-w-48"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="Elegí el lugar"
              options={opciones}
            />
            <Button
              size="sm"
              disabled={!destino}
              loading={guardando === "varios"}
              onClick={() => void asignar(elegidos, destino)}
            >
              Mover
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setElegidos([])}>
              Cancelar
            </Button>
          </div>
        )}

        {visibles.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No hay modelos con ese filtro"
            className="bg-surface py-8"
          />
        ) : (
          <ul className="divide-border flex flex-col divide-y" aria-label="Modelos">
            {editable && (
              <li className="pb-2">
                <Checkbox
                  label={<span className="text-muted text-sm">Elegir todos los de la lista</span>}
                  checked={todosVisiblesElegidos}
                  onChange={(e) =>
                    setElegidos(
                      e.target.checked
                        ? [...new Set([...elegidos, ...visibles.map((p) => p.id)])]
                        : elegidos.filter((id) => !visibles.some((p) => p.id === id)),
                    )
                  }
                />
              </li>
            )}
            {visibles.map((p) => {
              const u = p.ubicacionId ? porId.get(p.ubicacionId) : null;
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="modelo-ubicacion"
                >
                  {editable ? (
                    <Checkbox
                      label={<span className="font-medium">{p.nombre}</span>}
                      checked={elegidos.includes(p.id)}
                      onChange={(e) =>
                        setElegidos((l) =>
                          e.target.checked ? [...l, p.id] : l.filter((x) => x !== p.id),
                        )
                      }
                    />
                  ) : (
                    <span className="font-medium">{p.nombre}</span>
                  )}
                  {editable ? (
                    <Select
                      aria-label={`Ubicación de ${p.nombre}`}
                      className="sm:w-64"
                      value={p.ubicacionId ?? SIN}
                      disabled={guardando === p.id}
                      onChange={(e) => void asignar([p.id], e.target.value)}
                      options={opciones}
                    />
                  ) : u ? (
                    <Badge variant="primary">
                      <MapPin strokeWidth={1.75} aria-hidden /> {u.nombre}
                    </Badge>
                  ) : (
                    <span className="text-subtle text-sm">Sin ubicación</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {editable && (
        <FormUbicacion
          key={editando === "nueva" ? "nueva" : (editando?.id ?? "cerrado")}
          ubicacion={editando === "nueva" ? null : editando}
          abierto={editando !== null}
          onCerrar={() => setEditando(null)}
          onListo={() => {
            setEditando(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={borrando !== null}
        onOpenChange={(o) => !o && setBorrando(null)}
        title={`¿Borrar ${borrando?.nombre ?? ""}?`}
        description={
          borrando?.productos
            ? `Sus ${borrando.productos} modelos quedan sin ubicación (no se borra ningún producto).`
            : "No tiene modelos asignados."
        }
        confirmLabel="Borrar"
        danger
        onConfirm={() => (borrando ? borrar(borrando) : undefined)}
      />
    </>
  );
}

function FormUbicacion({
  ubicacion,
  abierto,
  onCerrar,
  onListo,
}: {
  ubicacion: UbicacionListada | null;
  abierto: boolean;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const toast = useToast();
  const [nombre, setNombre] = useState(ubicacion?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(ubicacion?.descripcion ?? "");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    if (!nombre.trim()) return setError("Poné un nombre (ej.: Estante A · fila 2)");
    setEnviando(true);
    const datos = { nombre, descripcion };
    const r = ubicacion
      ? await actualizarUbicacionAction({ ...datos, id: ubicacion.id })
      : await crearUbicacionAction(datos);
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.nombre?.[0] ?? r.error.message);
      return;
    }
    toast.success(ubicacion ? "Ubicación actualizada" : "Ubicación creada");
    onListo();
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => !o && !enviando && onCerrar()}
      title={ubicacion ? `Editar ${ubicacion.nombre}` : "Nueva ubicación"}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} loading={enviando}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre"
          required
          maxLength={80}
          placeholder="Ej.: Estante A · fila 2"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
        <Input
          label="Aclaración (opcional)"
          maxLength={200}
          placeholder="Ej.: arriba de todo, a la izquierda"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
