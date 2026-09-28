"use client";

import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Ícono de la app</CardTitle>
        <CardDescription>
          Imagen cuadrada (idealmente 1024 × 1024, PNG). Se generan todos los tamaños: Android,
          iPhone y la versión «maskable» con margen de seguridad.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/icons/512?v=${version}`}
            alt="Ícono actual"
            className="size-20 rounded-2xl border"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/icons/maskable?v=${version}`}
            alt="Ícono maskable"
            className="size-20 rounded-full border"
          />
        </div>
        <form onSubmit={subir} className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
          <input
            name="icono"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="file:bg-surface-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2"
          />
          <Button type="submit" loading={enviando}>
            <ImageUp /> Usar este ícono
          </Button>
          {propio && (
            <Button variant="secondary" onClick={quitar}>
              Volver al ícono base
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
