"use client";

import { Eye, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import { MAX_ARCHIVO_FACTURA_ML, TIPOS_ARCHIVO_FACTURA_ML } from "@/lib/validations/factura";
import type { VentaMLListada } from "@/server/services/factura-ml.service";

import { cargarFacturaMLAction } from "../actions";

/**
 * Acciones de una venta Mercado Libre en Facturas: «Detalle» (ítems, total y
 * la factura cargada) y, si está pendiente y hay FACTURAS "editar", «Cargar»:
 * fecha (hoy) + archivo opcional → «Cargado».
 */
export function AccionesVentaML({
  venta,
  puedeEditar,
  urlArchivo,
}: {
  venta: VentaMLListada;
  puedeEditar: boolean;
  /** Ruta del archivo cargado (null si no tiene). */
  urlArchivo: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const [dialogo, setDialogo] = useState<null | "detalle" | "cargar">(null);
  const [fecha, setFecha] = useState(hoyAR());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pesado = archivo !== null && archivo.size > MAX_ARCHIVO_FACTURA_ML;

  function abrirCarga() {
    setFecha(hoyAR());
    setArchivo(null);
    setError(null);
    setDialogo("cargar");
  }

  async function cargado() {
    setEnviando(true);
    setError(null);
    const form = new FormData();
    form.set("ventaId", venta.id);
    form.set("fecha", fecha);
    if (archivo) form.set("archivo", archivo);
    const r = await cargarFacturaMLAction(form).catch(() => null);
    setEnviando(false);
    if (!r) return setError("Sin conexión con el servidor. Probá de nuevo.");
    if (!r.ok) return setError(r.error.message);
    toast.success("Factura cargada", venta.codigo);
    setDialogo(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={() => setDialogo("detalle")}>
        <Eye strokeWidth={1.75} /> Detalle
      </Button>
      {venta.estado === "PENDIENTE" && puedeEditar && (
        <Button size="sm" onClick={abrirCarga} data-testid="cargar-factura-ml">
          <FileUp strokeWidth={1.75} /> Cargar
        </Button>
      )}

      <Dialog
        open={dialogo === "detalle"}
        onOpenChange={(o) => !o && setDialogo(null)}
        title={`Venta ${venta.codigo}`}
        description={`${formatearFechaHora(venta.fecha)} · ${venta.cliente.nombre}`}
        footer={
          <>
            <Link
              href={ruta(`/ventas/${venta.id}`)}
              className="text-foreground text-sm font-medium hover:underline"
            >
              Abrir la venta
            </Link>
            <Button variant="secondary" onClick={() => setDialogo(null)}>
              Cerrar
            </Button>
          </>
        }
      >
        <ResumenVenta venta={venta} />
        <p className="border-border border-t pt-3 text-sm" data-testid="detalle-factura-ml">
          {venta.factura ? (
            <>
              Factura cargada el <strong>{formatearFecha(venta.factura.fecha)}</strong> por{" "}
              {venta.factura.usuario}
              {urlArchivo ? (
                <>
                  {" · "}
                  <a
                    href={urlArchivo}
                    target="_blank"
                    rel="noopener"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    Ver archivo
                  </a>
                </>
              ) : (
                " (sin archivo)"
              )}
            </>
          ) : (
            <span className="text-muted">Factura pendiente de cargar.</span>
          )}
        </p>
      </Dialog>

      <Dialog
        open={dialogo === "cargar"}
        onOpenChange={(o) => !o && !enviando && setDialogo(null)}
        title={`Cargar factura de ${venta.codigo}`}
        description="La factura se emite en ARCA, por fuera del sistema. Acá queda registrado que se cargó."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogo(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              loading={enviando}
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || pesado}
              onClick={() => void cargado()}
            >
              Cargado
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="bg-surface-3 rounded-control flex justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0 truncate">{venta.cliente.nombre}</span>
            <strong className="shrink-0 tabular-nums">{formatearPesos(venta.total)}</strong>
          </p>
          <Input
            type="date"
            label="Fecha de la factura"
            value={fecha}
            max={hoyAR()}
            onChange={(e) => setFecha(e.target.value)}
          />
          <Input
            type="file"
            label="Archivo de la factura (opcional)"
            accept={TIPOS_ARCHIVO_FACTURA_ML.join(",")}
            hint="PDF o imagen (PNG, JPG o WebP), hasta 5 MB."
            className="file:bg-surface-2 file:text-foreground file:rounded-inner py-1.5 file:mr-3 file:border-0 file:px-3 file:py-1 file:text-sm file:font-medium"
            error={pesado ? "El archivo no puede pesar más de 5 MB." : undefined}
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />
          {error && (
            <p role="alert" className="text-danger text-small">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function ResumenVenta({ venta }: { venta: VentaMLListada }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5 text-sm">
        {venta.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-3">
            <span className="min-w-0">
              {i.cantidad} × {i.titulo}
              <span className="text-muted block text-xs">
                {formatearPesos(i.precioUnitario)} c/u
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatearPesos(i.subtotal)}</span>
          </li>
        ))}
      </ul>
      <p className="border-border flex justify-between gap-3 border-t pt-3 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatearPesos(venta.total)}</span>
      </p>
    </div>
  );
}
