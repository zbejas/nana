import { describe, test, expect, beforeAll } from "bun:test";
import JSZip from "jszip";
import {
    BASE_URL,
    PB_API,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
    signupUser,
} from "../helpers/setup";

describe("Bun API Routes", () => {
    let userToken: string;
    let userId: string;
    let superuserToken: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Check if test user exists, create if not
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='bun-api-test@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = (await listRes.json()) as { items: any[] };
        if (listData.items.length === 0) {
            const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
                headers: { Authorization: superuserToken },
            });
            const checkData = (await checkRes.json()) as { items: any[] };
            if (checkData.items.length === 0) {
                await signupUser({ email: "first@test.local", password: "testPassword123!" });
            }
            await createTestUser(superuserToken, {
                email: "bun-api-test@test.local",
                password: "testPassword123!",
                name: "Bun API Test User",
            });
        }

        const auth = await authenticateUser("bun-api-test@test.local", "testPassword123!");
        userToken = auth.token;
        userId = auth.record.id;
    });

    // ── GET /api/app/version ─────────────────────────────────────────

    describe("GET /api/app/version", () => {
        test("returns 200 with correct shape", async () => {
            const res = await fetch(`${BASE_URL}/api/app/version`);
            expect(res.status).toBe(200);

            const data = (await res.json()) as Record<string, unknown>;
            expect(data).toHaveProperty("currentVersion");
            expect(data).toHaveProperty("latestVersion");
            expect(data).toHaveProperty("updateAvailable");
            expect(data).toHaveProperty("releasesUrl");
        });

        test("currentVersion is a non-empty string", async () => {
            const res = await fetch(`${BASE_URL}/api/app/version`);
            const data = (await res.json()) as { currentVersion: string };
            expect(typeof data.currentVersion).toBe("string");
            expect(data.currentVersion.length).toBeGreaterThan(0);
        });

        test("releasesUrl contains github.com", async () => {
            const res = await fetch(`${BASE_URL}/api/app/version`);
            const data = (await res.json()) as { releasesUrl: string };
            expect(data.releasesUrl).toContain("github.com");
        });

        test("returns 405 for POST", async () => {
            const res = await fetch(`${BASE_URL}/api/app/version`, { method: "POST" });
            expect(res.status).toBe(405);
        });
    });

    // ── POST /api/admin/rate-limits/reload ───────────────────────────

    describe("POST /api/admin/rate-limits/reload", () => {
        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/admin/rate-limits/reload`, {
                method: "POST",
            });
            expect(res.status).toBe(401);
        });

        test("returns 401 with invalid token", async () => {
            const res = await fetch(`${BASE_URL}/api/admin/rate-limits/reload`, {
                method: "POST",
                headers: { Authorization: "invalid-token-value" },
            });
            expect(res.status).toBe(401);
        });

        test("returns 200 with valid auth and correct response shape", async () => {
            const res = await fetch(`${BASE_URL}/api/admin/rate-limits/reload`, {
                method: "POST",
                headers: { Authorization: userToken },
            });
            expect(res.status).toBe(200);

            const data = (await res.json()) as {
                success: boolean;
                config: { enabled: boolean; pbMaxPerMinute: number; appMaxPerMinute: number };
            };
            expect(data.success).toBe(true);
            expect(data.config).toHaveProperty("enabled");
            expect(data.config).toHaveProperty("pbMaxPerMinute");
            expect(data.config).toHaveProperty("appMaxPerMinute");
            expect(typeof data.config.enabled).toBe("boolean");
            expect(typeof data.config.pbMaxPerMinute).toBe("number");
            expect(typeof data.config.appMaxPerMinute).toBe("number");
        });

        test("returns 405 for GET", async () => {
            const res = await fetch(`${BASE_URL}/api/admin/rate-limits/reload`, {
                method: "GET",
            });
            expect(res.status).toBe(405);
        });
    });

    // ── POST /api/export ─────────────────────────────────────────────

    describe("POST /api/export", () => {
        const sanitizeFilename = (name: string): string => {
            const normalizedName = (name || "").trim() || "Untitled";
            return normalizedName
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
                .replace(/\s+/g, "_")
                .replace(/\.+$/, "")
                .trim();
        };

        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/export`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentIds: ["test"] }),
            });
            expect(res.status).toBe(401);
        });

        test("returns 405 for GET", async () => {
            const res = await fetch(`${BASE_URL}/api/export`, {
                method: "GET",
                headers: { Authorization: userToken },
            });
            expect(res.status).toBe(405);
        });

        test("returns 400 with empty body", async () => {
            const res = await fetch(`${BASE_URL}/api/export`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        test("returns 400 with empty arrays", async () => {
            const res = await fetch(`${BASE_URL}/api/export`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ documentIds: [], folderIds: [] }),
            });
            expect(res.status).toBe(400);
        });

        test("returns markdown for a valid single document without attachments", async () => {
            // Create a test document via PocketBase API
            const createRes = await fetch(`${PB_API}/collections/documents/records`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: "Export Test Document",
                    slug: `export-test-${Date.now()}`,
                    content: "# Hello\n\nThis is a test document for export.",
                    author: userId,
                }),
            });
            expect(createRes.status).toBe(200);
            const doc = (await createRes.json()) as { id: string };

            // Export the document
            const exportRes = await fetch(`${BASE_URL}/api/export`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ documentIds: [doc.id] }),
            });
            expect(exportRes.status).toBe(200);

            const contentType = exportRes.headers.get("Content-Type") || "";
            expect(contentType).toContain("text/markdown");

            const contentDisposition = exportRes.headers.get("Content-Disposition") || "";
            expect(contentDisposition).toContain("attachment");
            expect(contentDisposition).toContain('filename="Export_Test_Document.md"');

            const body = await exportRes.text();
            expect(body).toContain("---");
            expect(body).toContain("title: Export Test Document");
            expect(body).toContain("# Hello");
            expect(body).toContain("This is a test document for export.");
        });

        test("returns a zip with nested markdown paths for a folder export", async () => {
            const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const rootFolderName = `Export Root: ${uniqueSuffix}`;
            const childFolderName = "ChildFolder";
            const rootDocTitle = "RootDoc";
            const childDocTitle = "ChildDoc";
            const rootDocBody = "Root folder export body text.";
            const childDocBody = "Child folder export body text.";

            const rootFolderRes = await fetch(`${PB_API}/collections/folders/records`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: rootFolderName,
                    author: userId,
                }),
            });
            expect(rootFolderRes.status).toBe(200);
            const rootFolder = (await rootFolderRes.json()) as { id: string };

            const childFolderRes = await fetch(`${PB_API}/collections/folders/records`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: childFolderName,
                    author: userId,
                    parent: rootFolder.id,
                }),
            });
            expect(childFolderRes.status).toBe(200);
            const childFolder = (await childFolderRes.json()) as { id: string };

            const rootDocRes = await fetch(`${PB_API}/collections/documents/records`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: rootDocTitle,
                    slug: `folder-export-root-${uniqueSuffix}`,
                    content: `# Root\n\n${rootDocBody}`,
                    author: userId,
                    folder: rootFolder.id,
                }),
            });
            expect(rootDocRes.status).toBe(200);

            const childDocRes = await fetch(`${PB_API}/collections/documents/records`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: childDocTitle,
                    slug: `folder-export-child-${uniqueSuffix}`,
                    content: `# Child\n\n${childDocBody}`,
                    author: userId,
                    folder: childFolder.id,
                }),
            });
            expect(childDocRes.status).toBe(200);

            const exportRes = await fetch(`${BASE_URL}/api/export`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ folderIds: [rootFolder.id] }),
            });
            expect(exportRes.status).toBe(200);

            const contentType = exportRes.headers.get("Content-Type") || "";
            expect(contentType).toContain("application/zip");

            const sanitizedRootFolderName = sanitizeFilename(rootFolderName);
            const contentDisposition = exportRes.headers.get("Content-Disposition") || "";
            expect(contentDisposition).toContain("attachment");
            expect(contentDisposition).toContain(`filename="${sanitizedRootFolderName}.zip"`);

            const zip = await JSZip.loadAsync(await exportRes.arrayBuffer());
            const rootDocPath = `${sanitizedRootFolderName}/${sanitizeFilename(rootDocTitle)}.md`;
            const childDocPath = `${sanitizedRootFolderName}/${sanitizeFilename(childFolderName)}/${sanitizeFilename(childDocTitle)}.md`;

            expect(zip.file(rootDocPath)).toBeDefined();
            expect(zip.file(childDocPath)).toBeDefined();

            const rootMarkdown = await zip.file(rootDocPath)!.async("text");
            expect(rootMarkdown).toContain("title: RootDoc");
            expect(rootMarkdown).toContain(rootDocBody);

            const childMarkdown = await zip.file(childDocPath)!.async("text");
            expect(childMarkdown).toContain("title: ChildDoc");
            expect(childMarkdown).toContain(childDocBody);
        });
    });

    // ── GET /manifest.webmanifest ────────────────────────────────────

    describe("GET /manifest.webmanifest", () => {
        test("returns 200", async () => {
            const res = await fetch(`${BASE_URL}/manifest.webmanifest`);
            expect(res.status).toBe(200);
        });

        test("Content-Type includes application/manifest+json", async () => {
            const res = await fetch(`${BASE_URL}/manifest.webmanifest`);
            const contentType = res.headers.get("Content-Type") || "";
            expect(contentType).toContain("application/manifest+json");
        });

        test("body has name, short_name, and icons array", async () => {
            const res = await fetch(`${BASE_URL}/manifest.webmanifest`);
            const data = (await res.json()) as Record<string, unknown>;
            expect(data).toHaveProperty("name");
            expect(data).toHaveProperty("short_name");
            expect(data).toHaveProperty("icons");
            expect(Array.isArray(data.icons)).toBe(true);
        });

        test("name is Nana", async () => {
            const res = await fetch(`${BASE_URL}/manifest.webmanifest`);
            const data = (await res.json()) as { name: string };
            expect(data.name).toBe("Nana");
        });
    });

    // ── GET /sw.js ───────────────────────────────────────────────────

    describe("GET /sw.js", () => {
        test("returns 200", async () => {
            const res = await fetch(`${BASE_URL}/sw.js`);
            expect(res.status).toBe(200);
        });

        test("Content-Type includes javascript", async () => {
            const res = await fetch(`${BASE_URL}/sw.js`);
            const contentType = res.headers.get("Content-Type") || "";
            expect(contentType).toContain("javascript");
        });

        test("body contains addEventListener", async () => {
            const res = await fetch(`${BASE_URL}/sw.js`);
            const body = await res.text();
            expect(body).toContain("addEventListener");
        });
    });

    // ── POST /api/chat/send ──────────────────────────────────────────

    describe("POST /api/chat/send", () => {
        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/chat/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "hello" }),
            });
            expect(res.status).toBe(401);
        });

        test("with auth but no AI config, returns non-401 error", async () => {
            const res = await fetch(`${BASE_URL}/api/chat/send`, {
                method: "POST",
                headers: {
                    Authorization: userToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ message: "hello" }),
            });
            // Auth should pass — the error should be something else (e.g., 400, 500)
            expect(res.status).not.toBe(401);
        });
    });

    // ── GET /api/chat/conversations ──────────────────────────────────

    describe("GET /api/chat/conversations", () => {
        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/chat/conversations`);
            expect(res.status).toBe(401);
        });

        test("returns 200 with valid auth", async () => {
            const res = await fetch(`${BASE_URL}/api/chat/conversations`, {
                headers: { Authorization: userToken },
            });
            expect(res.status).toBe(200);
        });
    });

    // ── POST /api/embeddings/embed ───────────────────────────────────

    describe("POST /api/embeddings/embed", () => {
        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/embeddings/embed`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: "test" }),
            });
            expect(res.status).toBe(401);
        });
    });

    // ── GET /api/embeddings/status ───────────────────────────────────

    describe("GET /api/embeddings/status", () => {
        test("returns 401 without auth header", async () => {
            const res = await fetch(`${BASE_URL}/api/embeddings/status`);
            expect(res.status).toBe(401);
        });
    });
});
