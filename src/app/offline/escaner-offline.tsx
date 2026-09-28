"use client";

import { ScanBarcode, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { buscarEnCatalogo, haceCuantoTexto, listarCatalogos } from "@/features/offline/catalogo";
import type { MetaCatalogo } from "@/features/offline/db";
import type { VarianteEscaneada } from "@/features/scanner/tipos";
import { formatearPesos } from "@/lib/format";
import { CLAVE_ULTIMO_PANEL, rutaPanel } from "@/lib/paneles";

function ultimoPanel(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO_PANEL);
  } catch {
    return null;
  }
}

/**
 * Escáner mínimo para cuando la app se abre sin señal: SOLO CONSULTA
 * (código → producto, precio y stock del último catálogo guardado del panel).
 * La pistola escribe en el campo y manda Enter.
 */
export function EscanerOffline() {
  const [catalogos, setCatalogos] = useState<MetaCatalogo[] | undefined>(undefined);
  const [panelId, setPanelId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ultima, setUltima] = useState<VarianteEscaneada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const meta = catalogos?.find((c) => c.panelId === panelId) ?? null;

  const elegirPanel = useCallback((m: MetaCatalogo | undefined) => {
    setPanelId(m?.panelId ?? "");
    setDepositoId((m?.depositos.find((d) => d.esPrincipal) ?? m?.depositos[0])?.id ?? "");
    setUltima(null);
    setError(null);
  }, []);

  useEffect(() => {
    void listarCatalogos().then((lista) => {
      setCatalogos(lista);
      const slug = ultimoPanel();
      elegirPanel(lista.find((c) => c.panelSlug === slug) ?? lista[0]);
    });
    const f = () => setOnline(navigator.onLine);
    f();
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, [elegirPanel]);

  const buscar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const c = codigo.trim();
      setCodigo("");
      if (!c || !panelId) return;
      const v = await buscarEnCatalogo(panelId, c);
      if (!v) {
        setUltima(null);
        setError(`Código no encontrado en el catálogo offline (${c}).`);
      } else {
        setError(null);
        setUltima(v);
      }
      input.current?.focus();
    },
    [codigo, panelId],
  );

  if (catalogos === undefined) return null;
  if (!meta)
    return (
      <p className="border-border text-muted rounded-2xl border border-dashed p-6 text-center text-sm">
        Este celular todavía no tiene ningún catálogo guardado. Entrá una vez al panel con conexión
        y queda listo para consultar sin señal.
      </p>
    );

  const dep = (id: string) => meta.depositos.find((d) => d.id === id)?.nombre ?? "";
  const stockEn = (v: VarianteEscaneada) =>
    v.stock.find((s) => s.depositoId === depositoId)?.cantidad ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-xs">
        {meta.usuarioNombre} · {meta.panelNombre} · catálogo actualizado{" "}
        {haceCuantoTexto(meta.sincronizadoEn)} ({meta.cantidad} productos)
      </p>
      {online && (
        // Navegación completa a propósito: sale de la página de respaldo del service worker.
        <a
          href={rutaPanel(meta.panelSlug)}
          className="bg-success-soft text-success-soft-foreground flex min-h-11 items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <Wifi className="size-4" strokeWidth={1.75} aria-hidden /> Volvió la conexión: tocá para
          abrir la app
        </a>
      )}
      <div className={`grid gap-3 ${catalogos.length > 1 ? "grid-cols-2" : ""}`}>
        {catalogos.length > 1 && (
          <Select
            label="Panel"
            options={catalogos.map((c) => ({ value: c.panelId, label: c.panelNombre }))}
            value={panelId}
            onChange={(e) => elegirPanel(catalogos.find((c) => c.panelId === e.target.value))}
          />
        )}
        <Select
          label="Depósito"
          options={meta.depositos.map((d) => ({ value: d.id, label: d.nombre }))}
          value={depositoId}
          onChange={(e) => setDepositoId(e.target.value)}
        />
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
          <ScanBarcode strokeWidth={1.75} />
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
          <p className="text-muted mt-2 text-xs">
            Datos del último catálogo guardado: pueden no reflejar las ventas más recientes.
          </p>
        </section>
      )}
    </div>
  );
}
