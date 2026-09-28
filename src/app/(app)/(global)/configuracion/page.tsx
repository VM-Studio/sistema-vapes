import {
  ChevronRight,
  DatabaseBackup,
  FileSpreadsheet,
  History,
  LayoutGrid,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { requirePaginaOwner } from "@/server/auth/permissions";

import { SECCIONES_CONFIGURACION } from "./secciones";

export const metadata: Metadata = { title: "Configuración" };

const ICONOS = [Smartphone, LayoutGrid, DatabaseBackup, History, FileSpreadsheet];

export default async function ConfiguracionPage() {
  await requirePaginaOwner();
  return (
    <>
      <PageHeader title="Configuración" subtitle="Lo que vale para todos los sistemas" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES_CONFIGURACION.map((s, i) => {
          const Icono = ICONOS[i]!;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group border-border bg-surface shadow-card hover:shadow-card-hover flex min-h-20 items-center gap-4 rounded-2xl border p-5 transition-shadow"
              >
                <span className="bg-primary-soft text-primary-soft-foreground flex size-11 shrink-0 items-center justify-center rounded-lg">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted text-sm">{s.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-muted size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
