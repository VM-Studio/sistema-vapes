"use client";

import { PackagePlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { VariantePicker, type VarianteBuscada } from "@/components/catalogo/variante-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { BotonCamara } from "@/features/scanner/BotonCamara";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";

import { ingresoManualAction, variantesPorIdAction } from "../actions";

interface Item {
  variante: VarianteBuscada;
  cantidad: string;
  costo: string;
}

const soloEntero = (s: string) => s.replace(/\D/g, "");
const soloDecimal = (s: string) => s.replace(/[^\d.,]/g, "");

export function IngresoForm({
  depositos,
  depositoInicial,
  precargadas,
}: {
  depositos: { id: string; nombre: string }[];
  depositoInicial: string;
  precargadas: VarianteBuscada[];
}) {
  const toast = useToast();
  const [depositoId, setDepositoId] = useState(depositoInicial);
  const [items, setItems] = useState<Item[]>(
    precargadas.map((v) => ({ variante: v, cantidad: "", costo: "" })),
  );
  const [motivo, setMotivo] = useState(precargadas.length ? "Stock inicial" : "");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [preguntarCosto, setPreguntarCosto] = useState<Item[] | null>(null);
  const [ultimo, setUltimo] = useState<{ unidades: number; deposito: string } | null>(null);

  const ids = useMemo(() => new Set(items.map((i) => i.variante.id)), [items]);
  const unidades = items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0);

  function agregar(v: VarianteBuscada) {
    setUltimo(null);
    setItems((its) =>
      its.some((i) => i.variante.id === v.id)
        ? // Escaneo repetido = una unidad más.
          its.map((i) =>
            i.variante.id === v.id ? { ...i, cantidad: String((Number(i.cantidad) || 0) + 1) } : i,
          )
        : [...its, { variante: v, cantidad: "1", costo: "" }],
    );
  }

  // Pistola (global), cámara o ?agregar=<id> al volver de crear un producto: +1 por escaneo.
  const escaner = useEscanerVariantes({
    onVariante: (v) => void agregarPorId(v.varianteId),
    permitirRafaga: true,
    tituloCamara: "Escanear ingreso",
  });
  async function agregarPorId(id: string) {
    const r = await variantesPorIdAction({ ids: [id], depositoId });
    if (r.ok && r.data[0]) agregar(r.data[0]);
  }

  async function cambiarDeposito(id: string) {
    setDepositoId(id);
    if (items.length === 0) return;
    const r = await variantesPorIdAction({ ids: items.map((i) => i.variante.id), depositoId: id });
    if (r.ok) {
      const porId = new Map(r.data.map((v) => [v.id, v]));
      setItems((its) =>
        its.map((i) => ({ ...i, variante: porId.get(i.variante.id) ?? i.variante })),
      );
    }
  }

  const actualizarItem = (id: string, cambios: Partial<Item>) =>
    setItems((its) => its.map((i) => (i.variante.id === id ? { ...i, ...cambios } : i)));

  const costoNum = (s: string) => Number(s.replace(",", "."));

  function revisar() {
    setErrores({});
    const conCostoDistinto = items.filter(
      (i) => i.costo.trim() !== "" && costoNum(i.costo) !== Number(i.variante.precioCosto),
    );
    if (conCostoDistinto.length > 0) setPreguntarCosto(conCostoDistinto);
    else void enviar(false);
  }

  async function enviar(actualizarCosto: boolean) {
    setPreguntarCosto(null);
    setEnviando(true);
    const r = await ingresoManualAction({
      depositoId,
      motivo,
      actualizarCosto,
      items: items.map((i) => ({
        varianteId: i.variante.id,
        cantidad: i.cantidad,
        costoUnitario: i.costo.replace(",", "."),
      })),
    });
    setEnviando(false);
    if (!r.ok) {
      const campos = Object.fromEntries(
        Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""]),
      );
      setErrores(campos);
      if (!r.error.fields) toast.error("No se pudo registrar el ingreso", r.error.message);
      return;
    }
    invalidarResoluciones(); // el stock cambió: el escáner no debe mostrar el viejo
    const deposito = depositos.find((d) => d.id === depositoId)?.nombre ?? "";
    toast.success(
      `Ingresaron ${formatearNumero(r.data.unidades)} unidades a ${deposito}`,
      r.data.costosActualizados
        ? `Se actualizó el costo de ${r.data.costosActualizados} producto(s).`
        : undefined,
    );
    setUltimo({ unidades: r.data.unidades, deposito });
    setItems([]);
    setMotivo("");
  }

  const errorItem = (i: number, campo: string) => errores[`items.${i}.${campo}`];

  return (
    <>
      <PageHeader
        title="Ingreso manual"
        subtitle="Carga inicial o mercadería que entra sin compra a proveedor"
      />
      <div className="flex flex-col gap-4 pb-28 md:pb-0">
        {ultimo && (
          <div
            className="bg-success-soft text-success-soft-foreground flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm"
            role="status"
          >
            <span>
              Listo: {formatearNumero(ultimo.unidades)} unidades ingresaron a {ultimo.deposito}.
            </span>
            <Link href="/inventario" className="font-medium underline">
              Ver inventario
            </Link>
          </div>
        )}
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <Select
              label="Depósito"
              options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
              value={depositoId}
              onChange={(e) => void cambiarDeposito(e.target.value)}
              error={errores.depositoId}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="picker-ingreso" className="text-sm font-medium">
                Agregar producto
              </label>
              <div className="flex gap-2">
                <VariantePicker
                  id="picker-ingreso"
                  className="flex-1"
                  depositoId={depositoId}
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
          <EmptyState
            icon={PackagePlus}
            title="Todavía no agregaste productos"
            description="Buscá por nombre, sabor, SKU o código de barras. Escanear el mismo código otra vez suma una unidad."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Productos a ingresar">
            {items.map((it, i) => (
              <li
                key={it.variante.id}
                className="border-border bg-surface grid grid-cols-2 items-start gap-3 rounded-xl border p-3 md:grid-cols-[1fr_7rem_9rem_auto] md:items-center"
              >
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <p className="font-medium">{it.variante.nombreCompleto}</p>
                  <p className="text-muted text-xs">
                    {it.variante.sku} · en depósito:{" "}
                    <strong className="tabular-nums">{it.variante.stockDeposito ?? 0}</strong>
                  </p>
                </div>
                <label className="text-muted flex flex-col gap-1 text-xs">
                  Cantidad
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={`Cantidad de ${it.variante.nombreCompleto}`}
                    value={it.cantidad}
                    onChange={(e) =>
                      actualizarItem(it.variante.id, { cantidad: soloEntero(e.target.value) })
                    }
                    aria-invalid={errorItem(i, "cantidad") ? true : undefined}
                    className={cn(
                      controlClass,
                      "h-11 text-right text-base font-semibold tabular-nums",
                    )}
                  />
                  {errorItem(i, "cantidad") && (
                    <span className="text-danger">{errorItem(i, "cantidad")}</span>
                  )}
                </label>
                <label className="text-muted flex flex-col gap-1 text-xs">
                  Costo unitario
                  <input
                    inputMode="decimal"
                    aria-label={`Costo unitario de ${it.variante.nombreCompleto}`}
                    placeholder={formatearPesos(it.variante.precioCosto)}
                    value={it.costo}
                    onChange={(e) =>
                      actualizarItem(it.variante.id, { costo: soloDecimal(e.target.value) })
                    }
                    aria-invalid={errorItem(i, "costoUnitario") ? true : undefined}
                    className={cn(controlClass, "h-11 text-right tabular-nums")}
                  />
                  {errorItem(i, "costoUnitario") && (
                    <span className="text-danger">{errorItem(i, "costoUnitario")}</span>
                  )}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-danger col-span-2 justify-self-end md:col-span-1"
                  onClick={() =>
                    setItems((its) => its.filter((x) => x.variante.id !== it.variante.id))
                  }
                  aria-label={`Quitar ${it.variante.nombreCompleto}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {errores.items && <p className="text-danger text-sm">{errores.items}</p>}

        <Textarea
          label="Motivo"
          required
          rows={2}
          placeholder="Ej: stock inicial, mercadería sin factura…"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errores.motivo}
        />

        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t px-4 py-3 backdrop-blur md:static md:justify-end md:border-0 md:bg-transparent md:p-0">
          <p className="text-muted flex-1 text-sm md:flex-none">
            <strong className="text-foreground tabular-nums">{items.length}</strong> productos ·{" "}
            <strong className="text-foreground tabular-nums">{formatearNumero(unidades)}</strong>{" "}
            unidades
          </p>
          <Button onClick={revisar} loading={enviando} disabled={items.length === 0}>
            Registrar ingreso
          </Button>
        </div>
      </div>

      {escaner.ui}
      <Dialog
        open={preguntarCosto !== null}
        onOpenChange={(o) => !o && setPreguntarCosto(null)}
        title="¿Actualizar el precio de costo?"
        description="Estos productos entraron con un costo distinto al que tienen cargado:"
        footer={
          <>
            <Button variant="secondary" onClick={() => void enviar(false)}>
              No, solo este ingreso
            </Button>
            <Button onClick={() => void enviar(true)}>Sí, actualizar costo</Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1.5 text-sm">
          {preguntarCosto?.map((i) => (
            <li key={i.variante.id} className="flex justify-between gap-3">
              <span className="truncate">{i.variante.nombreCompleto}</span>
              <span className="shrink-0 tabular-nums">
                {formatearPesos(i.variante.precioCosto)} →{" "}
                <strong>{formatearPesos(costoNum(i.costo))}</strong>
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
