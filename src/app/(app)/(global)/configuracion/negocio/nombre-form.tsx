"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { useToast } from "@/components/ui/toast";

import { guardarNombreNegocioAction } from "./actions";

export function NombreForm({ nombre }: { nombre: string }) {
  const router = useRouter();
  const toast = useToast();
  const [valor, setValor] = useState(nombre);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await guardarNombreNegocioAction(valor);
    setEnviando(false);
    if (!r.ok)
      return toast.error("No se pudo guardar", r.error.fields?._form?.[0] ?? r.error.message);
    toast.success("Nombre guardado");
    router.refresh();
  }

  return (
    <SectionCard
      title="Nombre del negocio"
      description="Es el nombre de la app instalada, el que aparece en el ingreso y en las exportaciones."
    >
      <form onSubmit={guardar} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          aria-label="Nombre del negocio"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          maxLength={60}
          required
          containerClassName="flex-1"
        />
        <Button type="submit" loading={enviando} disabled={valor.trim() === nombre}>
          Guardar
        </Button>
      </form>
    </SectionCard>
  );
}
