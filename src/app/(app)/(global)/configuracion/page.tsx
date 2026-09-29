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

import { cardVariants } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";

import { SECCIONES_CONFIGURACION } from "./secciones";

export const metadata: Metadata = { title: "Configuración" };

const ICONOS = [Smartphone, LayoutGrid, DatabaseBackup, History, FileSpreadsheet];

export default async function ConfiguracionPage() {
  await requirePaginaOwner();
  return (
    <>
      <PageHeader title="Configuración" subtitle="Lo que vale para todos los sistemas" />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES_CONFIGURACION.map((s, i) => {
          const Icono = ICONOS[i]!;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                className={cn(
                  cardVariants({ variant: "clickable" }),
                  "group flex min-h-20 items-center gap-4 p-5",
                )}
              >
                <span className="bg-surface rounded-control flex size-11 shrink-0 items-center justify-center">
                  <Icono className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-h3 font-semibold">{s.label}</span>
                  <span className="text-muted text-small">{s.descripcion}</span>
                </span>
                <ChevronRight
                  className="text-subtle size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
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
