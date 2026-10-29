"use client";

import { ListPlus, Pencil, Plus, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useRutaPanel } from "@/components/layout/panel-context";
import { BarraAccion } from "@/components/ui/barra-accion";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { telefonoValido } from "@/lib/validations/cliente";
import type { FilaImportacion } from "@/server/services/cartera-clientes.service";

import {
  agregarClienteCarteraAction,
  editarClienteCarteraAction,
  importarCarteraAction,
  quitarClienteCarteraAction,
  telefonoEnCarteraAction,
} from "./actions";

type Dueno = Extract<Awaited<ReturnType<typeof telefonoEnCarteraAction>>, { ok: true }>["data"];

export interface ClienteCarteraEditable {
  id: string;
  nombre: string;
  telefono: string;
  notas: string | null;
}

/**
 * Formulario de un cliente de la cartera (alta «ya lo tenía» o edición). Avisa
 * en vivo si el teléfono ya es de alguien: de tu cartera, de un cliente del
 * negocio sin cartera (se suma a la tuya al guardar) o de otro vendedor (no
 * se puede).
 */
export function ClienteCarteraForm({
  cliente,
  onListo,
  otroDespues = false,
}: {
  cliente: ClienteCarteraEditable | null;
  onListo: () => void;
  /** Alta: después de guardar queda limpio para cargar otro (no se cierra). */
  otroDespues?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [notas, setNotas] = useState(cliente?.notas ?? "");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [dueno, setDueno] = useState<Dueno>(null);
  const nombreRef = useRef<HTMLInputElement>(null);

  const tel = telefonoValido(telefono);
  useEffect(() => {
    setDueno(null);
    if (!tel || tel === cliente?.telefono) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await telefonoEnCarteraAction({ telefono: tel });
      if (vigente && r.ok && r.data && r.data.cliente.id !== cliente?.id) setDueno(r.data);
    }, 350);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [tel, cliente?.id, cliente?.telefono]);

  const bloqueado = dueno?.de === "OTRO" || (!cliente && dueno?.de === "MIA");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErrores({});
    setEnviando(true);
    const datos = { nombre, telefono, notas };
    const r = cliente
      ? await editarClienteCarteraAction({ ...datos, id: cliente.id })
      : await agregarClienteCarteraAction({ ...datos, sumarExistente: dueno?.de === "NADIE" });
    setEnviando(false);
    if (!r.ok) {
      const campos = r.error.fields ?? {};
      setErrores(Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v[0] ?? ""])));
      if (!Object.keys(campos).length) toast.error("No se pudo guardar", r.error.message);
      return;
    }
    if (cliente) toast.success("Cliente actualizado");
    else if ("tipo" in r.data) {
      const c = r.data.cliente;
      toast.success(
        r.data.tipo === "CREADO"
          ? "Cliente cargado en tu cartera"
          : r.data.tipo === "SUMADO"
            ? "Se sumó a tu cartera"
            : "Ya estaba en tu cartera",
        c.nombre,
      );
    }
    router.refresh();
    if (otroDespues && !cliente) {
      setNombre("");
      setTelefono("");
      setNotas("");
      setDueno(null);
      nombreRef.current?.focus();
      return;
    }
    onListo();
  }

  return (
    <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-4" id="form-cartera">
      <Input
        ref={nombreRef}
        label="Nombre"
        required
        autoFocus
        autoComplete="off"
        maxLength={100}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        error={errores.nombre}
      />
      <Input
        label="Teléfono"
        required
        inputMode="tel"
        autoComplete="off"
        placeholder="11 2345-6789"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        error={errores.telefono}
        hint={
          dueno && (
            <span
              className={cn(
                dueno.de === "NADIE" ? "text-muted" : "text-warning-soft-foreground font-medium",
              )}
              data-testid="aviso-telefono-cartera"
            >
              {dueno.de === "MIA"
                ? `${dueno.cliente.nombre} ya está en tu cartera.`
                : dueno.de === "OTRO"
                  ? `${dueno.cliente.nombre} está en la cartera de ${dueno.vendedor ?? "otro vendedor"}.`
                  : `${dueno.cliente.nombre} ya es cliente del negocio: al guardar se suma a tu cartera (no cuenta como nuevo).`}
            </span>
          )
        }
      />
      <Textarea
        label="Notas"
        rows={2}
        maxLength={2000}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onListo} disabled={enviando}>
          {otroDespues && !cliente ? "Listo" : "Cancelar"}
        </Button>
        <Button type="submit" loading={enviando} disabled={bloqueado}>
          {cliente
            ? "Guardar"
            : dueno?.de === "NADIE"
              ? "Sumar a mi cartera"
              : "Guardar y cargar otro"}
        </Button>
      </div>
    </form>
  );
}

const ETIQUETA_RESULTADO: Record<FilaImportacion["resultado"], string> = {
  CREADO: "Cargados",
  SUMADO: "Ya eran clientes (sumados)",
  YA_ESTABA: "Ya estaban en tu cartera",
  ERROR: "Con error",
};

/** «Cargar varios»: pegar la lista (una línea por cliente) y ver qué pasó con cada uno. */
function CargarVarios({ onListo }: { onListo: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [filas, setFilas] = useState<FilaImportacion[] | null>(null);

  async function cargar() {
    setEnviando(true);
    const r = await importarCarteraAction({ texto });
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo cargar", r.error.message);
    setFilas(r.data);
    // Quedan en el texto solo las líneas con error, para corregirlas y volver a cargar.
    setTexto(
      r.data
        .filter((f) => f.resultado === "ERROR")
        .map((f) => f.texto)
        .join("\n"),
    );
    const ok = r.data.filter((f) => f.resultado !== "ERROR").length;
    toast.success(`${ok} de ${r.data.length} listos`);
    router.refresh();
  }

  const conteo = (filas ?? []).reduce<Record<string, number>>(
    (a, f) => ({ ...a, [f.resultado]: (a[f.resultado] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      <Textarea
        label="Una línea por cliente: nombre y teléfono"
        rows={10}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={
          "Juan Pérez, 11 2345-6789\nMaría Gómez; 1198765432\nKiosco Lo de Tito\t221 555-1234"
        }
        hint="Podés pegar desde una planilla o los contactos: nombre y teléfono separados por coma, punto y coma o tabulador."
      />
      {filas && (
        <section
          aria-label="Resultado de la carga"
          className="flex flex-col gap-2"
          data-testid="resultado-carga"
        >
          <p className="text-small flex flex-wrap gap-x-3 gap-y-1">
            {(Object.keys(ETIQUETA_RESULTADO) as FilaImportacion["resultado"][])
              .filter((k) => conteo[k])
              .map((k) => (
                <span key={k} className={k === "ERROR" ? "text-danger" : "text-muted"}>
                  {ETIQUETA_RESULTADO[k]}: <strong>{conteo[k]}</strong>
                </span>
              ))}
          </p>
          <ul className="border-border divide-border rounded-card max-h-64 divide-y overflow-y-auto border text-sm">
            {filas.map((f) => (
              <li
                key={f.linea}
                className={cn("px-3 py-2", f.resultado === "ERROR" ? "text-danger" : "text-muted")}
              >
                <span className="text-subtle mr-2 tabular-nums">{f.linea}.</span>
                {f.resultado === "ERROR" ? `${f.texto} — ${f.mensaje}` : f.mensaje}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onListo} disabled={enviando}>
          {filas ? "Listo" : "Cancelar"}
        </Button>
        <Button onClick={() => void cargar()} loading={enviando} disabled={!texto.trim()}>
          Cargar
        </Button>
      </div>
    </div>
  );
}

/** Botones «Agregar cliente» y «Cargar varios» de «Mis clientes» (con sus hojas). */
export function AccionesCartera() {
  const [abierta, setAbierta] = useState<"uno" | "varios" | null>(null);
  const cerrar = () => setAbierta(null);
  return (
    <>
      <div className="contents max-md:[&>[aria-hidden]]:hidden">
        <BarraAccion>
          <Button variant="secondary" onClick={() => setAbierta("varios")}>
            <ListPlus strokeWidth={1.75} /> Cargar varios
          </Button>
          <Button onClick={() => setAbierta("uno")}>
            <Plus strokeWidth={1.75} /> Agregar cliente
          </Button>
        </BarraAccion>
      </div>
      <Sheet
        open={abierta === "uno"}
        onOpenChange={(o) => setAbierta(o ? "uno" : null)}
        title="Agregar cliente que ya tenés"
        description="Queda en tu cartera y venderle no cuenta como cliente nuevo."
      >
        {abierta === "uno" && <ClienteCarteraForm cliente={null} onListo={cerrar} otroDespues />}
      </Sheet>
      <Sheet
        open={abierta === "varios"}
        onOpenChange={(o) => setAbierta(o ? "varios" : null)}
        title="Cargar varios clientes"
        description="Pegá tu lista: todos quedan en tu cartera como clientes que ya tenías."
      >
        {abierta === "varios" && <CargarVarios onListo={cerrar} />}
      </Sheet>
    </>
  );
}

/** Ficha de un cliente de la cartera: editar sus datos y, si ya lo tenía, quitarlo. */
export function AccionesClienteCartera({
  cliente,
  puedeQuitar,
}: {
  cliente: ClienteCarteraEditable;
  puedeQuitar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const ruta = useRutaPanel();
  const [abierto, setAbierto] = useState<"editar" | "quitar" | null>(null);

  async function quitar() {
    const r = await quitarClienteCarteraAction({ id: cliente.id });
    setAbierto(null);
    if (!r.ok) return toast.error("No se pudo quitar", r.error.message);
    toast.success(`${cliente.nombre} ya no está en tu cartera`);
    router.push(ruta("/mis-clientes"));
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setAbierto("editar")}>
        <Pencil strokeWidth={1.75} /> Editar datos
      </Button>
      {puedeQuitar && (
        <Button variant="secondary" className="text-danger" onClick={() => setAbierto("quitar")}>
          <UserMinus strokeWidth={1.75} /> Quitar de mi cartera
        </Button>
      )}
      <Sheet
        open={abierto === "editar"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title="Editar cliente"
      >
        {abierto === "editar" && (
          <ClienteCarteraForm cliente={cliente} onListo={() => setAbierto(null)} />
        )}
      </Sheet>
      <ConfirmDialog
        open={abierto === "quitar"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title={`¿Quitar a ${cliente.nombre} de tu cartera?`}
        description="Sigue siendo cliente del negocio y sus ventas no cambian. Usalo si lo cargaste por error."
        confirmLabel="Quitar"
        danger
        onConfirm={quitar}
      />
    </div>
  );
}
