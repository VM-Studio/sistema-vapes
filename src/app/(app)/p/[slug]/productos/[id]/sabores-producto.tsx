"use client";

import { Modulo } from "@prisma/client";
import { Barcode, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EstadoStockBadge } from "@/components/catalogo/estado-stock-badge";
import { usePuede, useUsuario } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { esOwner } from "@/lib/permisos";
import { cn } from "@/lib/utils";
import type { DepositoBasico } from "@/server/services/deposito.service";
import type { ProductoDetalle, SaborDetalle } from "@/server/services/producto.service";

import {
  agregarCodigoAlternativoAction,
  asignarCodigoInternoAction,
  quitarCodigoAlternativoAction,
} from "../actions";

/** Sabores del producto con su código, precio efectivo y stock por galpón. */
export function SaboresProducto({
  producto,
  depositos,
}: {
  producto: ProductoDetalle;
  depositos: DepositoBasico[];
}) {
  const puedeEditar = usePuede(Modulo.PRODUCTOS, "editar");
  // Último costo: solo dueños (a un empleado el servidor ni se lo manda).
  const verCosto = esOwner(useUsuario());
  const [codigos, setCodigos] = useState<SaborDetalle | null>(null);
  const titulo = (s: SaborDetalle) => s.sabor ?? producto.nombreCompleto;

  const codigo = (s: SaborDetalle) =>
    s.codigoBarras ? (
      <span className="inline-flex items-center gap-0.5 font-mono text-xs">
        {s.codigoBarras}
        <CopyButton valor={s.codigoBarras} etiqueta="Copiar código" />
      </span>
    ) : puedeEditar ? (
      <GenerarCodigo varianteId={s.id} nombre={titulo(s)} />
    ) : (
      <span className="text-muted">—</span>
    );

  const precio = (s: SaborDetalle) => (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {formatearPesos(s.precioVenta)}
      {s.tienePrecioPropio && <Badge variant="primary">propio</Badge>}
    </span>
  );

  return (
    <section aria-labelledby="sabores">
      <h2 id="sabores" className="mb-3 text-lg font-semibold">
        {producto.sinSabores ? "Stock" : `Sabores (${producto.sabores.length})`}
      </h2>

      {/* Desktop */}
      <div className="border-border bg-surface hidden overflow-x-auto rounded-2xl border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Sabores</caption>
          <thead className="border-border bg-surface-2/60 text-muted border-b text-xs tracking-wide uppercase">
            <tr>
              <th className="px-3 py-3 text-left font-medium">Sabor</th>
              <th className="px-3 py-3 text-left font-medium">Código</th>
              <th className="px-3 py-3 text-right font-medium">Precio</th>
              {verCosto && <th className="px-3 py-3 text-right font-medium">Último costo</th>}
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
            {producto.sabores.map((s) => (
              <tr key={s.id} aria-label={titulo(s)} className={cn(!s.activo && "text-muted")}>
                <td className="px-3 py-2.5 font-medium">
                  {titulo(s)}
                  {s.codigosAlternativos.length > 0 && (
                    <span className="text-muted block text-xs font-normal">
                      +{s.codigosAlternativos.length} código(s) alternativo(s)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{codigo(s)}</td>
                <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  {precio(s)}
                </td>
                {verCosto && (
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.ultimoCosto === null ? "—" : formatearPesos(s.ultimoCosto)}
                  </td>
                )}
                {depositos.map((d) => (
                  <td
                    key={d.id}
                    data-deposito={d.nombre}
                    className="px-3 py-2.5 text-right tabular-nums"
                  >
                    {s.stockPorDeposito[d.id] ?? 0}
                  </td>
                ))}
                <td
                  data-deposito="Total"
                  className="px-3 py-2.5 text-right font-semibold tabular-nums"
                >
                  {s.stockTotal}
                </td>
                <td className="text-muted px-3 py-2.5 text-right tabular-nums">{s.stockMinimo}</td>
                <td className="px-3 py-2.5">
                  {s.activo ? <EstadoStockBadge estado={s.estado} /> : <Badge>Inactivo</Badge>}
                </td>
                {puedeEditar && (
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setCodigos(s)}
                      aria-label={`Códigos de ${titulo(s)}`}
                      title="Códigos de barras"
                    >
                      <Barcode strokeWidth={1.75} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 md:hidden">
        {producto.sabores.map((s) => (
          <li key={s.id} className="border-border bg-surface rounded-2xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{titulo(s)}</p>
                <div className="mt-0.5">{codigo(s)}</div>
                <p className="mt-1 text-sm">{precio(s)}</p>
                {verCosto && s.ultimoCosto !== null && (
                  <p className="text-muted text-xs">Último costo {formatearPesos(s.ultimoCosto)}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">{s.stockTotal}</p>
                {s.activo ? <EstadoStockBadge estado={s.estado} /> : <Badge>Inactivo</Badge>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {depositos.map((d) => (
                <span key={d.id} className="bg-surface-2 rounded-full px-2.5 py-1 text-xs">
                  {d.nombre}{" "}
                  <strong className="tabular-nums">{s.stockPorDeposito[d.id] ?? 0}</strong>
                </span>
              ))}
              <span className="bg-surface-2 text-muted rounded-full px-2.5 py-1 text-xs">
                mín. {s.stockMinimo}
              </span>
            </div>
            {puedeEditar && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setCodigos(s)}
              >
                <Barcode strokeWidth={1.75} /> Códigos ({s.codigosAlternativos.length + 1})
              </Button>
            )}
          </li>
        ))}
      </ul>

      <CodigosDialog
        key={codigos?.id}
        sabor={codigos}
        titulo={codigos ? titulo(codigos) : ""}
        onClose={() => setCodigos(null)}
      />
    </section>
  );
}

function CodigosDialog({
  sabor,
  titulo,
  onClose,
}: {
  sabor: SaborDetalle | null;
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
    if (!sabor) return;
    setEnviando(true);
    const r = await agregarCodigoAlternativoAction({ varianteId: sabor.id, codigo, descripcion });
    setEnviando(false);
    if (!r.ok) return setError(r.error.fields?.codigo?.[0] ?? r.error.message);
    toast.success(`Código ${r.data.codigo} agregado`);
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
      open={sabor !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Códigos de barras"
      description={`${titulo}. Un mismo producto puede venir con otro código según el lote o el importador.`}
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
        <li className="bg-surface-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2">
          <span className="font-mono">{sabor?.codigoBarras ?? "Sin código principal"}</span>
          <Badge variant="primary">Principal</Badge>
        </li>
        {sabor?.codigosAlternativos.map((c) => (
          <li
            key={c.id}
            className="border-border flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5"
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
              <Trash2 strokeWidth={1.75} />
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

/** Sabor sin código: le asigna un código interno (Code128) para poder etiquetarlo. */
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
      <Barcode strokeWidth={1.75} /> Generar
    </Button>
  );
}
