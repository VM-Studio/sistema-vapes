"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatearIdVenta, inicialesPanel, slugDesdeNombre } from "@/lib/paneles";
import { cn } from "@/lib/utils";

import { crearPanelAction } from "./actions";

/** Card punteada "+ Agregar panel" y el formulario de alta (solo dueños). */
export function AgregarPanel() {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [color, setColor] = useState("#111113");
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);

  const slugFinal = slugTocado ? slug : slugDesdeNombre(nombre);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const datos = new FormData(e.currentTarget);
    datos.set("slug", slugFinal);
    const r = await crearPanelAction(datos);
    setEnviando(false);
    if (!r.ok) {
      setErrores(r.error.fields ?? {});
      return toast.error("No se pudo crear el panel", r.error.message);
    }
    toast.success("Panel creado", "Ya tiene su depósito «Principal» y está listo para usar.");
    setAbierto(false);
    router.push(`/p/${r.data.slug}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border-border text-muted hover:border-foreground/30 hover:text-foreground flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 transition-colors"
      >
        <span className="bg-surface-2 flex size-14 items-center justify-center rounded-2xl">
          <Plus className="size-7" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-base font-semibold">Agregar panel</span>
        <span className="text-sm">Un sistema nuevo, completo y vacío</span>
      </button>

      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title="Nuevo panel"
        description="Tiene sus propios productos, stock, ventas, clientes y proveedores."
      >
        <form id="form-panel" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
          <Field id="panel-nombre" label="Nombre" required error={errores.nombre?.[0]}>
            <Input
              id="panel-nombre"
              name="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={40}
              required
              autoFocus
            />
          </Field>
          <Field
            id="panel-slug"
            label="Dirección"
            hint={
              slugFinal
                ? `/p/${slugFinal} · IDs de venta: ${formatearIdVenta(slugFinal, 1)}`
                : "Se completa sola con el nombre"
            }
            error={errores.slug?.[0]}
          >
            <Input
              id="panel-slug"
              value={slugFinal}
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value.toLowerCase());
              }}
              maxLength={40}
              inputMode="url"
            />
          </Field>
          <Field
            id="panel-etiqueta"
            label="Atributo principal de los productos"
            hint="Cómo se llama en este panel: «Pitadas», «Contenido», «Detalle»…"
            required
            error={errores.etiquetaEspecificacion?.[0]}
          >
            <Input id="panel-etiqueta" name="etiquetaEspecificacion" maxLength={30} required />
          </Field>
          <Field id="panel-color" label="Color de acento" error={errores.colorAcento?.[0]}>
            <div className="flex items-center gap-3">
              <input
                id="panel-color"
                name="colorAcento"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="border-border h-12 w-16 cursor-pointer rounded-xl border bg-transparent p-1"
              />
              <span className="text-muted font-mono text-sm">{color}</span>
            </div>
          </Field>
          <Field
            id="panel-logo"
            label="Logo"
            hint="Opcional. PNG, JPG o WebP hasta 5 MB. Sin logo se usan las iniciales."
            error={errores.logo?.[0]}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                style={{ background: color }}
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
              >
                {inicialesPanel(nombre || "?")}
              </span>
              <input
                id="panel-logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={cn(
                  controlClass,
                  "file:bg-surface-2 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5",
                )}
              />
            </div>
          </Field>
          <Button type="submit" size="lg" loading={enviando} className="mt-2">
            Crear panel
          </Button>
        </form>
      </Sheet>
    </>
  );
}
