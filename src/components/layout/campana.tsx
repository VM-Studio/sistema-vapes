"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const NoLeidasContext = createContext(0);

/** El layout (servidor) pasa cuántas notificaciones sin leer tiene el usuario. */
export function NotificacionesProvider({
  noLeidas,
  children,
}: {
  noLeidas: number;
  children: ReactNode;
}) {
  return <NoLeidasContext.Provider value={noLeidas}>{children}</NoLeidasContext.Provider>;
}

export function Campana({ className }: { className?: string }) {
  const n = useContext(NoLeidasContext);
  return (
    <Link
      href="/notificaciones"
      aria-label={n ? `Notificaciones: ${n} sin leer` : "Notificaciones"}
      className={cn(
        "text-muted hover:bg-surface-2 hover:text-foreground relative flex size-10 items-center justify-center rounded-lg",
        className,
      )}
    >
      <Bell className="size-5" aria-hidden />
      {n > 0 && (
        <span className="bg-danger text-danger-foreground absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
