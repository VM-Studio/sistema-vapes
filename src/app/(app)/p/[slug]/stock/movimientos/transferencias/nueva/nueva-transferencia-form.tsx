"use client";

import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { VariantePicker } from "@/components/catalogo/variante-picker";
import type { VarianteEncontrada } from "@/features/scanner/tipos";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { cn } from "@/lib/utils";

import { crearTransferenciaAction, variantesPorIdAction } from "../../actions";

interface Item {
  variante: VarianteEncontrada;
  cantidad: string;
}

export function NuevaTransferenciaForm({
  depositos,
  origenInicial,
  destinoInicial,
  precargadas,
}: {
  depositos: { id: string; nombre: string }[];
  origenInicial: string;
  destinoInicial: string;
  precargadas: VarianteEncontrada[];
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();
  const [origen, setOrigen] = useState(origenInicial);
  const [destino, setDestino] = useState(destinoInicial);
  const [items, setItems] = useState<Item[]>(
    precargadas.map((v) => ({ variante: v, cantidad: "" })),
  );
  const [notas, setNotas] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const ids = useMemo(() => new Set(items.map((i) => i.variante.varianteId)), [items]);

  async function cambiarOrigen(id: string) {
    setOrigen(id);
    if (id === destino) setDestino(depositos.find((d) => d.id !== id)?.id ?? "");
    if (items.length === 0) return;
    const r = await variantesPorIdAction({
      ids: items.map((i) => i.variante.varianteId),
      depositoId: id,
    });
    if (r.ok) {
      const porId = new Map(r.data.map((v) => [v.varianteId, v]));
      setItems((its) =>
        its.map((i) => ({ ...i, variante: porId.get(i.variante.varianteId) ?? i.variante })),
      );
    }
  }

  function agregar(v: VarianteEncontrada) {
    setItems((its) =>
      its.some((i) => i.variante.varianteId === v.varianteId)
        ? its.map((i) =>
            i.variante.varianteId === v.varianteId
              ? { ...i, cantidad: String((Number(i.cantidad) || 0) + 1) }
              : i,
          )
        : [...its, { variante: v, cantidad: "1" }],
    );
  }

  // Escanear = +1; solo productos con stock en el origen (el error se avisa con sonido).
  const escaner = useEscanerVariantes({
    onVariante: (v) => void agregarPorId(v.varianteId),
    validar: (v) => {
      const enOrigen = v.stockPorDeposito.find((s) => s.depositoId === origen)?.cantidad ?? 0;
      const yaCargadas =
        Number(items.find((i) => i.variante.varianteId === v.varianteId)?.cantidad) || 0;
      if (enOrigen <= 0) return `Sin stock en ${depositos.find((d) => d.id === origen)?.nombre}`;
      if (yaCargadas >= enOrigen)
        return `Solo hay ${enOrigen} en ${depositos.find((d) => d.id === origen)?.nombre}`;
      return null;
    },
    permitirRafaga: true,
    tituloCamara: "Escanear para transferir",
  });
  async function agregarPorId(id: string) {
    const r = await variantesPorIdAction({ ids: [id], depositoId: origen });
    if (r.ok && r.data[0]) agregar(r.data[0]);
  }

  async function crear() {
    setEnviando(true);
    setErrores({});
    const r = await crearTransferenciaAction({
      depositoOrigenId: origen,
      depositoDestinoId: destino,
      notas,
      items: items.map((i) => ({ varianteId: i.variante.varianteId, cantidad: i.cantidad })),
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudo crear la transferencia", r.error.message);
      return;
    }
    toast.success(
      `Transferencia #${r.data.numero} creada`,
      "Queda pendiente hasta que la completes.",
    );
    router.push(ruta(`/stock/movimientos/transferencias/${r.data.id}`));
  }

  return (
    <>
      <PageHeader
        title="Nueva transferencia"
        subtitle="Se crea pendiente: el stock se mueve recién al completarla."
      />
      <div className="flex flex-col gap-4 pb-28 md:pb-0">
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Select
              label="Origen"
              options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
              value={origen}
              onChange={(e) => void cambiarOrigen(e.target.value)}
            />
            <Select
              label="Destino"
              options={depositos
                .filter((d) => d.id !== origen)
                .map((d) => ({ value: d.id, label: d.nombre }))}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              error={errores.depositoDestinoId}
            />
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="picker-transf" className="text-sm font-medium">
                Agregar producto (con stock en el origen)
              </label>
              <div className="flex gap-2">
                <VariantePicker
                  id="picker-transf"
                  className="flex-1"
                  depositoId={origen}
                  soloConStock
                  yaAgregadas={ids}
                  onSelect={agregar}
                  autoFocus={precargadas.length === 0}
                />
                <BotonCamara onClick={escaner.abrirCamara} />
              </div>
            </div>
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="Agregá los productos a transferir" />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Productos a transferir">
            {items.map((it, i) => {
              const disponible = it.variante.stockEnDeposito ?? 0;
              const excede = Number(it.cantidad) > disponible;
              const error = errores[`items.${i}.cantidad`];
              return (
                <li
                  key={it.variante.varianteId}
                  className={cn(
                    "bg-surface flex items-center gap-3 rounded-2xl border p-3",
                    excede ? "border-danger/50" : "border-border",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{it.variante.titulo}</p>
                    <p className={cn("text-xs", excede ? "text-danger" : "text-muted")}>
                      Disponible en origen: <strong className="tabular-nums">{disponible}</strong>
                      {excede && " — no alcanza"}
                    </p>
                    {error && <p className="text-danger text-xs">{error}</p>}
                  </div>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={`Cantidad de ${it.variante.titulo}`}
                    value={it.cantidad}
                    onChange={(e) =>
                      setItems((its) =>
                        its.map((x) =>
                          x.variante.varianteId === it.variante.varianteId
                            ? { ...x, cantidad: e.target.value.replace(/\D/g, "") }
                            : x,
                        ),
                      )
                    }
                    className={cn(
                      controlClass,
                      "h-11 w-20 text-right text-base font-semibold tabular-nums",
                    )}
                    aria-invalid={excede || error ? true : undefined}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-danger"
                    onClick={() =>
                      setItems((its) =>
                        its.filter((x) => x.variante.varianteId !== it.variante.varianteId),
                      )
                    }
                    aria-label={`Quitar ${it.variante.titulo}`}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {errores.items && <p className="text-danger text-sm">{errores.items}</p>}
        <Textarea
          label="Notas"
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Opcional"
        />
        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex justify-end border-t px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <Button
            onClick={crear}
            loading={enviando}
            disabled={items.length === 0 || !destino}
            className="w-full md:w-auto"
          >
            Crear transferencia
          </Button>
        </div>
      </div>
      {escaner.ui}
    </>
  );
}
