"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Link
        href={ruta("/cotizador")}
        className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-2 -ml-2" })}
      >
        <ArrowLeft strokeWidth={1.75} /> Cotizaciones
      </Link>
      <PageHeader
        title="Configuración del cotizador"
        subtitle="Validez, escalones por defecto y lo que muestra el PDF."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Escalones por defecto</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              Para productos sin precios mayoristas propios: % de descuento sobre la lista desde
              cierta cantidad (redondeado a $10).
            </p>
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
          <CardContent className="flex flex-col gap-3">
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
      <div className="mt-4 flex justify-end">
        <Button onClick={() => void guardar()} loading={guardando}>
          Guardar
        </Button>
      </div>
    </>
  );
}
