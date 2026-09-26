import { test as base } from "@playwright/test";

/**
 * `page.goto` espera además a que la red quede quieta: la app hace streaming
 * (Suspense) y durante un instante el segmento del servidor todavía oculto
 * convive con el que ya hidrató; interactuar recién con la página asentada es
 * lo que hace una persona (y evita falsos "strict mode violation").
 */
export const test = base.extend({
  page: async ({ page }, usar) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, opciones) => {
      const r = await goto(url, opciones);
      await page.waitForLoadState("networkidle");
      return r;
    };
    await usar(page);
  },
});

export { expect } from "@playwright/test";
