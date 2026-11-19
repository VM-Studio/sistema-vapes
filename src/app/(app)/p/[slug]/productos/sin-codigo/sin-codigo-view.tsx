"use client";

import { Barcode, CircleCheck, ScanLine, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { CameraScanner, type MensajeCamara } from "@/features/scanner/CameraScanner";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useBarcodeScanner } from "@/features/scanner/useBarcodeScanner";
import { useScanFeedback } from "@/features/scanner/useScanFeedback";
import { formatearNumero } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SaborSinCodigo } from "@/server/services/producto.service";

import { vincularCodigoAction } from "../actions";

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * «Productos sin código de barras»: tocás «Vincular» en un sabor, escaneás
 * (pistola, cámara o tipeado) y el código le queda cargado. Sale de la lista
 * y seguís con el próximo.
 */
export function SinCodigoView({
  sabores,
  puedeVincular,
}: {
  sabores: SaborSinCodigo[];
  puedeVincular: boolean;
}) {
  const ruta = useRutaPanel();
  const feedback = useScanFeedback();
  // La lista de cuando se abrió la pantalla: lo vinculado queda a la vista con su código.
  const [lista] = useState(sabores);
  const [vinculados, setVinculados] = useState<Record<string, string>>({});
  const [activo, setActivo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camara, setCamara] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeCamara | null>(null);
  const clave = useRef(0);
  const enviandoRef = useRef(false);

  const pendientes = lista.filter((s) => !(s.varianteId in vinculados));
  const visibles = useMemo(() => {
    const palabras = sinAcentos(filtro).split(/\s+/).filter(Boolean);
    if (!palabras.length) return lista;
    return lista.filter((s) => {
      const texto = sinAcentos(`${s.titulo} ${s.sku}`);
      return palabras.every((p) => texto.includes(p));
    });
  }, [lista, filtro]);
  const saborActivo = lista.find((s) => s.varianteId === activo) ?? null;

  function empezar(varianteId: string) {
    feedback.prepararAudio();
    setError(null);
    setMensaje(null);
    setActivo(varianteId);
  }

  function cancelar() {
    setActivo(null);
    setError(null);
    setCamara(false);
  }

  async function vincular(codigo: string) {
    if (!saborActivo || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    const r = await vincularCodigoAction({ varianteId: saborActivo.varianteId, codigo }).catch(
      () => null,
    );
    enviandoRef.current = false;
    setEnviando(false);
    if (!r || !r.ok) {
      const texto = !r
        ? "Sin conexión con el servidor: el código no se guardó. Probá de nuevo."
        : (r.error.fields?.codigo?.[0] ?? r.error.message);
      feedback.error();
      setError(texto);
      setMensaje({ tipo: "error", texto, detalle: codigo, clave: ++clave.current });
      return;
    }
    invalidarResoluciones(r.data.codigo);
    feedback.ok(`Código vinculado`, `${r.data.titulo} · ${r.data.codigo}`);
    setVinculados((v) => ({ ...v, [r.data.varianteId]: r.data.codigo }));
    setCamara(false);
    setActivo(null);
  }

  // Pistola: solo mientras hay un sabor esperando su código.
  useBarcodeScanner({
    onScan: (c) => void vincular(c),
    enabled: puedeVincular && activo !== null,
  });

  const cantidadVinculados = Object.keys(vinculados).length;

  return (
    <>
      <PageHeader
        title="Productos sin código de barras"
        subtitle={
          pendientes.length === 0
            ? "Todos los productos tienen su código."
            : `${formatearNumero(pendientes.length)} sabor${pendientes.length === 1 ? "" : "es"} cargado${pendientes.length === 1 ? "" : "s"} a mano que nunca se escanea${pendientes.length === 1 ? "" : "ron"}. Tocá «Vincular» y escaneá el producto.`
        }
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Productos", href: ruta("/productos") },
              { label: "Sin código de barras" },
            ]}
          />
        }
      />

      {cantidadVinculados > 0 && (
        <p
          role="status"
          className="bg-success-soft text-success-soft-foreground rounded-control mb-4 px-4 py-3 text-sm"
          data-testid="vinculados"
        >
          Vinculaste {cantidadVinculados} código{cantidadVinculados === 1 ? "" : "s"} en esta
          sesión.
        </p>
      )}

      {!puedeVincular && pendientes.length > 0 && (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-control mb-4 px-4 py-3 text-sm">
          Para vincular códigos necesitás permiso de edición en Productos.
        </p>
      )}

      {lista.length === 0 ? (
        <EmptyState
          icon={Barcode}
          title="No hay productos sin código"
          description="Todos los sabores cargados ya tienen su código de barras."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search
              className="text-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar por producto, sabor o SKU"
              aria-label="Filtrar productos sin código"
              className={cn(controlClass, "h-11 pl-10")}
            />
          </div>

          {visibles.length === 0 ? (
            <p className="text-muted py-8 text-center text-sm">
              {pendientes.length === 0
                ? "Listo: vinculaste todos."
                : "Ningún producto coincide con el filtro."}
            </p>
          ) : (
            <ul
              className="bg-card rounded-card divide-border divide-y"
              data-testid="lista-sin-codigo"
            >
              {visibles.map((s) => {
                const esActivo = s.varianteId === activo;
                const hecho = vinculados[s.varianteId];
                return (
                  <li
                    key={s.varianteId}
                    className={cn("flex flex-col gap-3 px-4 py-3", esActivo && "bg-surface")}
                    data-testid="sabor-sin-codigo"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={ruta(`/productos/${s.productoId}`)}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {s.titulo}
                        </Link>
                        <p className="text-muted text-sm tabular-nums">
                          {s.sku} · {formatearNumero(s.stock)} en stock
                          {s.codigoInterno && <> · etiqueta {s.codigoInterno}</>}
                        </p>
                      </div>
                      {hecho ? (
                        <span className="text-success flex shrink-0 items-center gap-1 text-sm font-medium">
                          <CircleCheck className="size-4" aria-hidden /> {hecho}
                        </span>
                      ) : puedeVincular && !esActivo ? (
                        <Button
                          variant="secondary"
                          className="shrink-0"
                          onClick={() => empezar(s.varianteId)}
                          data-testid="vincular"
                        >
                          <ScanLine strokeWidth={1.75} /> Vincular
                        </Button>
                      ) : esActivo ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={cancelar}
                          aria-label="Cancelar"
                        >
                          <X strokeWidth={1.75} />
                        </Button>
                      ) : null}
                    </div>
                    {esActivo && (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium">
                          Escaneá el código de este producto con la pistola o la cámara (o tipealo y
                          Enter).
                        </p>
                        <ScanInput
                          onScan={(c) => void vincular(c)}
                          onAbrirCamara={() => {
                            feedback.prepararAudio();
                            setCamara(true);
                          }}
                          placeholder={enviando ? "Guardando…" : "Escaneá el código de barras"}
                        />
                        {error && (
                          <p
                            role="alert"
                            className="text-danger text-sm"
                            data-testid="error-vincular"
                          >
                            {error}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <CameraScanner
        open={camara}
        onOpenChange={setCamara}
        onDetect={(c) => void vincular(c)}
        mensaje={mensaje}
        titulo={saborActivo ? `Código de ${saborActivo.titulo}` : undefined}
      />
    </>
  );
}
