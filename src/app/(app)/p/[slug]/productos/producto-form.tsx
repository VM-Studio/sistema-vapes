"use client";

import { ChevronDown, Copy, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { get, useFieldArray, useFormContext, useWatch, type UseFormReturn } from "react-hook-form";

import { useRutaPanel } from "@/components/layout/panel-context";
import { useUsuario } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSelect,
  FormSwitch,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import type { ActionError } from "@/lib/action-result";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";
import {
  NOMBRE_VARIANTE_UNICA,
  productoSchema,
  type Producto,
  type ProductoInput,
} from "@/lib/validations/producto";
import type { ProductoDetalle } from "@/server/services/producto.service";

import {
  actualizarProductoAction,
  crearProductoAction,
  generarCodigoInternoAction,
  verificarCodigoAction,
} from "./actions";

type FormProducto = UseFormReturn<ProductoInput, unknown, Producto>;

/** Columnas del editor en desktop (literales: Tailwind las necesita completas). */
function columnasGrilla(tieneVariantes: boolean, verCosto: boolean): string {
  if (tieneVariantes)
    return verCosto
      ? "md:grid-cols-[1.4fr_1fr_1.3fr_0.8fr_0.8fr_0.5fr_auto_auto]"
      : "md:grid-cols-[1.4fr_1fr_1.3fr_0.8fr_0.5fr_auto_auto]";
  return verCosto
    ? "md:grid-cols-[1fr_1.3fr_0.8fr_0.8fr_0.5fr_auto]"
    : "md:grid-cols-[1fr_1.3fr_0.8fr_0.5fr_auto]";
}

const varianteVacia = {
  nombre: "",
  sku: "",
  codigoBarras: "",
  precioCosto: "",
  precioVenta: "",
  stockMinimo: "0",
  activo: true,
};

function valoresIniciales(p: ProductoDetalle | null, codigoInicial?: string): ProductoInput {
  if (!p) {
    return {
      nombre: "",
      descripcion: "",
      categoriaId: "",
      marcaId: "",
      imagenUrl: "",
      activo: true,
      tieneVariantes: true,
      variantes: [{ ...varianteVacia, codigoBarras: codigoInicial ?? "" }],
    };
  }
  return {
    nombre: p.nombre,
    descripcion: p.descripcion ?? "",
    categoriaId: p.categoriaId,
    marcaId: p.marcaId ?? "",
    imagenUrl: p.imagenUrl ?? "",
    activo: p.activo,
    tieneVariantes: p.tieneVariantes,
    variantes: p.variantes.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      sku: v.sku,
      codigoBarras: v.codigoBarras ?? "",
      precioCosto: v.precioCosto === null ? "" : String(Number(v.precioCosto)),
      precioVenta: String(Number(v.precioVenta)),
      stockMinimo: String(v.stockMinimo),
      activo: v.activo,
    })),
  };
}

function useError(name: string): string | undefined {
  const { formState } = useFormContext();
  return (get(formState.errors, name) as { message?: string } | undefined)?.message;
}

/** Input de una celda del editor de variantes: label visible en mobile, oculta en desktop (la da el encabezado). */
function Celda({
  name,
  label,
  className,
  ...props
}: {
  name: string;
  label: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { register } = useFormContext();
  const error = useError(name);
  const id = name.replace(/\./g, "-");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-muted text-xs font-medium md:sr-only">
        {label}
      </label>
      <input
        id={id}
        {...register(name)}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          controlClass,
          "h-11 md:h-10",
          props.inputMode === "decimal" || props.inputMode === "numeric"
            ? "text-right tabular-nums"
            : "",
        )}
      />
      {error && (
        <p id={`${id}-error`} className="text-danger text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Resultado de las verificaciones en vivo: "codigo|varianteId" → mensaje (solo los ocupados). */
type CodigosOcupados = Map<string, string>;
const claveCodigo = (codigo: string, varianteId?: string) =>
  `${codigo.replace(/\s+/g, "").toUpperCase()}|${varianteId ?? ""}`;

/**
 * Código de barras con verificación en vivo contra la DB (debounce 400 ms).
 * El resultado se guarda en `ocupados` y el resolver lo vuelve a aplicar en
 * cada validación: el error no se pierde al salir del campo.
 */
function CeldaCodigo({ index, ocupados }: { index: number; ocupados: CodigosOcupados }) {
  const { control, getValues, trigger, setValue } = useFormContext<ProductoInput>();
  const name = `variantes.${index}.codigoBarras` as const;
  const valor = useWatch({ control, name }) as string | undefined;

  useEffect(() => {
    const codigo = (valor ?? "").trim();
    if (codigo.length < 4) return;
    const varianteId = (getValues(`variantes.${index}.id`) as string | undefined) || undefined;
    const t = setTimeout(async () => {
      const r = await verificarCodigoAction({ codigo, excluirVarianteId: varianteId });
      if (!r.ok) return;
      const clave = claveCodigo(codigo, varianteId);
      if (r.data.disponible) ocupados.delete(clave);
      else ocupados.set(clave, r.data.mensaje);
      void trigger(name);
    }, 400);
    return () => clearTimeout(t);
  }, [valor, index, name, getValues, trigger, ocupados]);

  const toast = useToast();
  const [generando, setGenerando] = useState(false);
  async function generar() {
    setGenerando(true);
    const r = await generarCodigoInternoAction();
    setGenerando(false);
    if (!r.ok) return toast.error("No se pudo generar el código", r.error.message);
    setValue(name, r.data.codigo, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-1 md:col-span-1">
      <Celda
        name={name}
        label="Código de barras"
        placeholder="Escaneá o escribí"
        autoComplete="off"
        spellCheck={false}
      />
      {!(valor ?? "").trim() && (
        <button
          type="button"
          onClick={() => void generar()}
          disabled={generando}
          className="text-primary self-start text-xs font-medium hover:underline disabled:opacity-60"
        >
          {generando ? "Generando…" : "Generar código interno"}
        </button>
      )}
    </div>
  );
}

function EditorVariantes({ form, ocupados }: { form: FormProducto; ocupados: CodigosOcupados }) {
  const { control, register, setFocus, getValues, setValue } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "variantes" });
  const tieneVariantes = useWatch({ control, name: "tieneVariantes" });
  // El costo lo ven y lo cargan solo los dueños.
  const verCosto = esOwner(useUsuario());
  const columnas = columnasGrilla(tieneVariantes, verCosto);
  // Se guardan las filas que el usuario cerró: las nuevas (agregar/duplicar) nacen abiertas.
  const [cerradas, setCerradas] = useState<Set<string>>(() => new Set());
  const errorLista = get(form.formState.errors, "variantes") as
    { message?: string; root?: { message?: string } } | undefined;

  // Sin variantes: una sola fila, llamada "Único" (el nombre no se muestra).
  useEffect(() => {
    if (tieneVariantes) return;
    if (fields.length > 1) remove(fields.map((_, i) => i).slice(1));
    if (getValues("variantes.0.nombre") !== NOMBRE_VARIANTE_UNICA)
      setValue("variantes.0.nombre", NOMBRE_VARIANTE_UNICA);
  }, [tieneVariantes, fields, remove, getValues, setValue]);

  function agregar(desde?: number) {
    const base = desde !== undefined ? getValues(`variantes.${desde}`) : undefined;
    append(
      base
        ? // "Duplicar fila": misma info, cambiás el sabor y el código.
          { ...base, id: undefined, nombre: "", sku: "", codigoBarras: "" }
        : { ...varianteVacia },
    );
    setTimeout(() => setFocus(`variantes.${fields.length}.nombre`), 0);
  }

  const toggle = (id: string) =>
    setCerradas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{tieneVariantes ? `Variantes (${fields.length})` : "Precio y código"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {/* Encabezado de la grilla (solo desktop) */}
        <div
          className={cn(
            "text-muted hidden gap-2 px-1 text-xs font-medium tracking-wide uppercase md:grid",
            columnas,
          )}
          aria-hidden
        >
          {tieneVariantes && <span>Sabor / variante</span>}
          <span>SKU</span>
          <span>Código de barras</span>
          {verCosto && <span className="text-right">Costo</span>}
          <span className="text-right">Venta</span>
          <span className="text-right">Mín.</span>
          <span>Activa</span>
          {tieneVariantes && <span className="w-20" />}
        </div>

        {fields.map((field, i) => {
          const abierta = !cerradas.has(field.id) || !tieneVariantes;
          const nombre = form.getValues(`variantes.${i}.nombre`) as string;
          return (
            <div
              key={field.id}
              className="border-border rounded-xl border p-3 md:rounded-none md:border-0 md:border-t md:px-1 md:py-2 md:first-of-type:border-t-0"
            >
              {tieneVariantes && (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left md:hidden"
                  onClick={() => toggle(field.id)}
                  aria-expanded={abierta}
                >
                  <span className="font-medium">{nombre || `Variante ${i + 1}`}</span>
                  <ChevronDown
                    className={cn(
                      "text-muted size-4 transition-transform",
                      abierta && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
              )}
              <div
                className={cn(
                  "mt-3 grid-cols-2 gap-3 md:mt-0 md:grid md:items-start md:gap-2",
                  abierta ? "grid" : "hidden",
                  columnas,
                )}
              >
                <input type="hidden" {...register(`variantes.${i}.id`)} />
                {tieneVariantes && (
                  <Celda
                    name={`variantes.${i}.nombre`}
                    label="Sabor / variante"
                    placeholder="Ej: Mango Ice"
                    className="col-span-2 md:col-span-1"
                  />
                )}
                <Celda
                  name={`variantes.${i}.sku`}
                  label="SKU"
                  placeholder="Automático"
                  autoComplete="off"
                  spellCheck={false}
                  className="uppercase"
                />
                <CeldaCodigo index={i} ocupados={ocupados} />
                {verCosto && (
                  <Celda
                    name={`variantes.${i}.precioCosto`}
                    label="Costo"
                    inputMode="decimal"
                    placeholder="0"
                  />
                )}
                <Celda
                  name={`variantes.${i}.precioVenta`}
                  label="Venta"
                  inputMode="decimal"
                  placeholder="0"
                />
                <Celda
                  name={`variantes.${i}.stockMinimo`}
                  label="Stock mínimo"
                  inputMode="numeric"
                />
                <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-10 md:justify-center">
                  <input
                    type="checkbox"
                    {...register(`variantes.${i}.activo`)}
                    className="accent-primary size-5"
                  />
                  <span className="md:sr-only">Activa</span>
                </label>
                {tieneVariantes && (
                  <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => agregar(i)}
                      aria-label={`Duplicar variante ${i + 1}`}
                      title="Duplicar fila"
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-danger"
                      onClick={() => remove(i)}
                      disabled={fields.length === 1}
                      aria-label={`Quitar variante ${i + 1}`}
                      title="Quitar"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {(errorLista?.message || errorLista?.root?.message) && (
          <p className="text-danger text-sm" role="alert">
            {errorLista.message ?? errorLista.root?.message}
          </p>
        )}
        {tieneVariantes && (
          <Button variant="secondary" onClick={() => agregar()} className="self-start">
            <Plus /> Agregar variante
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function ProductoForm({
  producto,
  categorias,
  marcas,
  codigoInicial,
  volver,
}: {
  producto: ProductoDetalle | null;
  categorias: { value: string; label: string }[];
  marcas: { value: string; label: string }[];
  /** Código escaneado que no existía: se precarga en la primera variante. */
  codigoInicial?: string;
  /** Ruta a la que volver al guardar (ej: /p/{slug}/escanear), agregando la variante creada. */
  volver?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const ocupados = useRef<CodigosOcupados>(new Map()).current;
  const form = useZodForm(productoSchema, {
    defaultValues: valoresIniciales(producto, codigoInicial),
    erroresExtra: (valores) => {
      const errores: Record<string, string> = {};
      (valores.variantes ?? []).forEach((v, i) => {
        const codigo = typeof v.codigoBarras === "string" ? v.codigoBarras.trim() : "";
        const mensaje = codigo
          ? ocupados.get(claveCodigo(codigo, (v.id as string | undefined) || undefined))
          : undefined;
        if (mensaje) errores[`variantes.${i}.codigoBarras`] = mensaje;
      });
      return errores;
    },
  });
  const cargarStock = useRef(false);
  const esNuevo = producto === null;

  async function onSubmit(datos: Producto) {
    if (esNuevo) {
      const r = await crearProductoAction(datos);
      if (!r.ok) return mostrarError(r.error);
      toast.success("Producto creado");
      if (volver) {
        // Vuelve al escáner con la variante que tiene el código escaneado (o la primera).
        const v =
          r.data.variantes.find((x) => x.codigoBarras === codigoInicial?.toUpperCase()) ??
          r.data.variantes[0];
        router.push(`${volver}${volver.includes("?") ? "&" : "?"}agregar=${v?.id ?? ""}`);
        return;
      }
      router.push(
        cargarStock.current
          ? ruta(
              `/stock/movimientos/ingreso?variantes=${r.data.variantes.map((v) => v.id).join(",")}`,
            )
          : ruta(`/productos/${r.data.id}`),
      );
    } else {
      const r = await actualizarProductoAction({ id: producto.id, datos });
      if (!r.ok) return mostrarError(r.error);
      toast.success("Cambios guardados");
      router.push(ruta(`/productos/${r.data.id}`));
    }
  }

  function mostrarError(error: ActionError) {
    aplicarErroresServidor(form, error);
    if (!error.fields || Object.keys(error.fields).length === 0)
      toast.error("No se pudo guardar", error.message);
  }

  const enviando = form.formState.isSubmitting;

  return (
    <>
      <PageHeader title={esNuevo ? "Nuevo producto" : `Editar ${producto.nombre}`} />
      <Form form={form} onSubmit={onSubmit} className="pb-40 md:pb-0">
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormInput
              name="nombre"
              label="Nombre"
              required
              placeholder="Ej: Ignite V80"
              containerClassName="md:col-span-2"
            />
            <FormSelect
              name="categoriaId"
              label="Categoría"
              required
              options={categorias}
              placeholder="Elegí una categoría"
            />
            <FormSelect
              name="marcaId"
              label="Marca"
              options={[{ value: "", label: "Sin marca" }, ...marcas]}
            />
            <FormTextarea
              name="descripcion"
              label="Descripción"
              rows={2}
              containerClassName="md:col-span-2"
            />
            <FormInput
              name="imagenUrl"
              label="URL de imagen"
              type="url"
              inputMode="url"
              placeholder="https://…"
              containerClassName="md:col-span-2"
            />
            <FormSwitch
              name="tieneVariantes"
              label="Este producto tiene variantes (sabores, colores, etc.)"
            />
            <FormSwitch name="activo" label="Activo" />
          </CardContent>
        </Card>

        <EditorVariantes form={form} ocupados={ocupados} />

        {/* Mobile: grilla de 2 (el botón largo ocupa la fila de arriba). Desktop: en línea a la derecha. */}
        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t px-4 py-3 backdrop-blur md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0">
          {esNuevo && (
            <Button
              type="submit"
              variant="secondary"
              className="col-span-2 md:order-2"
              loading={enviando && cargarStock.current}
              disabled={enviando}
              onClick={() => (cargarStock.current = true)}
            >
              Guardar y cargar stock
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => router.back()}
            disabled={enviando}
            className="md:order-1"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            className="md:order-3"
            loading={enviando && !cargarStock.current}
            disabled={enviando}
            onClick={() => (cargarStock.current = false)}
          >
            Guardar
          </Button>
        </div>
      </Form>
    </>
  );
}
