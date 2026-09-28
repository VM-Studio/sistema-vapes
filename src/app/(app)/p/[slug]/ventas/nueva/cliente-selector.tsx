"use client";

import { Search, UserPlus, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ClientePos } from "@/server/services/cliente.service";

import { buscarClientesAction, crearClienteRapidoAction } from "../actions";

/** Botón de cliente del POS + Sheet con buscador y "crear rápido". */
export function ClienteSelector({
  cliente,
  onCambio,
}: {
  cliente: ClientePos | null;
  onCambio: (c: ClientePos | null) => void;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClientePos[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: "", telefono: "", documento: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await buscarClientesAction({ q });
      setBuscando(false);
      if (r.ok) setResultados(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, abierto]);

  function elegir(c: ClientePos) {
    onCambio(c);
    setAbierto(false);
    setQ("");
    setCreando(false);
  }

  async function crear() {
    setEnviando(true);
    const r = await crearClienteRapidoAction({
      nombre: nuevo.nombre,
      telefono: nuevo.telefono,
      documento: nuevo.documento,
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      if (!r.error.fields) toast.error("No se pudo crear el cliente", r.error.message);
      return;
    }
    toast.success(`Cliente ${r.data.nombre} creado`);
    setNuevo({ nombre: "", telefono: "", documento: "" });
    elegir(r.data);
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 items-stretch">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className={cn(
            controlClass,
            "flex h-11 min-w-0 flex-1 items-center gap-2 text-left",
            cliente && "border-primary bg-primary-soft text-primary-soft-foreground rounded-r-none",
          )}
          aria-label={cliente ? `Cliente: ${cliente.nombre}` : "Elegir cliente (opcional)"}
        >
          <UserRound strokeWidth={1.75} className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {cliente ? cliente.nombre : <span className="text-muted">Cliente (opcional)</span>}
          </span>
        </button>
        {cliente && (
          <Button
            variant="secondary"
            size="icon"
            className="border-primary size-11 shrink-0 rounded-l-none border-l-0"
            onClick={() => onCambio(null)}
            aria-label="Quitar cliente"
          >
            <X strokeWidth={1.75} />
          </Button>
        )}
      </div>

      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title={creando ? "Nuevo cliente" : "Elegir cliente"}
      >
        {creando ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void crear();
            }}
          >
            <Input
              label="Nombre y apellido"
              required
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              error={errores.nombre}
              autoFocus
            />
            <Input
              label="Teléfono"
              hint="Con código de área. Se guarda como +54…"
              inputMode="tel"
              value={nuevo.telefono}
              onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })}
              error={errores.telefono}
            />
            <Input
              label="DNI / CUIT (opcional)"
              value={nuevo.documento}
              onChange={(e) => setNuevo({ ...nuevo, documento: e.target.value })}
              error={errores.documento}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setCreando(false)} disabled={enviando}>
                Volver
              </Button>
              <Button type="submit" className="flex-1" loading={enviando}>
                Crear y elegir
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search
                strokeWidth={1.75}
                className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Buscar cliente"
                placeholder="Nombre, DNI o teléfono"
                className={cn(controlClass, "h-11 pl-9")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
            </div>
            <ul aria-label="Clientes" aria-busy={buscando} className="flex flex-col gap-1">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => elegir(c)}
                    className="hover:bg-surface-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.nombre}</span>
                      <span className="text-muted block truncate text-xs">
                        {[c.telefono, c.documento].filter(Boolean).join(" · ") ||
                          "Sin datos de contacto"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {!buscando && resultados.length === 0 && (
                <li className="text-muted px-3 py-2 text-sm">
                  Sin resultados{q ? ` para “${q}”` : ""}.
                </li>
              )}
            </ul>
            <Button
              variant="secondary"
              onClick={() => {
                setCreando(true);
                setNuevo((n) => ({ ...n, nombre: /\d/.test(q) ? n.nombre : q }));
              }}
            >
              <UserPlus strokeWidth={1.75} /> Crear cliente rápido
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
