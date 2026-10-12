"use client";

import { CondicionIva, type TipoFactura } from "@prisma/client";
import { Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { cn, formatearFecha } from "@/lib/utils";
import {
  calcularImportesFactura,
  CONDICION_IVA_LABEL,
  TIPO_FACTURA_LABEL,
} from "@/lib/validations/factura";
import type { VentaParaFacturar } from "@/server/services/factura.service";

import { montoTipeado } from "../../ventas/estado-venta";
import { buscarVentaFacturarAction, facturarVentaAction, facturaSueltaAction } from "../actions";

interface Renglon {
  descripcion: string;
  cantidad: string;
  precio: string;
}

const renglonVacio: Renglon = { descripcion: "", cantidad: "1", precio: "" };

/**
 * Nueva factura en una pantalla: desde una venta (se busca por su ID y se
 * toman sus ítems, descuento y cliente) o suelta (cliente y renglones a
 * mano), tipo de comprobante, datos fiscales del cliente y número fiscal si
 * ya se emitió por fuera. Los importes los recalcula el servidor.
 */
export function NuevaFactura({
  tipos,
  alicuotaIva,
  ventaInicial,
}: {
  tipos: TipoFactura[];
  alicuotaIva: number;
  ventaInicial: VentaParaFacturar | null;
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();
  const [modo, setModo] = useState<"venta" | "suelta">("venta");
  const [busqueda, setBusqueda] = useState(ventaInicial?.codigo ?? "");
  const [venta, setVenta] = useState<VentaParaFacturar | null>(ventaInicial);
  const [buscando, setBuscando] = useState(false);
  const [errorVenta, setErrorVenta] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [renglones, setRenglones] = useState<Renglon[]>([{ ...renglonVacio }]);
  const [tipo, setTipo] = useState<TipoFactura>(tipos.includes("B") ? "B" : tipos[0]!);
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState("");
  const [condicionIva, setCondicionIva] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [numeroExterno, setNumeroExterno] = useState("");
  const [observacion, setObservacion] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function buscar() {
    if (!busqueda.trim()) return;
    setBuscando(true);
    setErrorVenta(null);
    const r = await buscarVentaFacturarAction({ texto: busqueda }).catch(() => null);
    setBuscando(false);
    if (!r?.ok) return setErrorVenta(r?.error.message ?? "Sin conexión: probá de nuevo.");
    if (!r.data) {
      setVenta(null);
      return setErrorVenta("No hay una venta con ese ID en este panel.");
    }
    setVenta(r.data);
  }

  const items = renglones
    .map((r) => ({
      descripcion: r.descripcion.trim(),
      cantidad: Number(r.cantidad),
      precioUnitario: montoTipeado(r.precio),
    }))
    .filter((r) => r.descripcion && r.cantidad > 0 && r.precioUnitario !== null);
  const importes =
    modo === "suelta"
      ? calcularImportesFactura(
          tipo,
          items.map((i) => ({ cantidad: i.cantidad, precioUnitario: i.precioUnitario! })),
          0,
          alicuotaIva,
        )
      : venta
        ? calcularImportesFactura(
            tipo,
            [{ cantidad: 1, precioUnitario: venta.total }],
            0,
            alicuotaIva,
          )
        : null;

  const ventaBloqueada = venta ? venta.anulada || venta.factura !== null : true;
  const puedeEmitir =
    !enviando &&
    (modo === "venta"
      ? !!venta && !ventaBloqueada
      : cliente?.tipo === "existente" && items.length > 0);

  async function emitir() {
    setEnviando(true);
    setErrores({});
    const datosFiscales = { razonSocial, cuit, condicionIva, domicilio };
    const r =
      modo === "venta"
        ? await facturarVentaAction({
            ventaId: venta!.id,
            tipo,
            numeroExterno,
            datosFiscales,
            observacion,
          }).catch(() => null)
        : await facturaSueltaAction({
            clienteId: cliente?.tipo === "existente" ? cliente.id : "",
            tipo,
            numeroExterno,
            items: items.map((i) => ({ ...i, precioUnitario: i.precioUnitario! })),
            datosFiscales,
            observacion,
          }).catch(() => null);
    setEnviando(false);
    if (!r) return toast.error("Sin conexión", "La factura no se guardó: probá de nuevo.");
    if (!r.ok) {
      setErrores(
        Object.fromEntries(
          Object.entries(r.error.fields ?? {}).map(([k, m]) => [
            k.replace(/^datosFiscales\./, ""),
            m[0] ?? "",
          ]),
        ),
      );
      return toast.error("No se pudo emitir", r.error.message);
    }
    toast.success(`Factura ${r.data.codigo} registrada`);
    router.push(ruta(`/facturas/${r.data.id}`));
  }

  return (
    <>
      <PageHeader
        title="Nueva factura"
        subtitle="Registrá la factura emitida por fuera o generá un comprobante interno."
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Facturas", href: ruta("/facturas") }, { label: "Nueva" }]}
          />
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Origen" className="grid grid-cols-2 gap-2 md:max-w-md">
            {(
              [
                ["venta", "Desde una venta"],
                ["suelta", "Suelta"],
              ] as const
            ).map(([m, etiqueta]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={modo === m}
                onClick={() => setModo(m)}
                className={cn(
                  "rounded-control min-h-11 border px-4 text-sm font-semibold transition-colors",
                  modo === m
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground bg-surface text-foreground hover:bg-surface-2",
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {modo === "venta" ? (
            <SectionCard title="Venta" contentClassName="flex flex-col gap-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void buscar();
                }}
              >
                <Input
                  aria-label="ID de la venta"
                  placeholder="ID de la venta (COS-000123 o 123)"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  containerClassName="flex-1"
                />
                <Button type="submit" variant="secondary" loading={buscando}>
                  <Search strokeWidth={1.75} /> Buscar
                </Button>
              </form>
              {errorVenta && (
                <p role="alert" className="text-danger text-sm">
                  {errorVenta}
                </p>
              )}
              {venta && (
                <div
                  className="bg-surface border-border rounded-control border p-4 text-sm"
                  data-testid="venta-a-facturar"
                >
                  <p className="font-mono font-semibold">{venta.codigo}</p>
                  <p>
                    {venta.cliente.nombre} · {formatearFecha(venta.fecha)} · {venta.unidades} u. ·{" "}
                    <strong className="tabular-nums">{formatearPesos(venta.total)}</strong>
                  </p>
                  {venta.anulada && (
                    <p className="text-danger mt-1">La venta está anulada: no se factura.</p>
                  )}
                  {venta.factura && (
                    <p className="text-danger mt-1">
                      Ya tiene la factura {venta.factura.codigo}: anulala para volver a facturar.
                    </p>
                  )}
                </div>
              )}
            </SectionCard>
          ) : (
            <SectionCard title="Cliente y renglones" contentClassName="flex flex-col gap-4">
              <SelectorCliente valor={cliente} onCambiar={setCliente} permitirNuevo={false} />
              <ul className="flex flex-col gap-2">
                {renglones.map((r, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_5rem_8rem_auto] items-start gap-2"
                  >
                    <Input
                      aria-label={`Descripción ${i + 1}`}
                      placeholder="Descripción"
                      value={r.descripcion}
                      onChange={(e) =>
                        setRenglones((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      aria-label={`Cantidad ${i + 1}`}
                      inputMode="numeric"
                      value={r.cantidad}
                      onChange={(e) =>
                        setRenglones((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                        )
                      }
                      className="text-right tabular-nums"
                    />
                    <Input
                      aria-label={`Precio ${i + 1}`}
                      inputMode="decimal"
                      placeholder="Precio final"
                      value={r.precio}
                      onChange={(e) =>
                        setRenglones((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)),
                        )
                      }
                      className="text-right tabular-nums"
                    />
                    <IconButton
                      aria-label={`Quitar renglón ${i + 1}`}
                      disabled={renglones.length === 1}
                      onClick={() => setRenglones((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <Trash2 strokeWidth={1.75} />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setRenglones((rs) => [...rs, { ...renglonVacio }])}
              >
                <Plus strokeWidth={1.75} /> Agregar renglón
              </Button>
            </SectionCard>
          )}

          <SectionCard
            title="Comprobante"
            description="Los precios son finales: en la factura A se discrimina el IVA."
            contentClassName="grid gap-4 md:grid-cols-2"
          >
            <Select
              label="Tipo"
              options={tipos.map((t) => ({ value: t, label: TIPO_FACTURA_LABEL[t] }))}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoFactura)}
            />
            <Input
              label="Número fiscal (si ya la emitiste)"
              placeholder="0001-00001234"
              value={numeroExterno}
              onChange={(e) => setNumeroExterno(e.target.value)}
              error={errores.numeroExterno}
              disabled={tipo === "COMPROBANTE_INTERNO"}
            />
            <Input
              label={tipo === "A" ? "Razón social" : "Razón social (opcional)"}
              placeholder={modo === "venta" ? venta?.cliente.nombre : undefined}
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              error={errores.razonSocial}
            />
            <Input
              label={tipo === "A" ? "CUIT" : "CUIT (opcional)"}
              placeholder="20-12345678-6"
              inputMode="numeric"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              error={errores.cuit}
            />
            <Select
              label="Condición frente al IVA"
              options={[
                { value: "", label: "Sin especificar" },
                ...Object.values(CondicionIva).map((c) => ({
                  value: c,
                  label: CONDICION_IVA_LABEL[c],
                })),
              ]}
              value={condicionIva}
              onChange={(e) => setCondicionIva(e.target.value)}
            />
            <Input
              label="Domicilio (opcional)"
              value={domicilio}
              onChange={(e) => setDomicilio(e.target.value)}
            />
            <div className="md:col-span-2">
              <Textarea
                label="Observación (opcional)"
                rows={2}
                maxLength={500}
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
              />
            </div>
          </SectionCard>
        </div>

        <section
          aria-label="Resumen"
          className="bg-card rounded-card flex flex-col gap-3 self-start p-4 md:p-5"
        >
          <h2 className="text-h3 font-semibold">{TIPO_FACTURA_LABEL[tipo]}</h2>
          {importes ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {tipo === "A" && (
                <>
                  <dt className="text-muted">Neto gravado</dt>
                  <dd className="text-right tabular-nums">{formatearPesos(importes.subtotal)}</dd>
                  <dt className="text-muted">IVA {alicuotaIva}%</dt>
                  <dd className="text-right tabular-nums">{formatearPesos(importes.iva)}</dd>
                </>
              )}
              <dt className="text-h3 font-semibold">Total</dt>
              <dd
                className="text-h3 text-right font-semibold tabular-nums"
                data-testid="total-factura"
              >
                {formatearPesos(importes.total)}
              </dd>
            </dl>
          ) : (
            <p className="text-muted text-sm">Elegí la venta para ver el total.</p>
          )}
          {tipo === "COMPROBANTE_INTERNO" && (
            <p className="text-muted text-small">Comprobante no válido como factura.</p>
          )}
          <Button
            size="lg"
            disabled={!puedeEmitir}
            loading={enviando}
            onClick={() => void emitir()}
          >
            Registrar factura
          </Button>
        </section>
      </div>
    </>
  );
}
