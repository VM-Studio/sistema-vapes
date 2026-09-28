"use client";

import { Check, Loader2, Search, UserPlus, UserRound, Users } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  buscarClientesAction,
  clientePorTelefonoAction,
} from "@/app/(app)/p/[slug]/clientes/actions";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { mostrarTelefono, telefonoValido } from "@/lib/validations/cliente";
import { cn, formatearFecha } from "@/lib/utils";

export type ClienteElegido =
  | { tipo: "existente"; id: string; nombre: string; telefono: string }
  | { tipo: "nuevo"; nombre: string; telefono: string };

interface ClienteResultado {
  id: string;
  nombre: string;
  telefono: string;
  ultimaCompra: Date | null;
}

type Modo = "pregunta" | "nuevo" | "buscar";

/**
 * Elegir el cliente de una operación (venta, devolución). Pregunta grande
 * "¿Es cliente nuevo?": Sí → nombre + teléfono (avisa en vivo si el teléfono
 * ya es de otro cliente y ofrece seleccionarlo); No → buscador por nombre o
 * teléfono. Sin `permitirNuevo` va directo al buscador.
 */
export function SelectorCliente({
  valor,
  onCambiar,
  permitirNuevo = true,
}: {
  valor: ClienteElegido | null;
  onCambiar: (c: ClienteElegido | null) => void;
  permitirNuevo?: boolean;
}) {
  const [modo, setModo] = useState<Modo>(() =>
    valor?.tipo === "nuevo" && permitirNuevo
      ? "nuevo"
      : valor?.tipo === "existente" || !permitirNuevo
        ? "buscar"
        : "pregunta",
  );

  if (valor?.tipo === "existente") {
    return (
      <ClienteSeleccionado
        nombre={valor.nombre}
        telefono={valor.telefono}
        onCambiar={() => {
          onCambiar(null);
          setModo(permitirNuevo ? "pregunta" : "buscar");
        }}
      />
    );
  }

  if (modo === "pregunta") {
    return (
      <section aria-labelledby="pregunta-cliente-nuevo" className="flex flex-col gap-4">
        <h3 id="pregunta-cliente-nuevo" className="text-xl font-semibold tracking-tight">
          ¿Es cliente nuevo?
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setModo("nuevo")}
            className="border-border bg-surface hover:border-primary hover:bg-primary-soft flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-lg font-semibold transition-colors"
          >
            <UserPlus className="text-primary size-7" strokeWidth={1.75} aria-hidden />
            Sí
          </button>
          <button
            type="button"
            onClick={() => setModo("buscar")}
            className="border-border bg-surface hover:border-primary hover:bg-primary-soft flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-lg font-semibold transition-colors"
          >
            <Users className="text-primary size-7" strokeWidth={1.75} aria-hidden />
            No
          </button>
        </div>
      </section>
    );
  }

  const volver = permitirNuevo ? (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      onClick={() => {
        onCambiar(null);
        setModo("pregunta");
      }}
    >
      Volver a “¿Es cliente nuevo?”
    </Button>
  ) : null;

  if (modo === "nuevo") {
    return (
      <div className="flex flex-col gap-3">
        <ClienteNuevo
          inicial={valor?.tipo === "nuevo" ? valor : null}
          onCambiar={onCambiar}
          onSeleccionarExistente={(c) => onCambiar({ tipo: "existente", ...c })}
        />
        {volver}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <BuscadorClientes onElegir={(c) => onCambiar({ tipo: "existente", ...c })} />
      {volver}
    </div>
  );
}

function ClienteSeleccionado({
  nombre,
  telefono,
  onCambiar,
}: {
  nombre: string;
  telefono: string;
  onCambiar: () => void;
}) {
  return (
    <div
      className="border-primary bg-primary-soft flex items-center gap-3 rounded-2xl border p-4"
      data-testid="cliente-seleccionado"
    >
      <span className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
        <Check className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{nombre}</span>
        <span className="text-muted block text-sm tabular-nums">{mostrarTelefono(telefono)}</span>
      </span>
      <Button variant="secondary" size="sm" onClick={onCambiar}>
        Cambiar
      </Button>
    </div>
  );
}

function ClienteNuevo({
  inicial,
  onCambiar,
  onSeleccionarExistente,
}: {
  inicial: { nombre: string; telefono: string } | null;
  onCambiar: (c: ClienteElegido | null) => void;
  onSeleccionarExistente: (c: { id: string; nombre: string; telefono: string }) => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [telefono, setTelefono] = useState(inicial?.telefono ?? "");
  const [existente, setExistente] = useState<{
    id: string;
    nombre: string;
    telefono: string;
  } | null>(null);
  const [verificando, setVerificando] = useState(false);
  const onCambiarRef = useRef(onCambiar);
  onCambiarRef.current = onCambiar;

  const normalizado = telefonoValido(telefono);
  const telefonoInvalido = telefono.trim().length >= 6 && !normalizado;

  // Validación en vivo: ¿el teléfono ya es de otro cliente del panel?
  useEffect(() => {
    setExistente(null);
    if (!normalizado) return;
    let vigente = true;
    setVerificando(true);
    const t = setTimeout(async () => {
      const r = await clientePorTelefonoAction({ telefono: normalizado });
      if (!vigente) return;
      setVerificando(false);
      if (r.ok && r.data) setExistente(r.data);
    }, 350);
    return () => {
      vigente = false;
      clearTimeout(t);
      setVerificando(false);
    };
  }, [normalizado]);

  useEffect(() => {
    const n = nombre.trim();
    onCambiarRef.current(
      n && normalizado && !existente && !verificando
        ? { tipo: "nuevo", nombre: n, telefono: normalizado }
        : null,
    );
  }, [nombre, normalizado, existente, verificando]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Nombre"
        required
        autoComplete="off"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        maxLength={100}
        className="h-12 text-base"
      />
      <Input
        label="Teléfono"
        required
        type="tel"
        inputMode="tel"
        autoComplete="off"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        maxLength={40}
        className="h-12 text-base"
        hint={
          normalizado ? `Se guarda como ${normalizado}` : "Con código de área. Ej: 11 5555 1234"
        }
        error={telefonoInvalido ? "Teléfono inválido: entre 6 y 13 dígitos" : undefined}
      />
      {verificando && (
        <p className="text-muted flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Revisando el teléfono…
        </p>
      )}
      {existente && (
        <div
          role="alert"
          className="bg-warning-soft text-warning-soft-foreground flex flex-col gap-3 rounded-xl p-4 text-sm"
        >
          <p>
            Ese teléfono es de <strong>{existente.nombre}</strong>. ¿Querés seleccionarlo?
          </p>
          <Button
            size="sm"
            className="self-start"
            onClick={() => onSeleccionarExistente(existente)}
          >
            Seleccionar a {existente.nombre}
          </Button>
        </div>
      )}
    </div>
  );
}

function BuscadorClientes({
  onElegir,
}: {
  onElegir: (c: { id: string; nombre: string; telefono: string }) => void;
}) {
  const idInput = useId();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ClienteResultado[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados(null);
      setCargando(false);
      return;
    }
    let vigente = true;
    setCargando(true);
    const t = setTimeout(async () => {
      const r = await buscarClientesAction({ q: texto });
      if (!vigente) return;
      setCargando(false);
      if (!r.ok) {
        setError(r.error.message);
        setResultados([]);
        return;
      }
      setError(null);
      setResultados(r.data);
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={idInput} className="text-sm font-medium">
        Buscá el cliente por nombre o teléfono
      </label>
      <div className="relative">
        <Search
          className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          id={idInput}
          type="search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          autoFocus
          placeholder="Nombre o teléfono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn(
            controlClass,
            "h-12 pr-10 pl-10.5 text-base [&::-webkit-search-cancel-button]:hidden",
          )}
        />
        {cargando && (
          <Loader2
            className="text-muted absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin"
            aria-hidden
          />
        )}
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      {resultados && resultados.length === 0 && !cargando && (
        <p className="text-muted rounded-xl border border-dashed px-4 py-5 text-center text-sm">
          No hay clientes con “{q.trim()}”.
        </p>
      )}
      {resultados && resultados.length > 0 && (
        <ul aria-label="Clientes encontrados" className="flex flex-col gap-2">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onElegir({ id: c.id, nombre: c.nombre, telefono: c.telefono })}
                className="border-border bg-surface hover:border-primary hover:bg-primary-soft flex min-h-14 w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors"
              >
                <span className="bg-surface-2 text-muted flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <UserRound className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.nombre}</span>
                  <span className="text-muted block truncate text-xs tabular-nums">
                    {mostrarTelefono(c.telefono)} ·{" "}
                    {c.ultimaCompra
                      ? `última compra ${formatearFecha(c.ultimaCompra)}`
                      : "sin compras"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
