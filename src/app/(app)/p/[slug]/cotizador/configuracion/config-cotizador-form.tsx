"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { ConfigCotizacion } from "@/lib/validations/cotizacion";
import type { EscalonDefaultGuardado } from "@/server/services/escalon.service";

import { guardarConfigCotizacionAction, guardarEscalonesDefaultAction } from "../actions";
import { nuevaFila, numeroTipeado, TablaEscalones, type FilaEscalon } from "../tabla-escalones";

export function ConfigCotizadorForm({
  config,
  escalones,
}: {
  config: ConfigCotizacion;
  escalones: EscalonDefaultGuardado[];
}) {
  const ruta = useRutaPanel();
  const router = useRouter();
  const toast = useToast();
  const [validez, setValidez] = useState(String(config.validezDias));
  const [modo, setModo] = useState(config.modoEscalonMayorista);
  const [leyenda, setLeyenda] = useState(config.leyenda);
  const [mostrarStock, setMostrarStock] = useState(config.mostrarStock);
  const [filas, setFilas] = useState<FilaEscalon[]>(() =>
    escalones.map((e) =>
      nuevaFila(String(e.cantidadMinima), String(Number(e.porcentajeDescuento)), e.activo),
    ),
  );
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const [rc, re] = await Promise.all([
      guardarConfigCotizacionAction({
        validezDias: Number(validez),
        modoEscalonMayorista: modo,
        leyenda,
        mostrarStock,
      }),
      guardarEscalonesDefaultAction({
        escalones: filas.map((f) => ({
          cantidadMinima: Number(f.cantidadMinima),
          porcentajeDescuento: numeroTipeado(f.valor),
          activo: f.activo,
        })),
      }),
    ]);
    setGuardando(false);
    const error = !rc.ok ? rc.error : !re.ok ? re.error : null;
    if (error) return toast.error("No se pudo guardar", error.message);
    toast.success("Configuración guardada");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Cotizador", href: ruta("/cotizador") }, { label: "Configuración" }]}
          />
        }
        title="Configuración del cotizador"
        subtitle="Validez, escalones por defecto y lo que muestra el PDF."
        actions={
          <Button
            onClick={() => void guardar()}
            loading={guardando}
            className="max-md:hidden"
          >
            {!guardando && <Save strokeWidth={1.75} />} Guardar
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Escalones por defecto</CardTitle>
            <CardDescription>
              Para productos sin precios mayoristas propios: % de descuento sobre la lista desde
              cierta cantidad (redondeado a $10).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <TablaEscalones
              filas={filas}
              onCambiar={setFilas}
              etiquetaValor="Descuento (%)"
              placeholderValor="10"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cotizaciones</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Input
              label="Validez (días)"
              inputMode="numeric"
              value={validez}
              onChange={(e) => setValidez(e.target.value.replace(/\D/g, ""))}
            />
            <Select
              label="Escalón mayorista"
              options={[
                { value: "POR_PRODUCTO", label: "Por producto (suman sus sabores)" },
                { value: "POR_TOTAL", label: "Por total de unidades de la cotización" },
              ]}
              value={modo}
              onChange={(e) => setModo(e.target.value as ConfigCotizacion["modoEscalonMayorista"])}
            />
            <Textarea
              label="Leyenda del PDF"
              rows={3}
              maxLength={500}
              value={leyenda}
              onChange={(e) => setLeyenda(e.target.value)}
            />
            <Switch
              label="Mostrar el stock en el armado"
              checked={mostrarStock}
              onCheckedChange={setMostrarStock}
            />
          </CardContent>
        </Card>
      </div>
      <BarraAccion soloMobile>
        <Button onClick={() => void guardar()} loading={guardando}>
          {!guardando && <Save strokeWidth={1.75} />} Guardar
        </Button>
      </BarraAccion>
    </>
  );
}
