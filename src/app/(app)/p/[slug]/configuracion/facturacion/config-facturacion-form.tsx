"use client";

import { CondicionIva } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePanel } from "@/components/layout/panel-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  CONDICION_IVA_LABEL,
  formatearCuit,
  type ConfigFacturacion,
} from "@/lib/validations/factura";

import { guardarConfigFacturacionAction } from "../actions";

/** Facturación del panel (dueños): activarla y los datos fiscales del negocio. */
export function ConfigFacturacionForm({ config }: { config: ConfigFacturacion }) {
  const router = useRouter();
  const toast = useToast();
  const panel = usePanel();
  const [habilitada, setHabilitada] = useState(config.habilitada);
  const [razonSocial, setRazonSocial] = useState(config.razonSocial ?? "");
  const [cuit, setCuit] = useState(config.cuit ? formatearCuit(config.cuit) : "");
  const [condicionIva, setCondicionIva] = useState<string>(config.condicionIva ?? "");
  const [domicilio, setDomicilio] = useState(config.domicilio ?? "");
  const [puntoVenta, setPuntoVenta] = useState(String(config.puntoVenta));
  const [alicuota, setAlicuota] = useState(String(config.alicuotaIva));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await guardarConfigFacturacionAction({
      habilitada,
      razonSocial,
      cuit,
      condicionIva,
      domicilio,
      puntoVenta: Number(puntoVenta),
      alicuotaIva: Number(alicuota),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, m]) => [k, m[0] ?? ""])),
      );
      return toast.error("No se pudo guardar", r.error.message);
    }
    setErrores({});
    toast.success("Facturación guardada", panel.nombre);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Facturación"
        subtitle={`Si ${panel.nombre} registra facturas y los datos fiscales que van en cada comprobante.`}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SectionCard title="Módulo Facturas" contentClassName="flex flex-col gap-4">
          <Switch
            label="Registrar facturas en este panel"
            hint="Muestra Facturas en el menú y «Facturar» en el detalle de cada venta. Las facturas A, B y C se emiten por fuera (AFIP) y acá se registran con su número; el comprobante interno lo genera el sistema."
            checked={habilitada}
            onCheckedChange={setHabilitada}
          />
        </SectionCard>
        <SectionCard
          title="Datos fiscales del negocio"
          contentClassName="grid gap-4 md:grid-cols-2"
        >
          <Input
            label="Razón social"
            value={razonSocial}
            onChange={(e) => setRazonSocial(e.target.value)}
            error={errores.razonSocial}
            containerClassName="md:col-span-2"
          />
          <Input
            label="CUIT"
            placeholder="30-12345678-1"
            inputMode="numeric"
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            error={errores.cuit}
          />
          <Select
            label="Condición frente al IVA"
            options={[
              { value: "", label: "Sin especificar" },
              ...Object.values(CondicionIva)
                .filter((c) => c !== "CONSUMIDOR_FINAL")
                .map((c) => ({ value: c, label: CONDICION_IVA_LABEL[c] })),
            ]}
            value={condicionIva}
            onChange={(e) => setCondicionIva(e.target.value)}
            hint="Responsable inscripto emite A y B; monotributo o exento, C."
          />
          <Input
            label="Domicilio comercial"
            value={domicilio}
            onChange={(e) => setDomicilio(e.target.value)}
            containerClassName="md:col-span-2"
          />
          <Input
            label="Punto de venta"
            inputMode="numeric"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            error={errores.puntoVenta}
          />
          <Select
            label="Alícuota de IVA (factura A)"
            options={["21", "10.5", "27", "0"].map((v) => ({
              value: v,
              label: `${v.replace(".", ",")}%`,
            }))}
            value={alicuota}
            onChange={(e) => setAlicuota(e.target.value)}
          />
        </SectionCard>
      </div>
      <div className="mt-4 flex justify-end">
        <BarraAccion>
          <Button onClick={() => void guardar()} loading={guardando}>
            Guardar
          </Button>
        </BarraAccion>
      </div>
    </>
  );
}
