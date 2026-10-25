"use client";

import type { MedioPago } from "@prisma/client";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePanel } from "@/components/layout/panel-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { TODOS_LOS_MEDIOS } from "@/lib/medios-pago";
import type { ConfigCatalogo, ConfigCompras } from "@/lib/validations/config-panel";
import type { ConfigVentas } from "@/lib/validations/venta";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

import { ICONO_MEDIO_PAGO } from "../../ventas/_componentes/medio-pago";
import {
  guardarConfigCatalogoAction,
  guardarConfigComprasAction,
  guardarConfigVentasAction,
} from "../actions";

const campos = (fields: Record<string, string[]> | undefined) =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, m]) => [k, m[0] ?? ""]));

export function ConfigVentasForm({
  ventas,
  catalogo,
  compras,
}: {
  ventas: ConfigVentas;
  catalogo: ConfigCatalogo;
  compras: ConfigCompras;
}) {
  const router = useRouter();
  const toast = useToast();
  const panel = usePanel();
  const [redondeo, setRedondeo] = useState(String(ventas.redondeoVentas));
  const [medios, setMedios] = useState<MedioPago[]>([...ventas.mediosPago]);
  const [prefijoSku, setPrefijoSku] = useState(catalogo.prefijoSku);
  const [alertaStockMinimo, setAlerta] = useState(catalogo.alertaStockMinimo);
  const [comisionPasista, setComisionPasista] = useState(
    String(compras.comisionPasistaPorcentajeDefault).replace(".", ","),
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const [rv, rc, rp] = await Promise.all([
      guardarConfigVentasAction({
        redondeoVentas: Number(redondeo),
        mediosPago: medios,
      }),
      guardarConfigCatalogoAction({ prefijoSku, alertaStockMinimo }),
      guardarConfigComprasAction({
        comisionPasistaPorcentajeDefault: comisionPasista.replace(",", "."),
      }),
    ]);
    setGuardando(false);
    const error = !rv.ok ? rv.error : !rc.ok ? rc.error : !rp.ok ? rp.error : null;
    if (error) {
      setErrores({
        ...(!rv.ok ? campos(rv.error.fields) : {}),
        ...(!rc.ok ? campos(rc.error.fields) : {}),
        ...(!rp.ok ? campos(rp.error.fields) : {}),
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
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SectionCard
          title="Cobro"
          description="Cómo se calcula el total de cada venta."
          contentClassName="flex flex-col gap-4"
        >
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
          <p className="border-border bg-surface text-small rounded-control flex gap-2.5 border p-3">
            <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>
              <strong>El sistema no permite vender sin stock.</strong> Si falta mercadería, cargá un
              ingreso o una transferencia antes de vender.
            </span>
          </p>
        </SectionCard>
        <SectionCard
          title="Medios de pago"
          description="Los que se ofrecen al vender, al cobrar un fiado y en las devoluciones, en este orden."
          contentClassName="flex flex-col gap-4"
        >
          <MediosPago medios={medios} onCambiar={setMedios} error={errores.mediosPago} />
          {medios.includes("MERCADO_LIBRE") && (
            <p
              className="border-border bg-surface text-small rounded-control flex gap-2.5 border p-3"
              data-testid="aviso-precio-ml"
            >
              <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>
                En una venta cobrada por Mercado Libre se carga a mano el precio de cada producto.
                Su factura (ARCA) se marca como cargada en Facturas → Ventas Mercado Libre.
              </span>
            </p>
          )}
        </SectionCard>
        <SectionCard
          title="Catálogo"
          description="Códigos internos y alertas de stock."
          contentClassName="flex flex-col gap-4"
        >
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
        </SectionCard>
        <SectionCard
          title="Compras"
          description="Lo que propone cada compra nueva."
          contentClassName="flex flex-col gap-4"
        >
          <Input
            label="Comisión del pasista (%)"
            inputMode="decimal"
            value={comisionPasista}
            onChange={(e) => setComisionPasista(e.target.value.replace(/[^\d.,]/g, ""))}
            error={errores.comisionPasistaPorcentajeDefault}
            hint="El porcentaje que aparece al tildar la comisión en una compra (se puede cambiar en cada una)."
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

/**
 * Medios de pago del panel: tildar habilita, las flechas cambian el orden de
 * los botones de «¿Cómo paga?». Al menos uno queda habilitado.
 */
function MediosPago({
  medios,
  onCambiar,
  error,
}: {
  medios: MedioPago[];
  onCambiar: (m: MedioPago[]) => void;
  error?: string;
}) {
  const filas = [...medios, ...TODOS_LOS_MEDIOS.filter((m) => !medios.includes(m))];
  const mover = (m: MedioPago, delta: -1 | 1) => {
    const i = medios.indexOf(m);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= medios.length) return;
    const nuevos = [...medios];
    [nuevos[i], nuevos[j]] = [nuevos[j]!, nuevos[i]!];
    onCambiar(nuevos);
  };
  return (
    <div className="flex flex-col gap-1">
      <ul
        className="border-border divide-border rounded-control divide-y border"
        data-testid="medios-pago"
      >
        {filas.map((m) => {
          const habilitado = medios.includes(m);
          const i = medios.indexOf(m);
          const Icono = ICONO_MEDIO_PAGO[m];
          return (
            <li key={m} className="flex items-center gap-2 px-3">
              <Icono className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <Checkbox
                className="flex-1"
                label={ETIQUETA_MEDIO_PAGO[m]}
                checked={habilitado}
                disabled={habilitado && medios.length === 1}
                onChange={(e) =>
                  onCambiar(e.target.checked ? [...medios, m] : medios.filter((x) => x !== m))
                }
              />
              {habilitado && (
                <>
                  <IconButton
                    aria-label={`Subir ${ETIQUETA_MEDIO_PAGO[m]}`}
                    disabled={i === 0}
                    onClick={() => mover(m, -1)}
                  >
                    <ArrowUp strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    aria-label={`Bajar ${ETIQUETA_MEDIO_PAGO[m]}`}
                    disabled={i === medios.length - 1}
                    onClick={() => mover(m, 1)}
                  >
                    <ArrowDown strokeWidth={1.75} />
                  </IconButton>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
