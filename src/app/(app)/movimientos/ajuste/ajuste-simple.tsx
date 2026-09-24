"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { VariantePicker, type VarianteBuscada } from "@/components/catalogo/variante-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { conSigno } from "@/lib/format";

import { ajusteAction, variantesPorIdAction } from "../actions";

export function AjusteSimple({
  depositos,
  depositoInicial,
  precargada,
}: {
  depositos: { id: string; nombre: string }[];
  depositoInicial: string;
  precargada: VarianteBuscada | null;
}) {
  const toast = useToast();
  const [depositoId, setDepositoId] = useState(depositoInicial);
  const [variante, setVariante] = useState<VarianteBuscada | null>(precargada);
  const [real, setReal] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const sistema = variante?.stockDeposito ?? 0;
  const diferencia = real === "" ? null : Number(real) - sistema;
  const deposito = depositos.find((d) => d.id === depositoId)?.nombre;

  async function refrescar(varianteId: string, dep: string) {
    const r = await variantesPorIdAction({ ids: [varianteId], depositoId: dep });
    if (r.ok && r.data[0]) setVariante(r.data[0]);
  }

  async function aplicar() {
    if (!variante) return;
    setEnviando(true);
    const r = await ajusteAction({
      depositoId,
      varianteId: variante.id,
      cantidadReal: real,
      motivo,
    });
    setEnviando(false);
    setConfirmando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudo ajustar", r.error.message);
      return;
    }
    toast.success(
      "Stock ajustado",
      `${r.data.nombre} en ${deposito}: ${r.data.stockAnterior} → ${r.data.cantidadReal} (${conSigno(r.data.diferencia)})`,
    );
    setReal("");
    setMotivo("");
    await refrescar(variante.id, depositoId);
  }

  return (
    <>
      <PageHeader
        title="Ajuste simple"
        subtitle="Contá cuántas hay en realidad: el sistema ajusta la diferencia."
      />
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col gap-4">
          <Select
            label="Depósito"
            options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
            value={depositoId}
            onChange={(e) => {
              setDepositoId(e.target.value);
              if (variante) void refrescar(variante.id, e.target.value);
            }}
          />
          {variante ? (
            <div className="border-primary bg-primary-soft flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-primary-soft-foreground font-medium">
                  {variante.nombreCompleto}
                </p>
                <p className="text-muted text-xs">{variante.sku}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setVariante(null)}
                aria-label="Elegir otro producto"
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="picker-ajuste" className="text-sm font-medium">
                Producto
              </label>
              <VariantePicker
                id="picker-ajuste"
                depositoId={depositoId}
                onSelect={setVariante}
                autoFocus
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-muted text-xs">Stock en sistema</p>
              <p className="text-3xl font-semibold tabular-nums">{variante ? sistema : "—"}</p>
            </div>
            <Input
              label="Conteo real"
              inputMode="numeric"
              pattern="[0-9]*"
              value={real}
              onChange={(e) => setReal(e.target.value.replace(/\D/g, ""))}
              disabled={!variante}
              error={errores.cantidadReal}
              className="text-2xl font-semibold tabular-nums"
            />
          </div>
          <Textarea
            label="Motivo"
            required
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            error={errores.motivo}
            hint="Obligatorio (mínimo 5 caracteres)."
          />
          <Button
            className="self-end"
            onClick={() => {
              setErrores({});
              setConfirmando(true);
            }}
            disabled={!variante || diferencia === null || diferencia === 0}
          >
            Revisar ajuste
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={confirmando}
        onOpenChange={setConfirmando}
        title="Confirmar ajuste"
        description={`${variante?.nombreCompleto} · ${deposito}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={aplicar} loading={enviando}>
              Aplicar ajuste
            </Button>
          </>
        }
      >
        {diferencia !== null && (
          <p className="bg-surface-2 rounded-lg p-3 text-center text-lg tabular-nums">
            {sistema} → <strong>{real}</strong>{" "}
            <span className={diferencia > 0 ? "text-success" : "text-danger"}>
              ({conSigno(diferencia)})
            </span>
          </p>
        )}
        <p className="text-muted text-sm">Motivo: {motivo || "—"}</p>
      </Dialog>
    </>
  );
}
