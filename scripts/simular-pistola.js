/**
 * Simula una pistola lectora (keyboard wedge) desde la consola del navegador.
 * Pegalo en DevTools → Console en cualquier pantalla con escáner (/escanear,
 * /compras/nueva, /movimientos/ingreso…) y llamá, por ejemplo:
 *
 *   simularPistola("7790001000019")            // Ignite V80 — Mango Ice (seed)
 *   simularPistola("7790001000019", { veces: 3 })
 *   simularPistola("]C17790002000018", { intervalo: 8, sufijo: "Tab" })   // con prefijo
 *
 * Manda un keydown por carácter cada `intervalo` ms (10 por defecto, una
 * pistola real tarda 5–30 ms) y termina con Enter. Entre repeticiones espera
 * 400 ms (el detector ignora el mismo código dos veces en menos de 300 ms).
 * Los eventos van al elemento con foco, igual que los de una pistola real.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- se usa desde la consola del navegador
async function simularPistola(codigo, { intervalo = 10, sufijo = "Enter", veces = 1 } = {}) {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const tecla = (key) =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  for (let i = 0; i < veces; i++) {
    if (i > 0) await dormir(400);
    for (const ch of String(codigo)) {
      tecla(ch);
      await dormir(intervalo);
    }
    tecla(sufijo);
  }
  return `${veces} escaneo(s) de ${codigo}`;
}
