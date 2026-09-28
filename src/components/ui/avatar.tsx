import { cn, iniciales } from "@/lib/utils";

export function Avatar({ nombre, className }: { nombre: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary-soft text-primary-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        className,
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}
