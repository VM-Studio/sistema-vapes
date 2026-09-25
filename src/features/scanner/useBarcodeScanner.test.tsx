import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScannerProvider } from "./scanner-provider";
import { useBarcodeScanner, type UseBarcodeScannerOptions } from "./useBarcodeScanner";

/**
 * Reloj controlado: cada tecla avanza `intervalo` ms. Los timers (vencimiento
 * de ráfaga) son falsos y avanzan junto con el reloj.
 */
let reloj = 0;
const ahora = () => reloj;

function Envoltorio({ children }: { children: ReactNode }) {
  return <ScannerProvider ahora={ahora}>{children}</ScannerProvider>;
}

/**
 * Simula al navegador: dispara keydown en el elemento con foco y, si nadie
 * lo canceló, inserta el carácter en el input (como haría el teclado real).
 */
function tecla(key: string): KeyboardEvent {
  const destino = (document.activeElement as HTMLElement | null) ?? document.body;
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    destino.dispatchEvent(ev);
    if (!ev.defaultPrevented && key.length === 1 && destino instanceof HTMLInputElement) {
      destino.setRangeText(key, destino.selectionStart ?? 0, destino.selectionEnd ?? 0, "end");
      destino.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  return ev;
}

/** Tipea `texto` con `intervalo` ms entre teclas y opcionalmente un sufijo. */
function escribir(texto: string, intervalo: number, sufijo?: string): KeyboardEvent | undefined {
  for (const ch of texto) {
    reloj += intervalo;
    act(() => {
      vi.advanceTimersByTime(intervalo);
    });
    tecla(ch);
  }
  if (!sufijo) return undefined;
  reloj += intervalo;
  act(() => {
    vi.advanceTimersByTime(intervalo);
  });
  return tecla(sufijo);
}

function montar(opciones: Partial<UseBarcodeScannerOptions> = {}) {
  const onScan = vi.fn();
  const hook = renderHook(() => useBarcodeScanner({ onScan, ...opciones }), {
    wrapper: Envoltorio,
  });
  return { onScan, ...hook };
}

beforeEach(() => {
  vi.useFakeTimers();
  reloj = 1000;
  (document.activeElement as HTMLElement | null)?.blur?.();
});
afterEach(() => {
  cleanup(); // desmonta el ScannerProvider del test (si no, su listener sigue vivo)
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useBarcodeScanner", () => {
  it("ráfaga válida terminada en Enter → onScan (y el Enter no llega a la página)", () => {
    const { onScan } = montar();
    const enter = escribir("7790001000019", 10, "Enter");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("7790001000019", { fuente: "pistola" });
    expect(enter?.defaultPrevented).toBe(true);
  });

  it("tipeo lento (humano) → no dispara, y el Enter sigue su curso normal", () => {
    const { onScan } = montar();
    const enter = escribir("7790001000019", 120, "Enter");
    expect(onScan).not.toHaveBeenCalled();
    expect(enter?.defaultPrevented).toBe(false);
  });

  it("sufijo Tab → onScan; si solo se acepta Enter, Tab no dispara", () => {
    const { onScan } = montar();
    escribir("7790002000018", 8, "Tab");
    expect(onScan).toHaveBeenCalledWith("7790002000018", { fuente: "pistola" });

    const soloEnter = montar({ sufijos: ["Enter"] });
    reloj += 1000;
    escribir("7790002000025", 8, "Tab");
    expect(soloEnter.onScan).not.toHaveBeenCalled();
  });

  it("prefijo configurado → se ignora", () => {
    const { onScan } = montar({ prefijo: "]C1" });
    escribir("]C17790001000026", 10, "Enter");
    expect(onScan).toHaveBeenCalledWith("7790001000026", { fuente: "pistola" });
  });

  it("doble disparo del mismo código en < 300 ms → una sola llamada (y > 300 ms → dos)", () => {
    const { onScan } = montar();
    escribir("7790001000033", 5, "Enter");
    escribir("7790001000033", 5, "Enter"); // la pistola repite enseguida
    expect(onScan).toHaveBeenCalledTimes(1);

    reloj += 400;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    escribir("7790001000033", 5, "Enter");
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("ráfaga con foco en un input del usuario → el input no queda contaminado (ni el estado de React)", () => {
    const onScan = vi.fn();
    function Pantalla() {
      const [notas, setNotas] = useState("pedido urgente");
      useBarcodeScanner({ onScan });
      return (
        <>
          <input aria-label="notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
          <output data-testid="estado">{notas}</output>
        </>
      );
    }
    render(<Pantalla />, { wrapper: Envoltorio });
    const input = screen.getByLabelText<HTMLInputElement>("notas");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    escribir("7790001000019", 10, "Enter");

    expect(onScan).toHaveBeenCalledWith("7790001000019", { fuente: "pistola" });
    expect(input.value).toBe("pedido urgente");
    expect(screen.getByTestId("estado").textContent).toBe("pedido urgente");
  });

  it("una persona que tipea 2 teclas muy rápido no pierde nada: si no hay sufijo, vuelven al input", () => {
    const onScan = vi.fn();
    function Pantalla() {
      const [v, setV] = useState("");
      useBarcodeScanner({ onScan });
      return <input aria-label="campo" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Pantalla />, { wrapper: Envoltorio });
    const input = screen.getByLabelText<HTMLInputElement>("campo");
    input.focus();
    escribir("hola", 20); // rápido, pero sin Enter
    act(() => {
      vi.advanceTimersByTime(500); // vence la ráfaga
    });
    expect(onScan).not.toHaveBeenCalled();
    expect(input.value).toBe("hola");
  });

  it("tipear rápido y tocar un botón enseguida: el click ya ve todo lo tipeado (no espera a que venza la ráfaga)", () => {
    const onScan = vi.fn();
    const guardado = vi.fn();
    function Pantalla() {
      const [v, setV] = useState("");
      useBarcodeScanner({ onScan });
      return (
        <>
          <input aria-label="cantidad" value={v} onChange={(e) => setV(e.target.value)} />
          <button onClick={() => guardado(v)}>Guardar</button>
        </>
      );
    }
    render(<Pantalla />, { wrapper: Envoltorio });
    const input = screen.getByLabelText<HTMLInputElement>("cantidad");
    input.focus();
    escribir("30", 5); // el "0" queda retenido: podría ser el comienzo de una pistola
    const boton = screen.getByText("Guardar");
    act(() => {
      boton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      boton.focus(); // el foco se va del input
      boton.click();
    });
    expect(guardado).toHaveBeenCalledWith("30");
    expect(input.value).toBe("30");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("input type=number (sin selección): lo retenido vuelve y React se entera", () => {
    function Pantalla() {
      const [v, setV] = useState("");
      useBarcodeScanner({ onScan: () => {} });
      return (
        <>
          <input type="number" aria-label="n" value={v} onChange={(e) => setV(e.target.value)} />
          <output data-testid="estado">{v}</output>
        </>
      );
    }
    render(<Pantalla />, { wrapper: Envoltorio });
    const input = screen.getByLabelText<HTMLInputElement>("n");
    input.focus();
    // jsdom tampoco soporta setRangeText en type=number: simulamos el tipeo con el setter nativo.
    for (const ch of "45") {
      reloj += 5;
      const ev = new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true });
      act(() => {
        input.dispatchEvent(ev);
        if (!ev.defaultPrevented) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
            input,
            input.value + ch,
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
    expect(screen.getByTestId("estado").textContent).toBe("4");
    act(() => {
      input.blur();
    });
    expect(screen.getByTestId("estado").textContent).toBe("45");
  });

  it("hilo principal ocupado: teclas generadas cada 10 ms pero procesadas tarde → igual es un escaneo", () => {
    // Sin reloj inyectado: el provider usa KeyboardEvent.timeStamp (cuándo se generó la tecla).
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ScannerProvider>{children}</ScannerProvider>
      ),
    });
    const teclaGenerada = (key: string, generadaEn: number) => {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      Object.defineProperty(ev, "timeStamp", { value: generadaEn });
      act(() => {
        document.body.dispatchEvent(ev);
      });
    };
    const codigo = "7790001000019";
    teclaGenerada(codigo[0]!, 5000);
    // 200 ms de bloqueo: el resto llega todo junto, pero con sus tiempos originales.
    [...codigo.slice(1)].forEach((ch, i) => teclaGenerada(ch, 5010 + i * 10));
    teclaGenerada("Enter", 5010 + codigo.length * 10);
    expect(onScan).toHaveBeenCalledWith(codigo, { fuente: "pistola" });
  });

  it("ráfaga confirmada con un hipo de 120 ms en el medio (Bluetooth / hilo ocupado) → no se parte el código", () => {
    const onScan = vi.fn();
    function Pantalla() {
      const [v, setV] = useState("");
      useBarcodeScanner({ onScan });
      return <input aria-label="campo" value={v} onChange={(e) => setV(e.target.value)} />;
    }
    render(<Pantalla />, { wrapper: Envoltorio });
    const input = screen.getByLabelText<HTMLInputElement>("campo");
    input.focus();
    escribir("7790001", 10); // 7 teclas a ritmo de máquina: ráfaga confirmada
    escribir("0", 120); // hipo
    escribir("00019", 10, "Enter");
    expect(onScan).toHaveBeenCalledWith("7790001000019", { fuente: "pistola" });
    expect(input.value).toBe("");
  });

  it("…pero antes de confirmarla rige el intervalo estricto: tipeo humano a 80–120 ms no dispara", () => {
    const { onScan } = montar();
    escribir("12", 30);
    escribir("345678", 90, "Enter");
    expect(onScan).not.toHaveBeenCalled();
  });

  it("menos de minLength caracteres → no es un escaneo", () => {
    const { onScan } = montar();
    const enter = escribir("123", 5, "Enter");
    expect(onScan).not.toHaveBeenCalled();
    expect(enter?.defaultPrevented).toBe(false);
  });

  it("normaliza: sin espacios y alfanuméricos en mayúsculas", () => {
    const { onScan } = montar();
    escribir("prd-ab12cd34", 5, "Enter");
    expect(onScan).toHaveBeenCalledWith("PRD-AB12CD34", { fuente: "pistola" });
  });

  it("varios consumidores: procesa solo el último montado; al desmontarlo vuelve el anterior", () => {
    const primero = vi.fn();
    const segundo = vi.fn();
    function Dos({ mostrarSegundo }: { mostrarSegundo: boolean }) {
      useBarcodeScanner({ onScan: primero });
      return mostrarSegundo ? <Segundo /> : null;
    }
    function Segundo() {
      useBarcodeScanner({ onScan: segundo });
      return null;
    }
    const { rerender } = render(<Dos mostrarSegundo />, { wrapper: Envoltorio });
    escribir("7790001000040", 5, "Enter");
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(primero).not.toHaveBeenCalled();

    rerender(<Dos mostrarSegundo={false} />);
    reloj += 1000;
    escribir("7790001000057", 5, "Enter");
    expect(primero).toHaveBeenCalledWith("7790001000057", { fuente: "pistola" });
    expect(segundo).toHaveBeenCalledTimes(1);
  });

  it("enabled=false → no escucha; al desmontar deja de escuchar", () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useBarcodeScanner({ onScan: fnDeshabilitado, enabled }),
      { wrapper: Envoltorio, initialProps: { enabled: false } },
    );
    escribir("7790001000064", 5, "Enter");
    expect(fnDeshabilitado).not.toHaveBeenCalled();
    rerender({ enabled: true });
    reloj += 1000;
    escribir("7790001000071", 5, "Enter");
    expect(fnDeshabilitado).toHaveBeenCalledTimes(1);
    unmount();
    reloj += 1000;
    escribir("7790001000088", 5, "Enter");
    expect(fnDeshabilitado).toHaveBeenCalledTimes(1);
  });
});

const fnDeshabilitado = vi.fn();
