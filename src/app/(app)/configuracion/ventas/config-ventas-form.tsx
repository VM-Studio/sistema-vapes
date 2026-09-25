"use client";

import { TipoComprobante } from "@prisma/client";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ConfigVentas } from "@/lib/validations/venta";

import { guardarConfigVentasAction } from "../actions";

const TIPOS: Record<TipoComprobante, string> = {
  TICKET: "Ticket (no válido como factura)",
  PRESUPUESTO: "Presupuesto",
  FACTURA_A: "Factura A (requiere AFIP: próximamente)",
  FACTURA_B: "Factura B (requiere AFIP: próximamente)",
  FACTURA_C: "Factura C (requiere AFIP: próximamente)",
};

export function ConfigVentasForm({ config }: { config: ConfigVentas }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({
    ...config,
    puntoVenta: String(config.puntoVenta),
    redondeoVentas: String(config.redondeoVentas),
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const campo =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setGuardando(true);
    const r = await guardarConfigVentasAction({
      ...v,
      puntoVenta: Number(v.puntoVenta),
      redondeoVentas: Number(v.redondeoVentas),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, m]) => [k, m[0] ?? ""])),
      );
      return toast.error("No se pudo guardar", r.error.message);
    }
    setErrores({});
    toast.success("Configuración de ventas guardada");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Ventas y comprobante"
        subtitle="Lo que se imprime en el ticket y cómo se cobra."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos del negocio</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              label="Nombre"
              value={v.nombreNegocio}
              onChange={campo("nombreNegocio")}
              error={errores.nombreNegocio}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="CUIT" value={v.cuit} onChange={campo("cuit")} error={errores.cuit} />
              <Input
                label="Teléfono"
                value={v.telefono}
                onChange={campo("telefono")}
                error={errores.telefono}
              />
            </div>
            <Input
              label="Dirección"
              value={v.direccion}
              onChange={campo("direccion")}
              error={errores.direccion}
            />
            <Input
              label="Logo (URL https, PNG o JPG)"
              value={v.logoUrl}
              onChange={campo("logoUrl")}
              error={errores.logoUrl}
              placeholder="https://…"
            />
            <Input
              label="Leyenda al pie"
              value={v.leyenda}
              onChange={campo("leyenda")}
              error={errores.leyenda}
              hint="Ej: «Documento no válido como factura»."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Comprobante y cobro</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Switch
              label="Emitir el comprobante automáticamente al confirmar"
              checked={v.emitirComprobanteAutomatico}
              onCheckedChange={(on) => setV((x) => ({ ...x, emitirComprobanteAutomatico: on }))}
            />
            <Select
              label="Tipo de comprobante"
              options={Object.values(TipoComprobante).map((t) => ({
                value: t,
                label: TIPOS[t],
                disabled: t.startsWith("FACTURA"),
              }))}
              value={v.tipoComprobanteDefault}
              onChange={campo("tipoComprobanteDefault")}
            />
            <Input
              label="Punto de venta"
              inputMode="numeric"
              value={v.puntoVenta}
              onChange={(e) =>
                setV((x) => ({ ...x, puntoVenta: e.target.value.replace(/\D/g, "") }))
              }
              error={errores.puntoVenta}
              hint="La numeración es propia de cada tipo y punto de venta."
            />
            <Select
              label="Redondeo del total"
              options={[
                { value: "0", label: "Sin redondeo" },
                { value: "10", label: "A $10" },
                { value: "50", label: "A $50" },
                { value: "100", label: "A $100" },
              ]}
              value={v.redondeoVentas}
              onChange={campo("redondeoVentas")}
              hint="Siempre hacia abajo: la diferencia es a favor del cliente. Se puede desactivar en cada venta."
            />
            <p className="bg-surface-2 flex gap-2 rounded-lg p-3 text-sm">
              <Info className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong>El sistema no permite vender sin stock.</strong> La base de datos rechaza
                cualquier movimiento que deje el stock en negativo; si falta mercadería, cargá un
                ingreso o una transferencia antes de vender.
              </span>
            </p>
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
