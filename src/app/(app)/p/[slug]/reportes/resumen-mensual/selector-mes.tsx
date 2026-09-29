"use client";

import { controlClass } from "@/components/ui/field";
import { useUrlParams } from "@/hooks/use-url-params";
import { cn } from "@/lib/utils";

export function SelectorMes({ mes, max }: { mes: string; max: string }) {
  const { actualizar } = useUrlParams();
  return (
    <label className="text-muted text-small flex flex-col gap-1 md:w-60">
      Mes
      <input
        type="month"
        className={cn(controlClass, "h-11 md:h-10")}
        value={mes}
        max={max}
        onChange={(e) => e.target.value && actualizar({ mes: e.target.value })}
      />
    </label>
  );
}
