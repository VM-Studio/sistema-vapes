"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ConfigFinanzas } from "@/lib/validations/finanzas";

import { guardarConfigFinanzasAction } from "../actions";

export function ConfigFinanzasForm({ config }: { config: ConfigFinanzas }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({
    timezone: config.timezone,
    exigirCajaAbierta: config.exigirCajaAbierta,
    toleranciaArqueo: String(config.toleranciaArqueo),
    diasCobertura: String(config.diasCobertura),
    rapida: String(config.rotacion.rapidaHastaDias),
    lenta: String(config.rotacion.lentaDesdeDias),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setGuardando(true);
    const r = await guardarConfigFinanzasAction({
      timezone: v.timezone,
      exigirCajaAbierta: v.exigirCajaAbierta,
      toleranciaArqueo: v.toleranciaArqueo,
      diasCobertura: v.diasCobertura,
      rotacion: { rapidaHastaDias: v.rapida, lentaDesdeDias: v.lenta },
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, m]) => [k, m[0] ?? ""])),
      );
      return toast.error("No se pudo guardar", r.error.message);
    }
    setErrores({});
    toast.success("Configuración guardada");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Caja y reportes"
        subtitle="Cómo se cortan los días, cuándo una caja se revisa y cómo se sugiere reponer."
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Caja</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Switch
              checked={v.exigirCajaAbierta}
              onCheckedChange={(x) => setV((s) => ({ ...s, exigirCajaAbierta: x }))}
              label="Exigir caja abierta para cobrar en efectivo"
              hint="Apagado: se puede cobrar igual y queda como «efectivo fuera de caja» en los reportes."
            />
            <Input
              label="Tolerancia de arqueo ($)"
              inputMode="decimal"
              value={v.toleranciaArqueo}
              onChange={campo("toleranciaArqueo")}
              hint="Si la diferencia al cerrar la supera, se piden observaciones y la caja queda para revisión."
              error={errores.toleranciaArqueo}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Reportes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Input
              label="Zona horaria"
              value={v.timezone}
              onChange={campo("timezone")}
              hint="Define dónde empieza y termina cada día en los reportes."
              error={errores.timezone}
            />
            <Input
              label="Días de cobertura"
              inputMode="numeric"
              value={v.diasCobertura}
              onChange={campo("diasCobertura")}
              hint="Sugerencia de reposición = venta diaria × estos días − stock."
              error={errores.diasCobertura}
            />
            <Input
              label="Rotación rápida: hasta (días de stock)"
              inputMode="numeric"
              value={v.rapida}
              onChange={campo("rapida")}
              error={errores["rotacion.rapidaHastaDias"]}
            />
            <Input
              label="Rotación lenta: más de (días de stock)"
              inputMode="numeric"
              value={v.lenta}
              onChange={campo("lenta")}
              error={errores["rotacion.lentaDesdeDias"]}
            />
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button onClick={guardar} loading={guardando} className="w-full md:w-auto">
            Guardar
          </Button>
        </div>
      </div>
    </>
  );
}
