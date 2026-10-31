import { describe, expect, test } from "bun:test";
import { rewriteLegacyFileUrl } from "../../src/lib/legacy-urls";

describe("legacy file URLs", () => {
    test("moves old /pb file paths onto the Elysia facade", () => {
        expect(rewriteLegacyFileUrl("/pb/api/files/documents/doc123/image.png"))
            .toBe("/api/v1/files/documents/doc123/image.png");
        expect(rewriteLegacyFileUrl("https://nana.example/pb/api/files/users/user123/avatar.png?thumb=100x100"))
            .toBe("https://nana.example/api/v1/files/users/user123/avatar.png?thumb=100x100");
    });

    test("leaves current, external, and empty URLs alone", () => {
        expect(rewriteLegacyFileUrl("/api/v1/files/documents/doc123/image.png"))
            .toBe("/api/v1/files/documents/doc123/image.png");
        expect(rewriteLegacyFileUrl("https://example.com/image.png"))
            .toBe("https://example.com/image.png");
        expect(rewriteLegacyFileUrl(undefined)).toBeUndefined();
        expect(rewriteLegacyFileUrl("")).toBe("");
    });
});
