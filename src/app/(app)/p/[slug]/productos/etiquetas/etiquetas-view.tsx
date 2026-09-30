"use client";

import { FileDown, Minus, Plus, Tags, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { usePanel, useRutaPanel } from "@/components/layout/panel-context";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import { CantidadInput } from "@/components/ui/cantidad-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ChipLink, ChipRow } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FORMATOS_ETIQUETA, type FormatoEtiqueta } from "@/lib/validations/etiquetas";
import type { VarianteParaEtiqueta } from "@/server/services/etiquetas.service";

interface Seleccionada {
  varianteId: string;
  nombreCompleto: string;
  tieneCodigo: boolean;
  cantidad: number;
}

const FORMATO_KEY = "etiquetas.formato";

function formatoGuardado(): FormatoEtiqueta {
  try {
    const f = localStorage.getItem(FORMATO_KEY);
    if (f && f in FORMATOS_ETIQUETA) return f as FormatoEtiqueta;
  } catch {}
  return "avery65";
}

export function EtiquetasView({
  variantes,
  hayFiltro,
  filtros,
  preseleccion,
  puedeGenerarCodigos,
}: {
  variantes: VarianteParaEtiqueta[];
  hayFiltro: boolean;
  filtros: { q: string; productoId: string; soloSinCodigoDeFabrica: boolean };
  preseleccion: { varianteId: string; nombreCompleto: string; codigoBarras: string | null }[];
  puedeGenerarCodigos: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const panel = usePanel();
  const ruta = useRutaPanel();
  const [seleccion, setSeleccion] = useState<Map<string, Seleccionada>>(
    () =>
      new Map(
        preseleccion.map((v) => [
          v.varianteId,
          {
            varianteId: v.varianteId,
            nombreCompleto: v.nombreCompleto,
            tieneCodigo: v.codigoBarras !== null,
            cantidad: 1,
          },
        ]),
      ),
  );
  const [formato, setFormato] = useState<FormatoEtiqueta>(formatoGuardado);
  const [mostrarPrecio, setMostrarPrecio] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; nombre: string } | null>(null);
  const descarga = useRef<HTMLAnchorElement>(null);

  const total = useMemo(
    () => [...seleccion.values()].reduce((a, s) => a + s.cantidad, 0),
    [seleccion],
  );
  const sinCodigo = [...seleccion.values()].filter((s) => !s.tieneCodigo).length;

  function cambiar(fn: (m: Map<string, Seleccionada>) => void) {
    setSeleccion((prev) => {
      const m = new Map(prev);
      fn(m);
      return m;
    });
  }
  const alternar = (v: VarianteParaEtiqueta, on: boolean) =>
    cambiar((m) =>
      on
        ? m.set(v.varianteId, {
            varianteId: v.varianteId,
            nombreCompleto: v.nombreCompleto,
            tieneCodigo: v.codigoBarras !== null,
            cantidad: 1,
          })
        : m.delete(v.varianteId),
    );
  const todasVisibles = variantes.length > 0 && variantes.every((v) => seleccion.has(v.varianteId));
  const cantidad = (id: string, n: number) =>
    cambiar((m) => {
      const s = m.get(id);
      if (s) m.set(id, { ...s, cantidad: Math.min(500, Math.max(1, n)) });
    });

  // Escanear un producto lo suma a la selección (+1 etiqueta si ya estaba).
  const escaner = useEscanerVariantes({
    onVariante: (v) =>
      cambiar((m) => {
        const s = m.get(v.varianteId);
        m.set(
          v.varianteId,
          s
            ? { ...s, cantidad: Math.min(500, s.cantidad + 1) }
            : {
                varianteId: v.varianteId,
                nombreCompleto: v.titulo,
                tieneCodigo: v.codigoBarras !== null,
                cantidad: 1,
              },
        );
      }),
    tituloCamara: "Escanear para etiquetar",
  });

  async function generar() {
    setGenerando(true);
    try {
      const res = await fetch(`/api/p/${panel.slug}/etiquetas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formato,
          mostrarPrecio,
          items: [...seleccion.values()].map((s) => ({
            varianteId: s.varianteId,
            cantidad: s.cantidad,
          })),
        }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error("No se pudo generar el PDF", e?.error?.message);
        return;
      }
      const generados = Number(res.headers.get("X-Codigos-Generados") ?? 0);
      if (pdf) URL.revokeObjectURL(pdf.url);
      const nuevo = {
        url: URL.createObjectURL(await res.blob()),
        nombre: `etiquetas-${formato}.pdf`,
      };
      setPdf(nuevo);
      toast.success(
        `PDF con ${res.headers.get("X-Etiquetas")} etiquetas`,
        generados ? `Se generaron ${generados} código(s) interno(s).` : undefined,
      );
      if (generados) {
        cambiar((m) => m.forEach((s, k) => m.set(k, { ...s, tieneCodigo: true })));
        router.refresh();
      }
      requestAnimationFrame(() => descarga.current?.click());
    } finally {
      setGenerando(false);
    }
  }

  const hrefFiltro = (cambios: Partial<{ q: string; producto: string; sinCodigo: string }>) => {
    const sp = new URLSearchParams();
    const base = {
      q: filtros.q,
      producto: filtros.productoId,
      sinCodigo: filtros.soloSinCodigoDeFabrica ? "1" : "",
      ...cambios,
    };
    for (const [k, v] of Object.entries(base)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `${ruta("/productos/etiquetas")}?${qs}` : ruta("/productos/etiquetas");
  };

  return (
    <>
      <PageHeader
        title="Etiquetas"
        subtitle="Code128 para productos sin código de fábrica (o para re-etiquetar). Se imprimen desde el PDF."
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Productos", href: ruta("/productos") }, { label: "Etiquetas" }]}
          />
        }
      />
      <div className="grid grid-cols-1 gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
        <div className="flex min-w-0 flex-col gap-4">
          <ScanInput
            onScan={(c, m) => void escaner.procesar(c, m.fuente)}
            onAbrirCamara={escaner.abrirCamara}
            inputRef={escaner.inputRef}
            autoFocus={false}
            placeholder="Escaneá un producto para sumarlo"
          />
          <SearchInput placeholder="Buscar por nombre, sabor o SKU" />
          <ChipRow ariaLabel="Filtros">
            <ChipLink
              href={hrefFiltro({ sinCodigo: filtros.soloSinCodigoDeFabrica ? "" : "1" })}
              activo={filtros.soloSinCodigoDeFabrica}
            >
              Sin código de fábrica
            </ChipLink>
            {filtros.productoId && (
              <ChipLink href={hrefFiltro({ producto: "" })} activo>
                Solo este producto <X strokeWidth={1.75} aria-label="quitar filtro" />
              </ChipLink>
            )}
          </ChipRow>
          {!hayFiltro ? (
            <EmptyState
              icon={Tags}
              title="Buscá o escaneá los productos a etiquetar"
              description="O mostrá todas las variantes que no tienen código de fábrica."
              action={
                <Link
                  href={hrefFiltro({ sinCodigo: "1" })}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Ver las que no tienen código
                </Link>
              }
            />
          ) : variantes.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="No hay variantes con esos filtros"
              description="Probá con otra búsqueda o quitá los filtros."
              action={
                <Link
                  href={ruta("/productos/etiquetas")}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Limpiar filtros
                </Link>
              }
            />
          ) : (
            <div className="border-border bg-surface rounded-card overflow-hidden border">
              <div className="border-border bg-card flex items-center justify-between gap-2 border-b px-4">
                <Checkbox
                  label={
                    filtros.productoId
                      ? "Todas las de este producto"
                      : `Todas (${variantes.length})`
                  }
                  checked={todasVisibles}
                  onChange={(e) => variantes.forEach((v) => alternar(v, e.target.checked))}
                />
              </div>
              <ul aria-label="Variantes">
                {variantes.map((v) => (
                  <li
                    key={v.varianteId}
                    className="border-border hover:bg-card/60 flex items-center gap-3 border-b px-4 transition-colors last:border-0"
                  >
                    <Checkbox
                      className="min-w-0 flex-1"
                      checked={seleccion.has(v.varianteId)}
                      onChange={(e) => alternar(v, e.target.checked)}
                      label={
                        <span className="flex min-w-0 flex-col py-1">
                          <span className="font-medium">{v.nombreCompleto}</span>
                          <span className="text-muted text-xs">
                            {v.codigoBarras ? (
                              <span className="font-mono">{v.codigoBarras}</span>
                            ) : (
                              <span className="text-warning-soft-foreground">sin código</span>
                            )}
                            {v.sinCodigoDeFabrica && v.codigoBarras && " · interno"} ·{" "}
                            {formatearPesos(v.precioVenta)}
                          </span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <SectionCard
          title={`A imprimir: ${total} ${total === 1 ? "etiqueta" : "etiquetas"}`}
          className="lg:sticky lg:top-4 lg:self-start"
          contentClassName="flex flex-col gap-4"
        >
          {seleccion.size === 0 ? (
            <p className="text-muted text-sm">Elegí o escaneá productos.</p>
          ) : (
            <ul
              aria-label="Selección"
              className="border-border bg-surface divide-border rounded-card flex max-h-80 flex-col divide-y overflow-y-auto border"
            >
              {[...seleccion.values()].map((s) => (
                <li key={s.varianteId} className="flex items-center gap-1 py-1 pr-1 pl-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{s.nombreCompleto}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => cantidad(s.varianteId, s.cantidad - 1)}
                    aria-label={`Una etiqueta menos de ${s.nombreCompleto}`}
                  >
                    <Minus strokeWidth={1.75} />
                  </Button>
                  <CantidadInput
                    etiqueta={`Cantidad de etiquetas de ${s.nombreCompleto}`}
                    valor={s.cantidad}
                    max={500}
                    onCambio={(n) => cantidad(s.varianteId, n)}
                    className="h-9 w-14 px-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => cantidad(s.varianteId, s.cantidad + 1)}
                    aria-label={`Una etiqueta más de ${s.nombreCompleto}`}
                  >
                    <Plus strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-danger"
                    onClick={() => cambiar((m) => m.delete(s.varianteId))}
                    aria-label={`Quitar ${s.nombreCompleto}`}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {sinCodigo > 0 && (
            <p
              className={cn(
                "rounded-control px-3 py-2 text-sm",
                puedeGenerarCodigos
                  ? "bg-surface text-muted"
                  : "bg-danger-soft text-danger-soft-foreground",
              )}
            >
              {puedeGenerarCodigos
                ? `${sinCodigo} sin código: se les asigna un código interno al generar el PDF.`
                : `${sinCodigo} sin código: pedile a alguien con permiso de edición que les genere uno.`}
            </p>
          )}
          <Select
            label="Formato"
            options={Object.entries(FORMATOS_ETIQUETA).map(([value, f]) => ({
              value,
              label: f.label,
            }))}
            value={formato}
            onChange={(e) => {
              const f = e.target.value as FormatoEtiqueta;
              setFormato(f);
              try {
                localStorage.setItem(FORMATO_KEY, f);
              } catch {}
            }}
          />
          <Switch
            label="Mostrar precio de venta"
            checked={mostrarPrecio}
            onCheckedChange={setMostrarPrecio}
          />
          <div className="border-border bg-surface fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <Button
              onClick={() => void generar()}
              loading={generando}
              disabled={seleccion.size === 0 || (sinCodigo > 0 && !puedeGenerarCodigos)}
            >
              <FileDown strokeWidth={1.75} /> Generar PDF
            </Button>
            {pdf && (
              <a
                ref={descarga}
                href={pdf.url}
                download={pdf.nombre}
                className="text-muted hover:text-foreground text-center text-sm font-medium underline underline-offset-4"
              >
                Descargar de nuevo
              </a>
            )}
          </div>
        </SectionCard>
      </div>
      {escaner.ui}
    </>
  );
}
