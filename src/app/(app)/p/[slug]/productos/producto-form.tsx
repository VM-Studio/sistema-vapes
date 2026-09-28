"use client";

import { CircleCheck, Copy, Plus, ScanBarcode, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { get, useFieldArray, useFormContext, useWatch, type UseFormReturn } from "react-hook-form";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import {
  aplicarErroresServidor,
  Form,
  FormInput,
  FormSelect,
  FormSwitch,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import type { ActionError } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { productoSchema, type Producto, type ProductoInput } from "@/lib/validations/producto";
import type { ProductoDetalle } from "@/server/services/producto.service";

import {
  actualizarProductoAction,
  crearProductoAction,
  generarCodigoInternoAction,
  verificarCodigoAction,
} from "./actions";

type FormProducto = UseFormReturn<ProductoInput, unknown, Producto>;

const saborVacio = {
  sabor: "",
  codigoBarras: "",
  precioVenta: "",
  stockMinimo: "0",
  activo: true,
};

const aTextoMonto = (m: string | null) => (m === null ? "" : String(Number(m)));

function valoresIniciales(p: ProductoDetalle | null): ProductoInput {
  if (!p) {
    return {
      marca: "",
      modelo: "",
      especificacion: "",
      categoriaId: "",
      precioVenta: "",
      imagenUrl: "",
      activo: true,
      sabores: [{ ...saborVacio }],
    };
  }
  return {
    marca: p.marca,
    modelo: p.modelo,
    especificacion: p.especificacion,
    categoriaId: p.categoriaId ?? "",
    precioVenta: aTextoMonto(p.precioVenta),
    imagenUrl: p.imagenUrl ?? "",
    activo: p.activo,
    sabores: p.sabores.map((s) => ({
      id: s.id,
      sabor: s.sabor ?? "",
      codigoBarras: s.codigoBarras ?? "",
      precioVenta: aTextoMonto(s.precioPropio),
      stockMinimo: String(s.stockMinimo),
      activo: s.activo,
    })),
  };
}

function useError(name: string): string | undefined {
  const { formState } = useFormContext();
  return (get(formState.errors, name) as { message?: string } | undefined)?.message;
}

/** Input de una celda de la grilla de sabores: label visible en mobile, oculta en desktop. */
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
          "h-12 md:h-10",
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

/** Verificaciones en vivo: "codigo|varianteId" → mensaje (solo los ocupados). */
type CodigosOcupados = Map<string, string>;
const claveCodigo = (codigo: string, varianteId?: string) =>
  `${codigo.replace(/\s+/g, "").toUpperCase()}|${varianteId ?? ""}`;

/** Código de barras con verificación en vivo (debounce 400 ms) y "Generar código interno". */
function CeldaCodigo({ index, ocupados }: { index: number; ocupados: CodigosOcupados }) {
  const { control, getValues, trigger, setValue } = useFormContext<ProductoInput>();
  const name = `sabores.${index}.codigoBarras` as const;
  const valor = useWatch({ control, name }) as string | undefined;
  const toast = useToast();
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    const codigo = (valor ?? "").trim();
    if (codigo.length < 4) return;
    const varianteId = (getValues(`sabores.${index}.id`) as string | undefined) || undefined;
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

  async function generar() {
    setGenerando(true);
    const r = await generarCodigoInternoAction();
    setGenerando(false);
    if (!r.ok) return toast.error("No se pudo generar el código", r.error.message);
    setValue(name, r.data.codigo, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
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

const COLUMNAS = "md:grid-cols-[1.3fr_1.4fr_0.9fr_0.6fr_auto_auto]";

function EditorSabores({ form, ocupados }: { form: FormProducto; ocupados: CodigosOcupados }) {
  const { control, register, setFocus, getValues } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "sabores" });
  const precioProducto = useWatch({ control, name: "precioVenta" }) as string | undefined;
  const errorLista = get(form.formState.errors, "sabores") as
    { message?: string; root?: { message?: string } } | undefined;

  function agregar(desde?: number) {
    const base = desde !== undefined ? getValues(`sabores.${desde}`) : undefined;
    append(
      base
        ? // "Duplicar fila": mismo precio y mínimo; cambiás el sabor y el código.
          { ...base, id: undefined, sabor: "", codigoBarras: "" }
        : { ...saborVacio },
    );
    setTimeout(() => setFocus(`sabores.${fields.length}.sabor`), 0);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sabores ({fields.length})</CardTitle>
        <p className="text-muted text-sm">
          Si el producto no tiene sabores, dejá una sola fila con el sabor vacío. El precio de un
          sabor solo va si es distinto al del producto.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div
          className={cn(
            "text-muted hidden gap-2 px-1 text-xs font-medium tracking-wide uppercase md:grid",
            COLUMNAS,
          )}
          aria-hidden
        >
          <span>Sabor</span>
          <span>Código de barras</span>
          <span className="text-right">Precio propio</span>
          <span className="text-right">Mín.</span>
          <span>Activo</span>
          <span className="w-24" />
        </div>
        {fields.map((field, i) => (
          <div
            key={field.id}
            data-testid="fila-sabor-form"
            className={cn(
              "border-border grid grid-cols-2 gap-3 rounded-2xl border p-3 md:items-start md:gap-2 md:rounded-none md:border-0 md:border-t md:px-1 md:py-2 md:first-of-type:border-t-0",
              COLUMNAS,
            )}
          >
            <input type="hidden" {...register(`sabores.${i}.id`)} />
            <Celda
              name={`sabores.${i}.sabor`}
              label="Sabor"
              placeholder={fields.length === 1 ? "Ej: Mango (o vacío)" : "Ej: Mango"}
              className="col-span-2 md:col-span-1"
              autoComplete="off"
            />
            <CeldaCodigo index={i} ocupados={ocupados} />
            <Celda
              name={`sabores.${i}.precioVenta`}
              label="Precio propio"
              inputMode="decimal"
              placeholder={precioProducto ? String(precioProducto) : "Del producto"}
            />
            <Celda name={`sabores.${i}.stockMinimo`} label="Stock mínimo" inputMode="numeric" />
            <label className="flex min-h-12 items-center gap-2 text-sm md:min-h-10 md:justify-center">
              <input
                type="checkbox"
                {...register(`sabores.${i}.activo`)}
                className="accent-primary size-5"
              />
              <span className="md:sr-only">Activo</span>
            </label>
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => agregar(i)}
                aria-label={`Duplicar fila ${i + 1}`}
                title="Duplicar fila"
              >
                <Copy strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-danger"
                onClick={() => remove(i)}
                disabled={fields.length === 1}
                aria-label={`Quitar fila ${i + 1}`}
                title="Quitar"
              >
                <Trash2 strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        ))}
        {(errorLista?.message || errorLista?.root?.message) && (
          <p className="text-danger text-sm" role="alert">
            {errorLista.message ?? errorLista.root?.message}
          </p>
        )}
        <Button variant="secondary" onClick={() => agregar()} className="self-start">
          <Plus strokeWidth={1.75} /> Agregar sabor
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProductoForm({
  producto,
  categorias,
  marcas,
}: {
  producto: ProductoDetalle | null;
  categorias: { value: string; label: string }[];
  marcas: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const panel = usePanel();
  const idMarcas = useId();
  const ocupados = useRef<CodigosOcupados>(new Map()).current;
  const [creado, setCreado] = useState<{ id: string; nombre: string } | null>(null);
  const form = useZodForm(productoSchema, {
    defaultValues: valoresIniciales(producto),
    erroresExtra: (valores) => {
      const errores: Record<string, string> = {};
      (valores.sabores ?? []).forEach((s, i) => {
        const codigo = typeof s.codigoBarras === "string" ? s.codigoBarras.trim() : "";
        const mensaje = codigo
          ? ocupados.get(claveCodigo(codigo, (s.id as string | undefined) || undefined))
          : undefined;
        if (mensaje) errores[`sabores.${i}.codigoBarras`] = mensaje;
      });
      return errores;
    },
  });
  const esNuevo = producto === null;

  async function onSubmit(datos: Producto) {
    if (esNuevo) {
      const r = await crearProductoAction(datos);
      if (!r.ok) return mostrarError(r.error);
      toast.success("Producto creado");
      setCreado({
        id: r.data.id,
        nombre: [datos.marca, datos.modelo, datos.especificacion].filter(Boolean).join(" "),
      });
      window.scrollTo({ top: 0 });
      return;
    }
    const r = await actualizarProductoAction({ id: producto.id, datos });
    if (!r.ok) return mostrarError(r.error);
    toast.success("Cambios guardados");
    router.push(ruta(`/productos/${r.data.id}`));
  }

  function mostrarError(error: ActionError) {
    aplicarErroresServidor(form, error);
    if (!error.fields || Object.keys(error.fields).length === 0)
      toast.error("No se pudo guardar", error.message);
  }

  if (creado) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-8 text-center">
        <span className="bg-success-soft text-success-soft-foreground flex size-14 items-center justify-center rounded-full">
          <CircleCheck className="size-7" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{creado.nombre} creado</h1>
        <p className="text-muted text-sm">
          ¿Ya tenés unidades? Cargalas escaneándolas en el galpón.
        </p>
        <Link
          href={ruta(`/productos/cargar?producto=${creado.id}`)}
          className={buttonVariants({ size: "lg", fullWidth: true })}
        >
          <ScanBarcode strokeWidth={1.75} /> Cargar stock de este producto
        </Link>
        <div className="grid w-full grid-cols-2 gap-2">
          <Link
            href={ruta(`/productos/${creado.id}`)}
            className={buttonVariants({ variant: "secondary" })}
          >
            Ver producto
          </Link>
          <Button
            variant="secondary"
            onClick={() => {
              form.reset(valoresIniciales(null));
              setCreado(null);
            }}
          >
            Crear otro
          </Button>
        </div>
      </div>
    );
  }

  const enviando = form.formState.isSubmitting;

  return (
    <>
      <PageHeader title={esNuevo ? "Nuevo producto" : `Editar ${producto.nombreCompleto}`} />
      <Form form={form} onSubmit={onSubmit} className="pb-40 md:pb-0">
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FormInput
              name="marca"
              label="Marca"
              required
              list={idMarcas}
              placeholder="Ej: Elf Bar"
              autoComplete="off"
              hint="Si no existe, se crea."
            />
            <datalist id={idMarcas}>
              {marcas.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <FormInput
              name="modelo"
              label="Modelo"
              required
              placeholder="Ej: BC"
              autoComplete="off"
            />
            <FormInput
              name="especificacion"
              label={panel.etiquetaEspecificacion || "Especificación"}
              placeholder="Ej: 5000"
              autoComplete="off"
            />
            <FormInput
              name="precioVenta"
              label="Precio de venta"
              required
              inputMode="decimal"
              placeholder="Ej: 10000"
              hint="Para todos los sabores (salvo los que tengan precio propio)."
            />
            <FormSelect
              name="categoriaId"
              label="Categoría"
              options={[{ value: "", label: "Sin categoría" }, ...categorias]}
            />
            <FormInput
              name="imagenUrl"
              label="URL de imagen"
              type="url"
              inputMode="url"
              placeholder="https://…"
            />
            <FormSwitch name="activo" label="Activo" />
          </CardContent>
        </Card>

        <EditorSabores form={form} ocupados={ocupados} />

        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t px-4 py-3 backdrop-blur md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0">
          <Button variant="secondary" onClick={() => router.back()} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" loading={enviando}>
            Guardar
          </Button>
        </div>
      </Form>
    </>
  );
}
