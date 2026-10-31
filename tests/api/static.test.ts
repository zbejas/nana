import { describe, expect, test } from "bun:test";
import { bunRequest, expectStatus, readJson } from "../helpers/client";

describe("PWA and static assets", () => {
    describe("GET /manifest.webmanifest", () => {
        test("returns the manifest with the correct content type and cache header", async () => {
            const res = await bunRequest("/manifest.webmanifest");
            await expectStatus(res, 200);

            expect(res.headers.get("Content-Type")).toContain("application/manifest+json");
            expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
        });

        test("describes Nana and its icons", async () => {
            const data = await readJson<{
                name: string;
                short_name: string;
                start_url: string;
                icons: Array<{ src: string; sizes: string }>;
            }>(await bunRequest("/manifest.webmanifest"));

            expect(data.name).toBe("Nana");
            expect(data.short_name).toBe("Nana");
            expect(data.start_url).toBe("/timeline");
            expect(data.icons.map((icon) => icon.src)).toEqual(
                expect.arrayContaining(["/nana-192.png", "/nana-512.png", "/nana-icon.svg"]),
            );
        });
    });

    describe("GET /sw.js", () => {
        test("serves the service worker without caching it", async () => {
            const res = await bunRequest("/sw.js");
            await expectStatus(res, 200);

            expect(res.headers.get("Content-Type")).toContain("javascript");
            expect(res.headers.get("Cache-Control")).toBe("no-cache");
            expect(await res.text()).toContain("addEventListener");
        });
    });

    describe("icons and worker", () => {
        test("serves the app icons with their content types", async () => {
            const svg = await bunRequest("/nana.svg");
            await expectStatus(svg, 200);
            expect(svg.headers.get("Content-Type")).toContain("image/svg+xml");
            expect((await svg.text()).length).toBeGreaterThan(0);

            const png192 = await bunRequest("/nana-192.png");
            await expectStatus(png192, 200);
            expect(png192.headers.get("Content-Type")).toContain("image/png");

            const png512 = await bunRequest("/nana-512.png");
            await expectStatus(png512, 200);
            expect(png512.headers.get("Content-Type")).toContain("image/png");
        });

        test("serves theme-aware transparent favicons", async () => {
            const dark = await bunRequest("/nana-favicon.svg");
            await expectStatus(dark, 200);
            expect(dark.headers.get("Content-Type")).toContain("image/svg+xml");
            const darkMarkup = await dark.text();
            expect(darkMarkup).toContain("#f5f3ef");
            expect(darkMarkup).not.toContain("<rect width=\"512\" height=\"512\" rx=");

            const light = await bunRequest("/nana-favicon-light.svg");
            await expectStatus(light, 200);
            const lightMarkup = await light.text();
            expect(lightMarkup).toContain("#1a1a18");

            const png = await bunRequest("/nana-favicon-light-16.png");
            await expectStatus(png, 200);
            expect(png.headers.get("Content-Type")).toContain("image/png");
            expect((await png.arrayBuffer()).byteLength).toBeGreaterThan(0);
        });

        test("serves the PDF worker", async () => {
            const res = await bunRequest("/pdfjs/pdf.worker.min.mjs");
            await expectStatus(res, 200);
            expect(res.headers.get("Content-Type")).toContain("javascript");
            expect(res.headers.get("Cache-Control")).toContain("immutable");
        });
    });

    describe("SPA fallback", () => {
        test("serves the app shell for client routes", async () => {
            const res = await bunRequest("/timeline");
            await expectStatus(res, 200);
            expect(res.headers.get("Content-Type")).toContain("text/html");
            expect(await res.text()).toContain("<div id=\"root\">");
        });
    });
});
