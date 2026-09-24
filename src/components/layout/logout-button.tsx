import { LogOut } from "lucide-react";

import { cn } from "@/lib/utils";

/** POST nativo a /api/auth/logout (funciona aun sin JS). */
export function LogoutButton({
  className,
  compacto = false,
}: {
  className?: string;
  compacto?: boolean;
}) {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className={cn(
          "text-muted hover:bg-surface-2 hover:text-foreground flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
          compacto && "justify-center px-0",
          className,
        )}
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        {!compacto && <span>Cerrar sesión</span>}
      </button>
    </form>
  );
}
