import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeApp, MONDAY_9AM } from "./helpers.ts";

describe("favicon", () => {
  it("simgeler gerçek dosya olarak, doğru türle sunulur (SPA yedeğine düşmez)", async () => {
    const { app } = makeApp(MONDAY_9AM);
    for (const [path, type] of [["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/], ["/icon-16.png", /image\/png/], ["/icon-32.png", /image\/png/], ["/icon-192.png", /image\/png/], ["/icon-512.png", /image\/png/], ["/apple-touch-icon.png", /image\/png/]] as const) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(type);
    }
  });

  it("site ve panel sayfası simgeleri bağlar", () => {
    for (const file of ["web/index.html", "panel/index.html"]) {
      const html = readFileSync(file, "utf8");
      expect(html, file).toContain('rel="icon"');
      expect(html, file).toContain('href="/apple-touch-icon.png"');
    }
  });
});
