"use client";

import { Modulo } from "@prisma/client";
import { Plus, Trash2, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { VariantePicker } from "@/components/catalogo/variante-picker";
import { ProveedorForm } from "@/components/compras/proveedor-form";
import { usePuede } from "@/components/layout/usuario-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { ScanInput } from "@/features/scanner/ScanInput";
import { useEscanerVariantes } from "@/features/scanner/useEscanerVariantes";
import { hoyAR } from "@/lib/fechas";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";

import { guardarCompraAction } from "./actions";

export interface ItemCompraForm {
  varianteId: string;
  nombre: string;
  sku: string;
  /** Costo actual cargado en el sistema (para comparar). */
  precioCostoActual: string | null;
  cantidad: string;
  costo: string;
}

export interface CompraInicial {
  id: string | null;
  numero?: number;
  proveedorId: string;
  depositoId: string;
  fecha: string;
  descuento: string;
  notas: string;
  items: ItemCompraForm[];
}

const num = (s: string) => Number(s.replace(",", ".")) || 0;
const soloEntero = (s: string) => s.replace(/\D/g, "");
const soloDecimal = (s: string) => s.replace(/[^\d.,]/g, "");

export function CompraForm({
  inicial,
  proveedores: proveedoresIniciales,
  depositos,
}: {
  inicial: CompraInicial;
  proveedores: { id: string; nombre: string }[];
  depositos: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const puedeRecibir = usePuede(Modulo.COMPRAS, "editar");
  const puedeCrearProveedor = usePuede(Modulo.PROVEEDORES, "crear");
  const [proveedores, setProveedores] = useState(proveedoresIniciales);
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId);
  const [depositoId, setDepositoId] = useState(inicial.depositoId);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [descuento, setDescuento] = useState(inicial.descuento);
  const [notas, setNotas] = useState(inicial.notas);
  const [items, setItems] = useState<ItemCompraForm[]>(inicial.items);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<"borrador" | "recibir" | null>(null);
  const [confirmarRecibir, setConfirmarRecibir] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [creandoProveedor, setCreandoProveedor] = useState(false);

  function agregar(v: { id: string; nombre: string; sku: string; precioCosto: string | null }) {
    setItems((its) =>
      its.some((i) => i.varianteId === v.id)
        ? its.map((i) =>
            i.varianteId === v.id ? { ...i, cantidad: String(num(i.cantidad) + 1) } : i,
          )
        : [
            ...its,
            {
              varianteId: v.id,
              nombre: v.nombre,
              sku: v.sku,
              precioCostoActual: v.precioCosto,
              cantidad: "1",
              costo: v.precioCosto ? String(Number(v.precioCosto)) : "",
            },
          ],
    );
  }

  // Escáner activo: pistola, cámara o manual.
  const escaner = useEscanerVariantes({
    onVariante: (v) =>
      agregar({
        id: v.varianteId,
        nombre: v.nombreCompleto,
        sku: v.sku,
        precioCosto: v.precioCosto,
      }),
    permitirRafaga: true,
    tituloCamara: "Escanear mercadería",
  });

  const ids = useMemo(() => new Set(items.map((i) => i.varianteId)), [items]);
  const subtotal = items.reduce((a, i) => a + num(i.cantidad) * num(i.costo), 0);
  const total = subtotal - num(descuento);
  const unidades = items.reduce((a, i) => a + num(i.cantidad), 0);
  const cambiosDeCosto = items.filter(
    (i) =>
      i.precioCostoActual !== null &&
      i.costo !== "" &&
      num(i.costo) !== Number(i.precioCostoActual),
  );
  const actualizar = (id: string, cambios: Partial<ItemCompraForm>) =>
    setItems((its) => its.map((i) => (i.varianteId === id ? { ...i, ...cambios } : i)));

  async function guardar(recibir: boolean, actualizarCostos = false) {
    setEnviando(recibir ? "recibir" : "borrador");
    setErrores({});
    const r = await guardarCompraAction({
      id: inicial.id ?? undefined,
      recibir,
      actualizarCostos,
      datos: {
        proveedorId,
        depositoId,
        fecha,
        descuento,
        notas,
        items: items.map((i) => ({
          varianteId: i.varianteId,
          cantidad: i.cantidad,
          costoUnitario: i.costo.replace(",", "."),
        })),
      },
    });
    setEnviando(null);
    setConfirmarRecibir(false);
    if (!r.ok) {
      const campos = Object.fromEntries(
        Object.entries(r.error.fields ?? {}).map(([k, v]) => [
          k.replace(/^datos\./, ""),
          v[0] ?? "",
        ]),
      );
      setErrores(campos);
      // Siempre un aviso: puede haber errores en campos que no están a la vista (o no son campos).
      toast.error(
        "No se pudo guardar la compra",
        r.error.fields ? "Revisá los datos marcados." : r.error.message,
      );
      return;
    }
    if (r.data.errorAlRecibir) {
      toast.error(
        `Compra #${r.data.numero} guardada, pero no se pudo recibir`,
        r.data.errorAlRecibir,
      );
    } else if (r.data.recibida) {
      invalidarResoluciones();
      toast.success(
        `Compra #${r.data.numero} recibida`,
        `Ingresaron ${formatearNumero(r.data.recibida.unidades)} unidades${r.data.recibida.costosActualizados ? ` · ${r.data.recibida.costosActualizados} costo(s) actualizado(s)` : ""}.`,
      );
    } else {
      toast.success(`Compra #${r.data.numero} guardada como borrador`);
    }
    router.push(`/compras/${r.data.id}`);
  }

  const errorItem = (i: number, campo: string) => errores[`items.${i}.${campo}`];

  return (
    <>
      <PageHeader
        title={inicial.id ? `Editar compra #${inicial.numero}` : "Nueva compra"}
        subtitle="Escaneá la mercadería que llegó (pistola o cámara) o buscala a mano."
      />
      <div className="flex flex-col gap-4 pb-40 md:pb-0">
        <Card>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Select
                label="Proveedor"
                options={[
                  { value: "", label: "Sin proveedor" },
                  ...proveedores.map((p) => ({ value: p.id, label: p.nombre })),
                ]}
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                error={errores.proveedorId}
              />
              {puedeCrearProveedor && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary self-start"
                  onClick={() => setNuevoProveedor(true)}
                >
                  <Plus /> Nuevo proveedor
                </Button>
              )}
            </div>
            <Select
              label="Depósito destino"
              options={depositos.map((d) => ({ value: d.id, label: d.nombre }))}
              value={depositoId}
              onChange={(e) => setDepositoId(e.target.value)}
              error={errores.depositoId}
            />
            <Input
              label="Fecha"
              type="date"
              value={fecha}
              max={hoyAR()}
              onChange={(e) => setFecha(e.target.value)}
              error={errores.fecha}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <ScanInput
              onScan={(c, m) => void escaner.procesar(c, m.fuente)}
              onAbrirCamara={escaner.abrirCamara}
              inputRef={escaner.inputRef}
              autoFocus={false}
            />
            <VariantePicker
              placeholder="…o buscá por nombre, sabor o SKU"
              yaAgregadas={ids}
              onSelect={(v) =>
                agregar({
                  id: v.id,
                  nombre: v.nombreCompleto,
                  sku: v.sku,
                  precioCosto: v.precioCosto,
                })
              }
            />
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Todavía no hay productos en la compra"
            description="Cada escaneo repetido suma una unidad."
          />
        ) : (
          <ul aria-label="Ítems de la compra" className="flex flex-col gap-2">
            {items.map((it, i) => {
              const cambia =
                it.precioCostoActual !== null &&
                it.costo !== "" &&
                num(it.costo) !== Number(it.precioCostoActual);
              return (
                <li
                  key={it.varianteId}
                  className="border-border bg-surface grid grid-cols-2 items-start gap-3 rounded-xl border p-3 md:grid-cols-[1fr_6rem_8rem_8rem_auto] md:items-center"
                >
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <p className="font-medium">{it.nombre}</p>
                    <p className="text-muted text-xs">
                      {it.sku}
                      {it.precioCostoActual !== null && (
                        <>
                          {" "}
                          · costo actual {formatearPesos(it.precioCostoActual)}
                          {cambia && (
                            <span className="text-warning-soft-foreground font-semibold">
                              {" "}
                              · cambia
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  <label className="text-muted flex flex-col gap-1 text-xs">
                    Cantidad
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Cantidad de ${it.nombre}`}
                      value={it.cantidad}
                      onChange={(e) =>
                        actualizar(it.varianteId, { cantidad: soloEntero(e.target.value) })
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
                      aria-label={`Costo unitario de ${it.nombre}`}
                      value={it.costo}
                      onChange={(e) =>
                        actualizar(it.varianteId, { costo: soloDecimal(e.target.value) })
                      }
                      aria-invalid={errorItem(i, "costoUnitario") ? true : undefined}
                      className={cn(controlClass, "h-11 text-right tabular-nums")}
                    />
                    {errorItem(i, "costoUnitario") && (
                      <span className="text-danger">{errorItem(i, "costoUnitario")}</span>
                    )}
                  </label>
                  <p className="text-right text-sm md:text-base">
                    <span className="text-muted block text-xs md:hidden">Subtotal</span>
                    <strong className="tabular-nums">
                      {formatearPesos(num(it.cantidad) * num(it.costo))}
                    </strong>
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-danger justify-self-end"
                    onClick={() =>
                      setItems((its) => its.filter((x) => x.varianteId !== it.varianteId))
                    }
                    aria-label={`Quitar ${it.nombre}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {errores.items && <p className="text-danger text-sm">{errores.items}</p>}

        <Card>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_14rem]">
            <Textarea
              label="Notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="N.º de remito o factura, observaciones…"
            />
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Subtotal</span>
                <span className="tabular-nums">{formatearPesos(subtotal)}</span>
              </div>
              <Input
                label="Descuento"
                inputMode="decimal"
                value={descuento}
                onChange={(e) => setDescuento(soloDecimal(e.target.value))}
                error={errores.descuento}
                className="text-right tabular-nums"
              />
              <div className="border-border flex justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatearPesos(total)}</span>
              </div>
              <p className="text-muted text-xs">
                {formatearNumero(unidades)} unidades · el total final lo calcula el sistema
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="border-border bg-surface/95 fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t px-4 py-3 backdrop-blur md:static md:flex md:justify-end md:border-0 md:bg-transparent md:p-0">
          <Button
            variant="secondary"
            onClick={() => void guardar(false)}
            loading={enviando === "borrador"}
            disabled={items.length === 0 || enviando !== null}
            className={cn(!puedeRecibir && "col-span-2")}
          >
            Guardar borrador
          </Button>
          {puedeRecibir && (
            <Button
              onClick={() => setConfirmarRecibir(true)}
              disabled={items.length === 0 || enviando !== null}
            >
              Recibir mercadería
            </Button>
          )}
        </div>
      </div>

      {escaner.ui}

      <Dialog
        open={confirmarRecibir}
        onOpenChange={setConfirmarRecibir}
        title="Recibir mercadería"
        description={`Ingresan ${formatearNumero(unidades)} unidades a ${depositos.find((d) => d.id === depositoId)?.nombre}.`}
        footer={
          cambiosDeCosto.length > 0 ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void guardar(true, false)}
                loading={enviando === "recibir"}
                disabled={enviando !== null}
              >
                Recibir sin actualizar costos
              </Button>
              <Button
                onClick={() => void guardar(true, true)}
                loading={enviando === "recibir"}
                disabled={enviando !== null}
              >
                Recibir y actualizar costos
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setConfirmarRecibir(false)}>
                Volver
              </Button>
              <Button onClick={() => void guardar(true, false)} loading={enviando === "recibir"}>
                Recibir
              </Button>
            </>
          )
        }
      >
        {cambiosDeCosto.length > 0 ? (
          <>
            <p className="text-sm font-medium">
              ¿Actualizar los precios de costo con los de esta compra?
            </p>
            <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-sm">
              {cambiosDeCosto.map((i) => {
                const antes = Number(i.precioCostoActual);
                const despues = num(i.costo);
                const pct = antes > 0 ? ((despues - antes) / antes) * 100 : null;
                return (
                  <li key={i.varianteId} className="flex justify-between gap-3">
                    <span className="truncate">{i.nombre}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatearPesos(antes)} → <strong>{formatearPesos(despues)}</strong>
                      {pct !== null && (
                        <span className={cn("ml-1", pct > 0 ? "text-danger" : "text-success")}>
                          ({pct > 0 ? "+" : ""}
                          {pct.toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="text-muted text-sm">Los costos coinciden con los cargados.</p>
        )}
      </Dialog>

      <Sheet
        open={nuevoProveedor}
        onOpenChange={setNuevoProveedor}
        title="Nuevo proveedor"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setNuevoProveedor(false)}
              disabled={creandoProveedor}
            >
              Cancelar
            </Button>
            <Button type="submit" form="form-proveedor-rapido" loading={creandoProveedor}>
              Crear
            </Button>
          </>
        }
      >
        {nuevoProveedor && (
          <ProveedorForm
            formId="form-proveedor-rapido"
            proveedor={null}
            compacto
            onEnviando={setCreandoProveedor}
            onListo={(p) => {
              setProveedores((ps) => [...ps, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
              setProveedorId(p.id);
              setNuevoProveedor(false);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
