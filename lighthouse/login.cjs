/**
 * puppeteerScript de Lighthouse CI: antes de auditar "/", inicia sesión como
 * dueño (la cookie queda en el navegador que usa Lighthouse). Para "/login",
 * se asegura de NO tener sesión.
 */
module.exports = async (browser, context) => {
  const page = await browser.newPage();
  const base = new URL(context.url).origin;
  if (new URL(context.url).pathname === "/login") {
    const client = await page.createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await page.close();
    return;
  }
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  if (new URL(page.url()).pathname === "/login") {
    await page.type('input[name="email"]', process.env.LHCI_EMAIL || "dueno1@negocio.com");
    await page.type('input[name="password"]', process.env.LHCI_PASSWORD || "DuenoE2E2026");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.click('button[type="submit"]'),
    ]);
  }
  await page.close();
};
