"use client";

import { ClipboardList } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import type { VarianteEscaneada } from "@/features/scanner/tipos";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { conSigno } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StockParaRecuento } from "@/server/services/movimiento.service";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";

import { ajusteMasivoAction, stockParaRecuentoAction } from "../actions";

/**
 * Recuento físico: se lista el stock del sistema del depósito y se escribe lo
 * contado. Solo se ajustan las filas contadas que difieren (lo vacío = no contado).
 */
export function Recuento({
  depositos,
  depositoInicial,
}: {
  depositos: { id: string; nombre: string }[];
  depositoInicial: string;
}) {
  const toast = useToast();
  const [depositoId, setDepositoId] = useState(depositoInicial);
  const [incluirSinStock, setIncluirSinStock] = useState(false);
  const [planilla, setPlanilla] = useState<StockParaRecuento[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState("");
  const [motivo, setMotivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorMotivo, setErrorMotivo] = useState<string>();
  const [resaltada, setResaltada] = useState<string | null>(null);
  const lista = useRef<HTMLUListElement>(null);

  /** Escanear = +1 en lo contado de ese producto (si no estaba en la planilla, se agrega). */
  function contarEscaneo(v: VarianteEscaneada) {
    if (!planilla?.some((p) => p.varianteId === v.varianteId)) {
      const enDeposito = v.stockPorDeposito.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;
      setPlanilla((pl) => [
        {
          varianteId: v.varianteId,
          nombre: v.titulo,
          sku: v.sku,
          codigoBarras: v.codigoBarras,
          stockSistema: enDeposito,
        },
        ...(pl ?? []),
      ]);
    }
    setConteos((cs) => ({ ...cs, [v.varianteId]: String((Number(cs[v.varianteId]) || 0) + 1) }));
    setFiltro("");
    setResaltada(v.varianteId);
    requestAnimationFrame(() =>
      lista.current
        ?.querySelector(`[data-variante="${v.varianteId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }
  const escaner = useEscanerVariantes({
    onVariante: contarEscaneo,
    validar: () => (planilla === null ? "Primero cargá la planilla del depósito" : null),
    permitirRafaga: true,
    tituloCamara: "Recuento: escaneá cada unidad",
  });

  async function cargar(dep = depositoId, sinStock = incluirSinStock) {
    setCargando(true);
    const r = await stockParaRecuentoAction({ depositoId: dep, incluirSinStock: sinStock });
    setCargando(false);
    if (!r.ok) return toast.error("No se pudo cargar la planilla", r.error.message);
    setPlanilla(r.data);
    setConteos({});
  }

  const diferencias = useMemo(
    () =>
      (planilla ?? []).flatMap((p) => {
        const c = conteos[p.varianteId];
        if (c === undefined || c === "") return [];
        const dif = Number(c) - p.stockSistema;
        return dif === 0 ? [] : [{ ...p, real: Number(c), dif }];
      }),
    [planilla, conteos],
  );
  const contadas = Object.values(conteos).filter((c) => c !== "").length;
  const visibles = (planilla ?? []).filter((p) => {
    const q = filtro.trim().toLowerCase();
    return (
      !q ||
      p.nombre.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.codigoBarras ?? "").toLowerCase().includes(q)
    );
  });

  async function aplicar() {
    setEnviando(true);
    const items = Object.entries(conteos)
      .filter(([, c]) => c !== "")
      .map(([varianteId, c]) => ({ varianteId, cantidadReal: c }));
    const r = await ajusteMasivoAction({ depositoId, items, motivo });
    setEnviando(false);
    setConfirmando(false);
    if (!r.ok) {
      setErrorMotivo(r.error.fields?.motivo?.[0]);
      if (!r.error.fields?.motivo) toast.error("No se pudo aplicar el recuento", r.error.message);
      return;
    }
    invalidarResoluciones();
    toast.success(
      `Recuento aplicado: ${r.data.ajustes.length} ajuste(s)`,
      `${r.data.sinCambios} producto(s) coincidían con el sistema.`,
    );
    setMotivo("");
    await cargar();
  }

  return (
    <>
      <PageHeader
        title="Recuento de depósito"
        subtitle="Escribí lo que contaste. Solo se ajusta lo que no coincide."
      />
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
          <Select
            label="Depósito"
            options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
            value={depositoId}
            onChange={(e) => {
              setDepositoId(e.target.value);
              setPlanilla(null);
            }}
            containerClassName="md:w-64"
          />
          <Checkbox
            label="Incluir productos sin stock"
            checked={incluirSinStock}
            onChange={(e) => setIncluirSinStock(e.target.checked)}
          />
          <Button onClick={() => void cargar()} loading={cargando} className="md:ml-auto">
            {planilla ? "Recargar planilla" : "Cargar planilla"}
          </Button>
        </CardContent>
      </Card>

      {planilla === null ? (
        <EmptyState
          icon={ClipboardList}
          title="Elegí el depósito y cargá la planilla"
          description="Se listan los productos con stock en ese depósito según el sistema."
        />
      ) : planilla.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Este depósito no tiene productos con stock"
          description="Marcá “Incluir productos sin stock” para contar igual."
        />
      ) : (
        <div className="flex flex-col gap-3 pb-28 md:pb-0">
          <div className="flex gap-2">
            <input
              type="search"
              className={cn(controlClass, "h-11 flex-1")}
              placeholder="Filtrar la planilla…"
              aria-label="Filtrar la planilla"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <BotonCamara onClick={escaner.abrirCamara} />
          </div>
          <p className="text-muted text-xs">
            Cada escaneo (pistola o cámara) suma 1 a lo contado de ese producto.
          </p>
          <ul
            ref={lista}
            className="divide-border border-border bg-surface flex flex-col divide-y rounded-2xl border"
          >
            {visibles.map((p) => {
              const c = conteos[p.varianteId] ?? "";
              const dif = c === "" ? null : Number(c) - p.stockSistema;
              return (
                <li
                  key={p.varianteId}
                  data-variante={p.varianteId}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5",
                    dif !== null && dif !== 0 && "bg-warning-soft/40",
                    resaltada === p.varianteId && "ring-primary ring-2 ring-inset",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.nombre}</p>
                    <p className="text-muted text-xs">
                      {p.sku} · sistema{" "}
                      <strong className="text-foreground tabular-nums">{p.stockSistema}</strong>
                      {dif !== null && dif !== 0 && (
                        <span
                          className={cn(
                            "ml-2 font-semibold",
                            dif > 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {conSigno(dif)}
                        </span>
                      )}
                    </p>
                  </div>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="—"
                    aria-label={`Conteo de ${p.nombre}`}
                    value={c}
                    onChange={(e) =>
                      setConteos((cs) => ({
                        ...cs,
                        [p.varianteId]: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                    className={cn(
                      controlClass,
                      "h-11 w-20 text-right text-base font-semibold tabular-nums",
                    )}
                  />
                </li>
              );
            })}
          </ul>
          <Textarea
            label="Motivo"
            required
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: recuento mensual"
            error={errorMotivo}
          />
          <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t px-4 py-3 backdrop-blur md:static md:justify-end md:border-0 md:bg-transparent md:p-0">
            <p className="text-muted flex-1 text-sm md:flex-none">
              {contadas} contados ·{" "}
              <strong className="text-foreground">{diferencias.length} con diferencia</strong>
            </p>
            <Button onClick={() => setConfirmando(true)} disabled={diferencias.length === 0}>
              Revisar diferencias
            </Button>
          </div>
        </div>
      )}

      {escaner.ui}
      <Dialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title={`Aplicar ${diferencias.length} ajuste(s)`}
        description={`${depositos.find((d) => d.id === depositoId)?.nombre} · motivo: ${motivo || "—"}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={aplicar} loading={enviando}>
              Aplicar recuento
            </Button>
          </>
        }
      >
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-sm">
          {diferencias.map((d) => (
            <li key={d.varianteId} className="flex justify-between gap-3">
              <span className="truncate">{d.nombre}</span>
              <span className="shrink-0 tabular-nums">
                {d.stockSistema} → <strong>{d.real}</strong>{" "}
                <span className={d.dif > 0 ? "text-success" : "text-danger"}>
                  ({conSigno(d.dif)})
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
