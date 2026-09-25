"use client";

import { Modulo } from "@prisma/client";
import { Barcode, DollarSign, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoDetalle, VarianteDetalle } from "@/server/services/producto.service";

import {
  actualizarPreciosAction,
  agregarCodigoAlternativoAction,
  asignarCodigoInternoAction,
  quitarCodigoAlternativoAction,
} from "../actions";

export function VariantesProducto({
  producto,
  depositos,
}: {
  producto: ProductoDetalle;
  depositos: DepositoBasico[];
}) {
  const puedeEditar = usePuede(Modulo.PRODUCTOS, "editar");
  const [precios, setPrecios] = useState<VarianteDetalle | null>(null);
  const [codigos, setCodigos] = useState<VarianteDetalle | null>(null);
  const titulo = (v: VarianteDetalle) => (producto.tieneVariantes ? v.nombre : producto.nombre);

  const acciones = (v: VarianteDetalle, compacto: boolean) =>
    puedeEditar && (
      <div
        className={cn(
          "flex gap-1",
          compacto ? "border-border mt-3 grid grid-cols-2 border-t pt-3" : "justify-end",
        )}
      >
        <Button
          variant="ghost"
          size={compacto ? "sm" : "icon"}
          onClick={() => setPrecios(v)}
          aria-label={`Editar precios de ${titulo(v)}`}
          title="Editar precios"
        >
          <DollarSign />
          {compacto && "Precios"}
        </Button>
        <Button
          variant="ghost"
          size={compacto ? "sm" : "icon"}
          onClick={() => setCodigos(v)}
          aria-label={`Códigos alternativos de ${titulo(v)}`}
          title="Códigos alternativos"
        >
          <Barcode />
          {compacto && `Códigos (${v.codigosAlternativos.length})`}
        </Button>
      </div>
    );

  const codigo = (v: VarianteDetalle) =>
    v.codigoBarras ? (
      <span className="inline-flex items-center gap-0.5 font-mono text-xs">
        {v.codigoBarras}
        <CopyButton valor={v.codigoBarras} etiqueta="Copiar código" />
      </span>
    ) : puedeEditar ? (
      <GenerarCodigo varianteId={v.id} nombre={titulo(v)} />
    ) : (
      <span className="text-muted">—</span>
    );

  const margen = (v: VarianteDetalle) =>
    v.margen === null ? (
      "—"
    ) : (
      <span
        className={cn(
          v.margen < 0 ? "text-danger" : v.margen < 20 && "text-warning-soft-foreground",
        )}
      >
        {v.margen}%
      </span>
    );

  return (
    <>
      {/* Desktop */}
      <div className="border-border bg-surface hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Variantes</caption>
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              <th className="px-3 py-3 text-left font-medium">
                {producto.tieneVariantes ? "Sabor" : "Producto"}
              </th>
              <th className="px-3 py-3 text-left font-medium">SKU</th>
              <th className="px-3 py-3 text-left font-medium">Código</th>
              <th className="px-3 py-3 text-right font-medium">Costo</th>
              <th className="px-3 py-3 text-right font-medium">Venta</th>
              <th className="px-3 py-3 text-right font-medium">Margen</th>
              {depositos.map((d) => (
                <th key={d.id} className="px-3 py-3 text-right font-medium">
                  {d.nombre}
                </th>
              ))}
              <th className="px-3 py-3 text-right font-medium">Total</th>
              <th className="px-3 py-3 text-right font-medium">Mín.</th>
              <th className="px-3 py-3 text-left font-medium">Estado</th>
              {puedeEditar && (
                <th className="px-3 py-3">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {producto.variantes.map((v) => (
              <tr key={v.id} className={cn(!v.activo && "text-muted")}>
                <td className="px-3 py-2.5 font-medium">
                  {titulo(v)}
                  {v.codigosAlternativos.length > 0 && (
                    <span className="text-muted block text-xs font-normal">
                      +{v.codigosAlternativos.length} código(s) alternativo(s)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{v.sku}</td>
                <td className="px-3 py-2.5">{codigo(v)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatearPesos(v.precioCosto)}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {formatearPesos(v.precioVenta)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{margen(v)}</td>
                {depositos.map((d) => (
                  <td key={d.id} className="px-3 py-2.5 text-right tabular-nums">
                    {v.stockPorDeposito[d.id] ?? 0}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {v.stockTotal}
                </td>
                <td className="text-muted px-3 py-2.5 text-right tabular-nums">{v.stockMinimo}</td>
                <td className="px-3 py-2.5">
                  {v.activo ? <EstadoStockBadge estado={v.estado} /> : <Badge>Inactiva</Badge>}
                </td>
                {puedeEditar && <td className="px-2 py-1.5">{acciones(v, false)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {producto.variantes.map((v) => (
          <li key={v.id} className="border-border bg-surface rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{titulo(v)}</p>
                <p className="text-muted font-mono text-xs">{v.sku}</p>
                <div className="mt-0.5">{codigo(v)}</div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">{v.stockTotal}</p>
                {v.activo ? <EstadoStockBadge estado={v.estado} /> : <Badge>Inactiva</Badge>}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-muted text-xs">Costo</dt>
                <dd className="tabular-nums">{formatearPesos(v.precioCosto)}</dd>
              </div>
              <div>
                <dt className="text-muted text-xs">Venta</dt>
                <dd className="font-semibold tabular-nums">{formatearPesos(v.precioVenta)}</dd>
              </div>
              <div>
                <dt className="text-muted text-xs">Margen</dt>
                <dd className="tabular-nums">{margen(v)}</dd>
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {depositos.map((d) => (
                <span key={d.id} className="bg-surface-2 rounded-full px-2.5 py-1 text-xs">
                  {d.nombre}{" "}
                  <strong className="tabular-nums">{v.stockPorDeposito[d.id] ?? 0}</strong>
                </span>
              ))}
              <span className="bg-surface-2 text-muted rounded-full px-2.5 py-1 text-xs">
                mín. {v.stockMinimo}
              </span>
            </div>
            {acciones(v, true)}
          </li>
        ))}
      </ul>

      <PreciosDialog
        key={`p-${precios?.id}`}
        variante={precios}
        titulo={precios ? titulo(precios) : ""}
        onClose={() => setPrecios(null)}
      />
      <CodigosDialog
        key={`c-${codigos?.id}`}
        variante={codigos}
        titulo={codigos ? titulo(codigos) : ""}
        onClose={() => setCodigos(null)}
      />
    </>
  );
}

function PreciosDialog({
  variante,
  titulo,
  onClose,
}: {
  variante: VarianteDetalle | null;
  titulo: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [costo, setCosto] = useState(variante ? String(Number(variante.precioCosto)) : "");
  const [venta, setVenta] = useState(variante ? String(Number(variante.precioVenta)) : "");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    if (!variante) return;
    setEnviando(true);
    const r = await actualizarPreciosAction({
      varianteIds: [variante.id],
      precioCosto: costo.replace(",", "."),
      precioVenta: venta.replace(",", "."),
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudieron guardar los precios", r.error.message);
      return;
    }
    toast.success(r.data.actualizadas ? "Precios actualizados" : "Los precios no cambiaron");
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open={variante !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Editar precios"
      description={titulo}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={enviando}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Costo"
          inputMode="decimal"
          value={costo}
          onChange={(e) => setCosto(e.target.value.replace(/[^\d.,]/g, ""))}
          error={errores.precioCosto}
        />
        <Input
          label="Venta"
          inputMode="decimal"
          value={venta}
          onChange={(e) => setVenta(e.target.value.replace(/[^\d.,]/g, ""))}
          error={errores.precioVenta}
        />
      </div>
      <Input
        label="Motivo (opcional)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        hint="Queda en el historial de precios."
      />
    </Dialog>
  );
}

function CodigosDialog({
  variante,
  titulo,
  onClose,
}: {
  variante: VarianteDetalle | null;
  titulo: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [codigo, setCodigo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function agregar() {
    if (!variante) return;
    setEnviando(true);
    const r = await agregarCodigoAlternativoAction({
      varianteId: variante.id,
      codigo,
      descripcion,
    });
    setEnviando(false);
    if (!r.ok) return setError(r.error.fields?.codigo?.[0] ?? r.error.message);
    toast.success(`Código ${r.data.codigo} agregado`);
    setCodigo("");
    setDescripcion("");
    setError(undefined);
    onClose();
    router.refresh();
  }

  async function quitar(id: string, c: string) {
    const r = await quitarCodigoAlternativoAction({ id });
    if (!r.ok) return toast.error("No se pudo quitar", r.error.message);
    toast.success(`Código ${c} quitado`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open={variante !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Códigos de barras"
      description={`${titulo}. Un mismo producto puede venir con otro código según el lote o importador.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cerrar
          </Button>
          <Button onClick={agregar} loading={enviando} disabled={!codigo.trim()}>
            Agregar código
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-1.5 text-sm">
        <li className="bg-surface-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
          <span className="font-mono">{variante?.codigoBarras ?? "Sin código principal"}</span>
          <Badge variant="primary">Principal</Badge>
        </li>
        {variante?.codigosAlternativos.map((c) => (
          <li
            key={c.id}
            className="border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5"
          >
            <span className="min-w-0">
              <span className="block font-mono">{c.codigo}</span>
              {c.descripcion && <span className="text-muted block text-xs">{c.descripcion}</span>}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-danger"
              onClick={() => quitar(c.id, c.codigo)}
              aria-label={`Quitar ${c.codigo}`}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          label="Nuevo código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          error={error}
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          label="Descripción (opcional)"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Ej: lote importador B"
        />
      </div>
    </Dialog>
  );
}

/** Variante sin código: le asigna un código interno (Code128) para poder etiquetarla. */
function GenerarCodigo({ varianteId, nombre }: { varianteId: string; nombre: string }) {
  const router = useRouter();
  const toast = useToast();
  const [generando, setGenerando] = useState(false);
  async function generar() {
    setGenerando(true);
    const r = await asignarCodigoInternoAction({ varianteId });
    setGenerando(false);
    if (!r.ok) return toast.error("No se pudo generar el código", r.error.message);
    toast.success(`Código ${r.data.codigo} asignado`, nombre);
    router.refresh();
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-primary -ml-2"
      onClick={() => void generar()}
      loading={generando}
    >
      <Barcode /> Generar
    </Button>
  );
}
