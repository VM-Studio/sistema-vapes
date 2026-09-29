"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatearIdVenta, slugDesdeNombre } from "@/lib/paneles";
import { cn } from "@/lib/utils";

import { crearPanelAction } from "./actions";
import { LogoTarjeta } from "./logo-tarjeta";

/** Tarjeta punteada "Agregar sistema" y el formulario de alta (solo dueños). */
export function AgregarPanel() {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);

  const slugFinal = slugTocado ? slug : slugDesdeNombre(nombre);

  // La URL local del logo elegido se libera al cambiarlo o al desmontar.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

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
        className="border-input text-muted hover:border-subtle hover:text-foreground flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 rounded-card border border-dashed p-6 transition-colors"
      >
        <Plus className="size-10" strokeWidth={1.25} aria-hidden />
        <span className="text-h3 text-foreground font-semibold">Agregar sistema</span>
        <span className="text-sm">Un sistema nuevo, completo y vacío</span>
      </button>

      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title="Nuevo sistema"
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
          <Field
            id="panel-logo"
            label="Logo"
            hint="Opcional. PNG, JPG o WebP hasta 5 MB. Sin logo se muestra el nombre."
            error={errores.logo?.[0]}
          >
            <input
              id="panel-logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                setPreview(archivo ? URL.createObjectURL(archivo) : null);
              }}
              className={cn(
                controlClass,
                "file:bg-surface-2 py-2 text-sm file:mr-3 file:rounded-inner file:border-0 file:px-3 file:py-1.5",
              )}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <p className="text-small text-muted font-medium">Así se va a ver</p>
            <div className="bg-surface-3/60 flex flex-col gap-4 rounded-card p-4">
              <LogoTarjeta nombre={nombre} logoUrl={preview} />
              <p className="text-h2 truncate px-1 font-semibold">{nombre || "Nuevo sistema"}</p>
            </div>
          </div>
          <Button type="submit" size="lg" loading={enviando} className="mt-2">
            Crear sistema
          </Button>
        </form>
      </Sheet>
    </>
  );
}
