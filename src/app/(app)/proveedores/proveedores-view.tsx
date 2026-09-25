"use client";

import { Modulo } from "@prisma/client";
import { Pencil, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProveedorForm } from "@/components/compras/proveedor-form";
import { usePuede } from "@/components/layout/usuario-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { formatearPesos } from "@/lib/format";
import { formatearCuit } from "@/lib/validations/proveedor";
import { formatearFecha } from "@/lib/utils";
import type { ProveedorListado } from "@/server/services/proveedor.service";

const FORM_ID = "form-proveedor";

export function ProveedoresView({ proveedores }: { proveedores: ProveedorListado[] }) {
  const router = useRouter();
  const puedeCrear = usePuede(Modulo.PROVEEDORES, "crear");
  const puedeEditar = usePuede(Modulo.PROVEEDORES, "editar");
  const [editando, setEditando] = useState<ProveedorListado | "nuevo" | null>(null);
  const [enviando, setEnviando] = useState(false);

  const nombre = (p: ProveedorListado) => (
    <span className="flex items-center gap-2">
      <Link href={`/proveedores/${p.id}`} className="text-primary font-medium hover:underline">
        {p.nombre}
      </Link>
      {!p.activo && <Badge variant="neutral">Inactivo</Badge>}
    </span>
  );
  const botonEditar = (p: ProveedorListado) =>
    puedeEditar && (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setEditando(p)}
        aria-label={`Editar ${p.nombre}`}
      >
        <Pencil />
      </Button>
    );

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="Importadores y mayoristas a los que les comprás."
        actions={
          puedeCrear && (
            <Button onClick={() => setEditando("nuevo")}>
              <Plus /> Nuevo proveedor
            </Button>
          )
        }
      />
      <SearchInput placeholder="Buscar por nombre o CUIT" className="mb-4" />
      <DataTable
        caption="Proveedores"
        rows={proveedores}
        getRowKey={(p) => p.id}
        empty={<EmptyState icon={Truck} title="No hay proveedores" />}
        columns={[
          { key: "nombre", header: "Nombre", cell: nombre },
          {
            key: "cuit",
            header: "CUIT",
            cell: (p) => (
              <span className="tabular-nums">{p.cuit ? formatearCuit(p.cuit) : "—"}</span>
            ),
          },
          {
            key: "contacto",
            header: "Contacto",
            cell: (p) => (
              <span className="text-muted">
                {[p.telefono, p.email].filter(Boolean).join(" · ") || "—"}
              </span>
            ),
          },
          {
            key: "compras",
            header: "Compras",
            className: "text-right tabular-nums",
            cell: (p) => p.compras,
          },
          {
            key: "total",
            header: "Total comprado",
            className: "text-right tabular-nums",
            cell: (p) => formatearPesos(p.totalComprado),
          },
          {
            key: "ultima",
            header: "Última",
            cell: (p) => (
              <span className="text-muted">
                {p.ultimaCompra ? formatearFecha(p.ultimaCompra) : "—"}
              </span>
            ),
          },
          {
            key: "acciones",
            header: <span className="sr-only">Acciones</span>,
            className: "w-px",
            cell: botonEditar,
          },
        ]}
        renderMobile={(p) => (
          <div className="border-border bg-surface flex items-start justify-between gap-3 rounded-xl border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              {nombre(p)}
              <span className="text-muted text-sm">
                {p.cuit ? `CUIT ${formatearCuit(p.cuit)}` : "Sin CUIT"}
              </span>
              <span className="text-sm">
                {p.compras} compras ·{" "}
                <strong className="tabular-nums">{formatearPesos(p.totalComprado)}</strong>
              </span>
            </div>
            {botonEditar(p)}
          </div>
        )}
      />
      <Sheet
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
        title={editando === "nuevo" ? "Nuevo proveedor" : "Editar proveedor"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditando(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form={FORM_ID} loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {editando !== null && (
          <ProveedorForm
            key={editando === "nuevo" ? "nuevo" : editando.id}
            formId={FORM_ID}
            proveedor={editando === "nuevo" ? null : editando}
            onEnviando={setEnviando}
            onListo={() => {
              setEditando(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>
    </>
  );
}
