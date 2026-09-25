import { Modulo } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SelectorPeriodo } from "@/components/reportes/selector-periodo";
import { Badge } from "@/components/ui/badge";
import { navegacionPermitida } from "@/config/navigation";
import { ahora } from "@/lib/reloj";
import { etiquetaRango, parametrosDesdeUrl } from "@/lib/reportes/parametros";
import { esOwner, puede } from "@/lib/permisos";
import { diaEn, PERIODOS_DASHBOARD } from "@/lib/zona-horaria";
import { requirePaginaUsuario } from "@/server/auth/permissions";
import { obtenerZonaHoraria } from "@/server/services/configuracion.service";
import { listarDepositosActivos } from "@/server/services/deposito.service";

import {
  CuentasPorCobrar,
  EstadoCaja,
  GraficoVentas,
  KpisCargando,
  KpisDashboard,
  MediosDePago,
  Pendientes,
  PorVendedor,
  SaboresLentos,
  StockPorGalpon,
  Tarjeta,
  TarjetaCargando,
  TopSabores,
  type ContextoDashboard,
} from "./_dashboard/tarjetas";

export const metadata: Metadata = { title: "Inicio" };

function saludo(tz: string): string {
  const hora = Number(
    new Intl.DateTimeFormat("es-AR", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(
      new Date(),
    ),
  );
  if (hora < 12) return "Buen día";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Dashboard. Qué se ve depende de los permisos:
 *  - FINANZAS: ganancias (bruta y neta), valorización.
 *  - REPORTES (o dueño): el negocio entero y "por vendedor"; sin REPORTES,
 *    un empleado ve solo SUS ventas.
 *  - INVENTARIO: stock por galpón. CAJA: estado de la caja. CLIENTES: deudas.
 * Todas las métricas salen agregadas de PostgreSQL / ResumenDiario.
 */
export default async function InicioPage({ searchParams }: { searchParams: SP }) {
  const usuario = await requirePaginaUsuario();
  const tz = await obtenerZonaHoraria();
  const hoy = diaEn(ahora(), tz);
  const p = parametrosDesdeUrl(await searchParams, hoy, "mes");
  const owner = esOwner(usuario);
  const finanzas = puede(usuario, Modulo.FINANZAS, "ver");
  const verTodo = owner || puede(usuario, Modulo.REPORTES, "ver");
  const verVentas = verTodo || puede(usuario, Modulo.VENTAS, "ver");
  const propio = !verTodo;
  const c: ContextoDashboard = {
    rango: p.rango,
    depositoId: p.depositoId,
    usuarioId: propio ? usuario.id : undefined,
    finanzas,
    tz,
  };
  const depositos = await listarDepositosActivos();
  const permisos = {
    inventario: puede(usuario, Modulo.INVENTARIO, "ver"),
    caja: puede(usuario, Modulo.CAJA, "ver"),
    cajaOperar: puede(usuario, Modulo.CAJA, "crear"),
    clientes: verTodo && puede(usuario, Modulo.CLIENTES, "ver"),
    pendientes: {
      transferencias: puede(usuario, Modulo.MOVIMIENTOS, "ver"),
      compras: puede(usuario, Modulo.COMPRAS, "ver"),
      ventas: puede(usuario, Modulo.VENTAS, "ver"),
      gastos: puede(usuario, Modulo.GASTOS, "ver"),
    },
  };
  const hayPendientes = Object.values(permisos.pendientes).some(Boolean);
  const accesos = navegacionPermitida(usuario).filter((i) => i.href !== "/");
  const clave = JSON.stringify(p); // re-suspende las tarjetas al cambiar filtros

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {saludo(tz)}, {usuario.nombre.split(" ")[0]}
        </h1>
        <p className="text-muted flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={owner ? "primary" : "neutral"}>{owner ? "Dueño" : "Empleado"}</Badge>
          {verVentas && (
            <span>
              {etiquetaRango(p)}
              {propio ? " · tus ventas" : ""}
            </span>
          )}
        </p>
      </section>

      {verVentas && (
        <SelectorPeriodo
          periodos={PERIODOS_DASHBOARD}
          periodo={p.periodo}
          rango={p.rango}
          depositos={depositos.length > 1 ? depositos : undefined}
          depositoId={p.depositoId}
        />
      )}

      {verVentas && (
        <Suspense key={`kpis${clave}`} fallback={<KpisCargando n={finanzas ? 6 : 4} />}>
          <KpisDashboard c={c} propio={propio} />
        </Suspense>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {verVentas && (
          <Tarjeta
            titulo={finanzas ? "Ventas y ganancia bruta" : "Ventas"}
            accion={
              verTodo && puede(usuario, Modulo.REPORTES, "ver")
                ? { href: `/reportes/ventas?periodo=${p.periodo}`, label: "Reporte" }
                : undefined
            }
            className="lg:col-span-8"
          >
            <Suspense
              key={`g${clave}`}
              fallback={<div className="bg-surface-2 h-[280px] animate-pulse rounded-md" />}
            >
              <GraficoVentas c={c} />
            </Suspense>
          </Tarjeta>
        )}
        {verVentas && (
          <Suspense
            key={`m${clave}`}
            fallback={<TarjetaCargando titulo="Medios de pago" className="lg:col-span-4" />}
          >
            <Tarjeta titulo="Medios de pago" className="lg:col-span-4">
              <MediosDePago c={c} />
            </Tarjeta>
          </Suspense>
        )}

        {permisos.inventario && (
          <Suspense
            fallback={<TarjetaCargando titulo="Stock por galpón" className="lg:col-span-4" />}
          >
            <Tarjeta
              titulo="Stock por galpón"
              accion={{ href: "/inventario", label: "Inventario" }}
              className="lg:col-span-4"
            >
              <StockPorGalpon c={c} />
            </Tarjeta>
          </Suspense>
        )}
        {verVentas && (
          <Suspense
            key={`t${clave}`}
            fallback={
              <TarjetaCargando titulo="Top 10 sabores" alto={260} className="lg:col-span-4" />
            }
          >
            <Tarjeta titulo="Top 10 sabores" className="lg:col-span-4">
              <TopSabores c={c} />
            </Tarjeta>
          </Suspense>
        )}
        {verVentas && permisos.inventario && (
          <Suspense
            key={`l${clave}`}
            fallback={<TarjetaCargando titulo="Sabores lentos" className="lg:col-span-4" />}
          >
            <Tarjeta
              titulo="Sabores sin ventas (30 días)"
              accion={
                puede(usuario, Modulo.REPORTES, "ver")
                  ? { href: "/reportes/rotacion", label: "Rotación" }
                  : undefined
              }
              className="lg:col-span-4"
            >
              <SaboresLentos c={c} />
            </Tarjeta>
          </Suspense>
        )}

        {permisos.caja && (
          <Suspense fallback={<TarjetaCargando titulo="Caja" className="lg:col-span-6" />}>
            <Tarjeta
              titulo="Caja"
              accion={{ href: "/caja", label: "Ver caja" }}
              className="lg:col-span-6"
            >
              <EstadoCaja c={c} puedeOperar={permisos.cajaOperar} />
            </Tarjeta>
          </Suspense>
        )}
        {verTodo && verVentas && (
          <Suspense
            key={`v${clave}`}
            fallback={<TarjetaCargando titulo="Por vendedor" className="lg:col-span-6" />}
          >
            <Tarjeta titulo="Por vendedor" className="lg:col-span-6">
              <PorVendedor c={c} />
            </Tarjeta>
          </Suspense>
        )}
        {permisos.clientes && (
          <Suspense
            fallback={<TarjetaCargando titulo="Cuentas por cobrar" className="lg:col-span-6" />}
          >
            <Tarjeta
              titulo="Cuentas por cobrar"
              accion={{ href: "/clientes", label: "Clientes" }}
              className="lg:col-span-6"
            >
              <CuentasPorCobrar />
            </Tarjeta>
          </Suspense>
        )}
        {hayPendientes && (
          <Suspense fallback={<TarjetaCargando titulo="Pendientes" className="lg:col-span-6" />}>
            <Tarjeta titulo="Pendientes" className="lg:col-span-6">
              <Pendientes ver={permisos.pendientes} />
            </Tarjeta>
          </Suspense>
        )}
      </div>

      {!owner && accesos.length > 0 && (
        <section aria-labelledby="accesos" className="flex flex-col gap-3">
          <h2 id="accesos" className="text-muted text-sm font-semibold tracking-wide uppercase">
            Accesos rápidos
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {accesos.map((item) => {
              const Icono = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group border-border bg-surface hover:border-primary/40 flex h-full items-center gap-3 rounded-xl border p-3 transition-colors"
                  >
                    <span className="bg-primary-soft text-primary-soft-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icono className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {item.label}
                    </span>
                    <ChevronRight className="text-muted size-4" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
