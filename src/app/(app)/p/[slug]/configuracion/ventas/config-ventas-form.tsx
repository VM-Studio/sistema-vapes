"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ConfigCatalogo } from "@/lib/validations/config-panel";
import type { ConfigVentas } from "@/lib/validations/venta";

import { guardarConfigCatalogoAction, guardarConfigVentasAction } from "../actions";

const campos = (fields: Record<string, string[]> | undefined) =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, m]) => [k, m[0] ?? ""]));

export function ConfigVentasForm({
  ventas,
  catalogo,
}: {
  ventas: ConfigVentas;
  catalogo: ConfigCatalogo;
}) {
  const router = useRouter();
  const toast = useToast();
  const panel = usePanel();
  const [redondeo, setRedondeo] = useState(String(ventas.redondeoVentas));
  const [prefijoSku, setPrefijoSku] = useState(catalogo.prefijoSku);
  const [alertaStockMinimo, setAlerta] = useState(catalogo.alertaStockMinimo);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const [rv, rc] = await Promise.all([
      guardarConfigVentasAction({ redondeoVentas: Number(redondeo) }),
      guardarConfigCatalogoAction({ prefijoSku, alertaStockMinimo }),
    ]);
    setGuardando(false);
    const error = !rv.ok ? rv.error : !rc.ok ? rc.error : null;
    if (error) {
      setErrores({
        ...(!rv.ok ? campos(rv.error.fields) : {}),
        ...(!rc.ok ? campos(rc.error.fields) : {}),
      });
      return toast.error("No se pudo guardar", error.message);
    }
    setErrores({});
    toast.success("Ajustes guardados", panel.nombre);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Ventas y catálogo"
        subtitle={`Cómo cobra y cómo codifica sus productos ${panel.nombre}.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cobro</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select
              label="Redondeo del total"
              options={[
                { value: "0", label: "Sin redondeo" },
                { value: "10", label: "A $10" },
                { value: "50", label: "A $50" },
                { value: "100", label: "A $100" },
              ]}
              value={redondeo}
              onChange={(e) => setRedondeo(e.target.value)}
              error={errores.redondeoVentas}
              hint="Siempre hacia abajo: la diferencia es a favor del cliente. Se puede desactivar en cada venta."
            />
            <p className="bg-surface-2 flex gap-2 rounded-control p-3 text-sm">
              <Info
                className="text-primary mt-0.5 size-4 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                <strong>El sistema no permite vender sin stock.</strong> Si falta mercadería, cargá
                un ingreso o una transferencia antes de vender.
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catálogo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              label="Prefijo de SKU y códigos internos"
              value={prefijoSku}
              onChange={(e) => setPrefijoSku(e.target.value.toUpperCase())}
              error={errores.prefijoSku}
              hint="Entre 2 y 6 letras o números. Solo afecta a los productos nuevos."
              autoComplete="off"
            />
            <Switch
              label="Avisar cuando un producto queda por debajo del stock mínimo"
              checked={alertaStockMinimo}
              onCheckedChange={setAlerta}
            />
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => void guardar()} loading={guardando}>
          Guardar
        </Button>
      </div>
    </>
  );
}
