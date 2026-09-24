"use client";

import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ReporteImportacion } from "@/server/services/producto.service";

import { importarCSVAction, previsualizarImportacionAction } from "../actions";

type Paso = "elegir" | "revisar" | "listo";

/**
 * Importación en 3 pasos: plantilla → subir y previsualizar (validación por
 * fila, sin escribir nada) → confirmar (el servidor valida TODO de nuevo e
 * inserta todo o nada).
 */
export function ImportarView() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [reporte, setReporte] = useState<ReporteImportacion | null>(null);
  const [paso, setPaso] = useState<Paso>("elegir");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string>();

  const formData = () => {
    const fd = new FormData();
    if (archivo) fd.set("archivo", archivo);
    return fd;
  };

  async function previsualizar(f: File) {
    setArchivo(f);
    setCargando(true);
    setError(undefined);
    const fd = new FormData();
    fd.set("archivo", f);
    const r = await previsualizarImportacionAction(fd);
    setCargando(false);
    if (!r.ok) return setError(r.error.message);
    setReporte(r.data);
    setPaso("revisar");
  }

  async function importar() {
    setCargando(true);
    const r = await importarCSVAction(formData());
    setCargando(false);
    if (!r.ok) return toast.error("No se pudo importar", r.error.message);
    setReporte(r.data);
    if (r.data.importado) {
      setPaso("listo");
      toast.success(
        "Importación completa",
        `${r.data.resumen.productosNuevos} productos y ${r.data.resumen.variantesNuevas} variantes.`,
      );
    } else {
      toast.error("El archivo cambió o tiene errores", "No se importó nada. Revisá el reporte.");
    }
  }

  function reiniciar() {
    setArchivo(null);
    setReporte(null);
    setPaso("elegir");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <PageHeader
        title="Importar productos"
        subtitle="Carga masiva desde una planilla. El stock no se importa: se carga después con un ingreso manual."
        actions={
          <a
            href="/api/productos/plantilla"
            className={buttonVariants({ variant: "secondary" })}
            download
          >
            <Download /> Descargar plantilla
          </a>
        }
      />

      <ol className="mb-4 flex gap-2 text-sm" aria-label="Pasos">
        {(["Elegir archivo", "Revisar", "Listo"] as const).map((t, i) => {
          const activo = ["elegir", "revisar", "listo"].indexOf(paso) === i;
          return (
            <li
              key={t}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1",
                activo ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted",
              )}
            >
              <span className="tabular-nums">{i + 1}.</span> {t}
            </li>
          );
        })}
      </ol>

      {paso === "elegir" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <FileSpreadsheet className="text-muted size-10" aria-hidden />
            <div className="text-muted max-w-md text-sm">
              <p>
                Columnas:{" "}
                <code className="text-foreground">
                  producto, marca, categoria, variante, sku, codigo_barras, precio_costo,
                  precio_venta, stock_minimo
                </code>
                .
              </p>
              <p className="mt-1">
                Acepta separador “;” o “,”, UTF-8 o Latin-1 (el “CSV” de Excel). Precios como
                1.234,56 o 1234.56.
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              id="archivo-csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void previsualizar(f);
              }}
            />
            <label
              htmlFor="archivo-csv"
              className={cn(
                buttonVariants({ size: "lg" }),
                "cursor-pointer",
                cargando && "pointer-events-none opacity-60",
              )}
            >
              <Upload /> {cargando ? "Validando…" : "Elegir archivo CSV"}
            </label>
            {error && (
              <p className="text-danger text-sm" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {reporte && paso !== "elegir" && (
        <div className="flex flex-col gap-4 pb-28 md:pb-0">
          <div
            role="status"
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm",
              reporte.importado
                ? "bg-success-soft text-success-soft-foreground"
                : reporte.valido
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "bg-danger-soft text-danger-soft-foreground",
            )}
          >
            <strong>{archivo?.name}</strong>
            <span>
              {reporte.resumen.total} filas · {reporte.resumen.ok} ok · {reporte.resumen.errores}{" "}
              con error
            </span>
            <span>
              {reporte.resumen.productosNuevos} productos nuevos · {reporte.resumen.variantesNuevas}{" "}
              variantes
            </span>
            <span className="text-xs opacity-80">
              ({reporte.encoding}, separador “{reporte.separador}”)
            </span>
          </div>
          {!reporte.valido && (
            <p className="text-sm">
              <strong>No se va a importar nada</strong> hasta que corrijas las filas en rojo (es
              todo o nada). Corregí la planilla y volvé a subirla.
            </p>
          )}

          <div className="border-border bg-surface overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Reporte por fila</caption>
              <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th className="w-16 px-3 py-2.5 text-left font-medium">Fila</th>
                  <th className="px-3 py-2.5 text-left font-medium">Producto</th>
                  <th className="px-3 py-2.5 text-left font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {reporte.filas.map((f) => (
                  <tr
                    key={f.fila}
                    className={cn(
                      f.estado === "error" ? "bg-danger-soft/50" : "bg-success-soft/30",
                    )}
                  >
                    <td className="px-3 py-2 align-top tabular-nums">{f.fila}</td>
                    <td className="px-3 py-2 align-top">
                      {f.producto || "—"}
                      {f.variante && <span className="text-muted block text-xs">{f.variante}</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-start gap-1.5">
                        {f.estado === "ok" ? (
                          <CheckCircle2
                            className="text-success mt-0.5 size-4 shrink-0"
                            aria-label="OK"
                          />
                        ) : (
                          <XCircle
                            className="text-danger mt-0.5 size-4 shrink-0"
                            aria-label="Error"
                          />
                        )}
                        {f.mensaje}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t px-4 py-3 backdrop-blur md:static md:justify-end md:border-0 md:bg-transparent md:p-0 [&>*]:flex-1 md:[&>*]:flex-none">
            {paso === "listo" ? (
              <>
                <Button variant="secondary" onClick={reiniciar}>
                  Importar otro
                </Button>
                <Link href="/productos" className={buttonVariants()}>
                  Ver productos
                </Link>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={reiniciar} disabled={cargando}>
                  Elegir otro archivo
                </Button>
                <Button onClick={importar} loading={cargando} disabled={!reporte.valido}>
                  {reporte.valido
                    ? `Importar ${reporte.resumen.total} filas`
                    : `Hay ${reporte.resumen.errores} errores`}
                </Button>
              </>
            )}
          </div>
          {paso === "listo" && (
            <Badge variant="success" className="self-start">
              Importado
            </Badge>
          )}
        </div>
      )}
    </>
  );
}
