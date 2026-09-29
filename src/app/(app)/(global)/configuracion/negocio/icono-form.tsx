"use client";

import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";

import { quitarIconoAction, subirIconoAction } from "./actions";

export function IconoForm({ propio }: { propio: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const [version, setVersion] = useState(0);

  async function subir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const r = await subirIconoAction(new FormData(e.currentTarget));
    setEnviando(false);
    if (!r.ok)
      return toast.error(
        "No se pudo usar esa imagen",
        r.error.fields?.icono?.[0] ?? r.error.message,
      );
    toast.success("Ícono actualizado", "Los celulares lo toman al reinstalar o actualizar la app.");
    setVersion((v) => v + 1);
    router.refresh();
  }

  async function quitar() {
    const r = await quitarIconoAction();
    if (!r.ok) return toast.error("No se pudo", r.error.message);
    setVersion((v) => v + 1);
    router.refresh();
  }

  return (
    <SectionCard
      title="Ícono de la app"
      description="Imagen cuadrada (idealmente 1024 × 1024, PNG). Se generan todos los tamaños: Android, iPhone y la versión «maskable» con margen de seguridad."
      contentClassName="flex flex-col gap-5"
    >
      <div className="flex gap-4">
        <figure className="flex flex-col items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/icons/512?v=${version}`}
            alt="Ícono actual"
            className="border-border bg-surface rounded-card size-20 border"
          />
          <figcaption className="text-muted text-small">Actual</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/icons/maskable?v=${version}`}
            alt="Ícono maskable"
            className="border-border bg-surface rounded-circle size-20 border"
          />
          <figcaption className="text-muted text-small">Maskable</figcaption>
        </figure>
      </div>
      <form onSubmit={subir} className="flex flex-col gap-3">
        <input
          name="icono"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          required
          aria-label="Imagen del ícono"
          className="border-input bg-surface text-small file:bg-surface-3 file:text-foreground rounded-control file:rounded-inner w-full border p-1.5 file:mr-3 file:h-8 file:border-0 file:px-3 file:font-medium"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {propio && (
            <Button variant="secondary" onClick={quitar}>
              Volver al ícono base
            </Button>
          )}
          <Button type="submit" loading={enviando}>
            <ImageUp strokeWidth={1.75} /> Usar este ícono
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
