import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { obtenerEnv, reiniciarEnv } from "@/env";
import { enviarMail, fijarTransporteMail, mailConfigurado, mailsDuenos } from "@/server/mail";

/** Variables de mail (src/env.ts) y envío con transportes de prueba: nunca sale un mail real. */
const BASE = {
  DATABASE_URL: "postgresql://app:app@localhost:5433/x",
  AUTH_SECRET: "secreto-de-prueba-para-vitest-de-al-menos-32",
};
const CLAVES = [
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "MAIL_DUENOS",
  "MAIL_TRANSPORTE",
  "MAIL_PRUEBA_DIR",
  "MAIL_FROM_NAME",
];
let antes: NodeJS.ProcessEnv;

function entorno(extra: Record<string, string>) {
  for (const k of CLAVES) delete process.env[k];
  Object.assign(process.env, BASE, extra);
  reiniciarEnv();
}

beforeEach(() => {
  antes = { ...process.env };
});
afterEach(() => {
  process.env = antes;
  reiniciarEnv();
  fijarTransporteMail(null);
});

const mail = { para: ["trinidad@negocio.test"], asunto: "Remito", texto: "Hola" };

describe("variables de entorno del mail", () => {
  it("sin Gmail: válido y «sin configurar»", async () => {
    entorno({});
    expect(mailConfigurado()).toBe(false);
    expect(mailsDuenos()).toEqual([]);
    expect(await enviarMail(mail, "Negocio")).toEqual({
      estado: "SIN_CONFIGURAR",
      detalle: "mail sin configurar",
      messageId: null,
    });
  });

  it("GMAIL_USER y GMAIL_APP_PASSWORD van juntas; la contraseña son 16 letras (con o sin espacios)", () => {
    entorno({ GMAIL_USER: "duenos@gmail.com" });
    expect(() => obtenerEnv()).toThrow(/GMAIL_APP_PASSWORD/);
    entorno({ GMAIL_USER: "duenos@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh" });
    expect(() => obtenerEnv()).toThrow(/16 letras/);
    entorno({ GMAIL_USER: "Duenos@Gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" });
    expect(obtenerEnv()).toMatchObject({
      GMAIL_USER: "duenos@gmail.com",
      GMAIL_APP_PASSWORD: "abcdefghijklmnop",
    });
    expect(mailConfigurado()).toBe(true);
    // Sin MAIL_DUENOS, el remito firmado va a la casilla de Gmail.
    expect(mailsDuenos()).toEqual(["duenos@gmail.com"]);
  });

  it("MAIL_DUENOS: lista separada por comas, validada", () => {
    entorno({ MAIL_DUENOS: "a@x.com, B@x.com" });
    expect(mailsDuenos()).toEqual(["a@x.com", "b@x.com"]);
    entorno({ MAIL_DUENOS: "a@x.com, no-es-mail" });
    expect(() => obtenerEnv()).toThrow(/MAIL_DUENOS/);
  });
});

describe("envío con transporte de prueba", () => {
  it("streamTransport: arma el mail con remitente, destinatarios y adjunto", async () => {
    entorno({ MAIL_FROM_NAME: "Bisschen" });
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
    let crudo = "";
    const enviar = t.sendMail.bind(t);
    t.sendMail = (async (o: never) => {
      const info = (await enviar(o)) as { message: Buffer };
      crudo = info.message.toString();
      return info;
    }) as never;
    fijarTransporteMail(t);
    const r = await enviarMail(
      {
        ...mail,
        responderA: "juancruz@negocio.test",
        adjuntos: [
          {
            nombre: "remito.pdf",
            contenido: new Uint8Array([37, 80, 68, 70]),
            tipo: "application/pdf",
          },
        ],
      },
      "Negocio",
    );
    expect(r.estado).toBe("ENVIADO");
    expect(crudo).toContain("From: Bisschen <no-responder@localhost>");
    expect(crudo).toContain("To: trinidad@negocio.test");
    expect(crudo).toContain("Reply-To: juancruz@negocio.test");
    expect(crudo).toContain("filename=remito.pdf");
  });

  it("MAIL_TRANSPORTE=prueba: guarda el mail como JSON en MAIL_PRUEBA_DIR", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mails-"));
    entorno({ MAIL_TRANSPORTE: "prueba", MAIL_PRUEBA_DIR: dir });
    expect(mailConfigurado()).toBe(true);
    expect((await enviarMail(mail, "Negocio")).estado).toBe("ENVIADO");
    const [archivo] = readdirSync(dir);
    const json = JSON.parse(readFileSync(path.join(dir, archivo!), "utf8")) as {
      subject: string;
      to: { address: string }[];
    };
    expect(json.subject).toBe("Remito");
    expect(json.to[0]?.address).toBe("trinidad@negocio.test");
  });

  it("un error del SMTP vuelve como ERROR (no lanza)", async () => {
    entorno({});
    fijarTransporteMail({
      sendMail: async () => {
        throw new Error("535 Username and Password not accepted");
      },
    } as never);
    const r = await enviarMail(mail, "Negocio");
    expect(r).toMatchObject({ estado: "ERROR", detalle: "535 Username and Password not accepted" });
  });
});
