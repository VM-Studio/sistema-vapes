"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    <Card>
      <CardHeader>
        <CardTitle>Nombre del negocio</CardTitle>
        <CardDescription>
          Es el nombre de la app instalada, el que aparece en el ingreso y en las exportaciones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={guardar} className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Nombre del negocio"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            maxLength={60}
            required
            className="flex-1"
          />
          <Button type="submit" loading={enviando} disabled={valor.trim() === nombre}>
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
