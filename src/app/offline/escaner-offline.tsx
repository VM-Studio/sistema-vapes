"use client";

import { ScanBarcode, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { buscarEnCatalogo, haceCuantoTexto, infoCatalogo } from "@/features/offline/catalogo";
import { encolar } from "@/features/offline/cola";
import type { MetaCatalogo } from "@/features/offline/db";
import { PendientesSincronizacion } from "@/features/offline/pendientes-sincronizacion";
import type { VarianteEscaneada } from "@/features/scanner/tipos";
import { formatearPesos } from "@/lib/format";

type Modo = "consultar" | "ingresar" | "contar" | "transferir";

/** Escáner mínimo para cuando la app se abre sin señal (la pistola escribe en el campo y manda Enter). */
export function EscanerOffline() {
  const [meta, setMeta] = useState<MetaCatalogo | null | undefined>(undefined);
  const [modo, setModo] = useState<Modo>("consultar");
  const [depositoId, setDepositoId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ultima, setUltima] = useState<VarianteEscaneada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<{ v: VarianteEscaneada; cantidad: number }[]>([]);
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void infoCatalogo().then((m) => {
      setMeta(m);
      const principal = m?.depositos.find((d) => d.esPrincipal) ?? m?.depositos[0];
      setDepositoId(principal?.id ?? "");
      setDestinoId(m?.depositos.find((d) => d.id !== principal?.id)?.id ?? "");
    });
    const f = () => setOnline(navigator.onLine);
    f();
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, []);

  const buscar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const c = codigo.trim();
      setCodigo("");
      if (!c) return;
      const v = await buscarEnCatalogo(c);
      if (!v) {
        setError(`Código no encontrado en el catálogo offline (${c}).`);
        return;
      }
      setError(null);
      setUltima(v);
      if (modo !== "consultar")
        setItems((its) =>
          its.some((i) => i.v.varianteId === v.varianteId)
            ? its.map((i) =>
                i.v.varianteId === v.varianteId ? { ...i, cantidad: i.cantidad + 1 } : i,
              )
            : [{ v, cantidad: 1 }, ...its],
        );
      input.current?.focus();
    },
    [codigo, modo],
  );

  if (meta === undefined) return null;
  if (!meta)
    return (
      <p className="border-border text-muted rounded-xl border border-dashed p-6 text-center text-sm">
        Este celular todavía no tiene el catálogo guardado. Entrá una vez con conexión y queda listo
        para usar sin señal.
      </p>
    );

  const permitido: Record<Modo, boolean> = {
    consultar: true,
    ingresar: meta.permisos.ingresar,
    contar: meta.permisos.contar,
    transferir: meta.permisos.transferir,
  };
  const dep = (id: string) => meta.depositos.find((d) => d.id === id)?.nombre ?? "";
  const stockEn = (v: VarianteEscaneada) =>
    v.stock.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;

  async function guardar() {
    const u = items.reduce((a, i) => a + i.cantidad, 0);
    const lista = items.map((i) => ({ varianteId: i.v.varianteId, cantidad: i.cantidad }));
    if (modo === "ingresar")
      await encolar(
        "INGRESO",
        {
          depositoId,
          motivo: motivo || "Ingreso por escaneo (sin conexión)",
          actualizarCosto: false,
          items: lista,
        },
        meta!.usuarioId,
        `Ingreso · ${u} u. · ${dep(depositoId)}`,
      );
    else if (modo === "contar")
      await encolar(
        "RECUENTO",
        {
          depositoId,
          motivo: motivo.length >= 5 ? motivo : "Recuento por escaneo (sin conexión)",
          items: items.map((i) => ({ varianteId: i.v.varianteId, cantidadReal: i.cantidad })),
        },
        meta!.usuarioId,
        `Recuento · ${items.length} sabor(es) · ${dep(depositoId)}`,
      );
    else if (modo === "transferir")
      await encolar(
        "TRANSFERENCIA",
        {
          transferencia: {
            depositoOrigenId: depositoId,
            depositoDestinoId: destinoId,
            notas: motivo || undefined,
            items: lista,
          },
          completar: meta!.permisos.completar,
        },
        meta!.usuarioId,
        `Transferencia · ${u} u. · ${dep(depositoId)} → ${dep(destinoId)}`,
      );
    setItems([]);
    setMotivo("");
    setAviso("Guardado en el celular: se sincroniza al volver la señal.");
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-xs">
        {meta.usuarioNombre} · catálogo actualizado {haceCuantoTexto(meta.sincronizadoEn)} (
        {meta.cantidad} productos)
      </p>
      {online && (
        // Navegación completa a propósito: sale de la página de respaldo del service worker.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a
          href="/"
          className="bg-success-soft text-success-soft-foreground flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <Wifi className="size-4" aria-hidden /> Volvió la conexión: tocá para abrir la app
        </a>
      )}
      <div role="tablist" aria-label="Modo" className="flex gap-2 overflow-x-auto">
        {(["consultar", "ingresar", "contar", "transferir"] as Modo[])
          .filter((m) => permitido[m])
          .map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              onClick={() => {
                setModo(m);
                setItems([]);
              }}
              className={`h-10 shrink-0 rounded-full border px-4 text-sm font-semibold capitalize ${modo === m ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface"}`}
            >
              {m}
            </button>
          ))}
      </div>
      <div className={`grid gap-3 ${modo === "transferir" ? "grid-cols-2" : ""}`}>
        <Select
          label={modo === "transferir" ? "Origen" : "Depósito"}
          options={meta.depositos.map((d) => ({ value: d.id, label: d.nombre }))}
          value={depositoId}
          onChange={(e) => setDepositoId(e.target.value)}
        />
        {modo === "transferir" && (
          <Select
            label="Destino"
            options={meta.depositos
              .filter((d) => d.id !== depositoId)
              .map((d) => ({ value: d.id, label: d.nombre }))}
            value={destinoId}
            onChange={(e) => setDestinoId(e.target.value)}
          />
        )}
      </div>
      <form onSubmit={buscar} className="flex gap-2">
        <Input
          ref={input}
          aria-label="Código"
          placeholder="Escaneá o escribí el código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          autoFocus
          containerClassName="flex-1"
        />
        <Button type="submit" aria-label="Buscar">
          <ScanBarcode />
        </Button>
      </form>
      {error && (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      )}
      {ultima && (
        <section aria-label="Producto" className="border-border bg-surface rounded-2xl border p-4">
          <p className="text-lg font-semibold">{ultima.nombreCompleto}</p>
          <p className="text-muted text-sm">
            {formatearPesos(ultima.precioVenta)} · En {dep(depositoId)}:{" "}
            <strong className="text-foreground">{stockEn(ultima)}</strong> · Total{" "}
            {ultima.stockTotal}
          </p>
        </section>
      )}
      {modo !== "consultar" && items.length > 0 && (
        <section className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1 text-sm">
            {items.map((i) => (
              <li key={i.v.varianteId} className="flex justify-between gap-2">
                <span className="truncate">{i.v.nombreCompleto}</span>
                <strong className="tabular-nums">{i.cantidad}</strong>
              </li>
            ))}
          </ul>
          <Input
            label={modo === "transferir" ? "Notas (opcional)" : "Motivo"}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <Button onClick={guardar} disabled={modo === "transferir" && !destinoId}>
            Guardar sin conexión
          </Button>
        </section>
      )}
      {aviso && (
        <p className="bg-success-soft text-success-soft-foreground rounded-lg px-3 py-2 text-sm">
          {aviso}
        </p>
      )}
      <PendientesSincronizacion />
    </div>
  );
}
