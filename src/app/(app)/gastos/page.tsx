import { Modulo } from "@prisma/client";
import { Receipt } from "lucide-react";
import type { Metadata } from "next";

import { SelectorPeriodo } from "@/components/reportes/selector-periodo";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { puede } from "@/lib/permisos";
import { ahora } from "@/lib/reloj";
import { etiquetaRango, parametrosDesdeUrl } from "@/lib/reportes/parametros";
import { filtrosGastosSchema } from "@/lib/validations/finanzas";
import { diaEn, PERIODOS } from "@/lib/zona-horaria";
import { requirePaginaPermiso } from "@/server/auth/permissions";
import { obtenerZonaHoraria } from "@/server/services/configuracion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";
import {
  listarCategoriasGasto,
  listarGastos,
  obtenerGasto,
  recurrentesPendientes,
} from "@/server/services/gasto.service";

import { GastosView } from "./gastos-view";

export const metadata: Metadata = { title: "Gastos" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function GastosPage({ searchParams }: { searchParams: SP }) {
  const usuario = await requirePaginaPermiso(Modulo.GASTOS, "ver");
  const sp = await searchParams;
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(ahora(), tz);
  const p = parametrosDesdeUrl(sp, hoy, "mes");
  const plano = Object.fromEntries(
    Object.entries(sp).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  const filtros = filtrosGastosSchema.parse({
    desde: p.rango.desde,
    hasta: p.rango.hasta,
    categoriaGastoId: p.categoriaId,
    depositoId: p.depositoId,
    medioPago: plano.medio,
    q: plano.q,
    page: plano.page,
  });
  const gastoId = typeof sp.gasto === "string" ? sp.gasto : null;
  const [r, categorias, depositos, recurrentes, abierto] = await Promise.all([
    listarGastos(filtros),
    listarCategoriasGasto(),
    listarDepositosActivos(),
    recurrentesPendientes(),
    gastoId ? obtenerGasto(gastoId).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Gastos" subtitle={etiquetaRango(p)} />
      <GastosView
        gastos={r.gastos}
        categorias={categorias.map((c) => ({ id: c.id, nombre: c.nombre }))}
        depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
        recurrentes={recurrentes}
        hoy={hoy}
        abierto={abierto}
        permisos={{
          crear: puede(usuario, Modulo.GASTOS, "crear"),
          editar: puede(usuario, Modulo.GASTOS, "editar"),
          eliminar: puede(usuario, Modulo.GASTOS, "eliminar"),
        }}
        filtros={
          <SelectorPeriodo
            periodos={PERIODOS}
            periodo={p.periodo}
            rango={p.rango}
            depositos={depositos.map((d) => ({ id: d.id, nombre: d.nombre }))}
            depositoId={p.depositoId}
            categorias={categorias.map((c) => ({ id: c.id, nombre: c.nombre }))}
            categoriaId={p.categoriaId}
          />
        }
        resumen={
          <section className="grid grid-cols-2 gap-3">
            <StatCard label="Total del período" value={formatearPesos(r.totalMonto)} />
            <StatCard label="Gastos" value={formatearNumero(r.total)} />
          </section>
        }
        vacio={
          <EmptyState
            icon={Receipt}
            title="No hay gastos en el período"
            description="Cargá el primero con «Nuevo gasto»."
          />
        }
      />
      <Pagination
        className="mt-4"
        page={r.page}
        pageSize={r.pageSize}
        total={r.total}
        pathname="/gastos"
        params={plano}
      />
    </>
  );
}
