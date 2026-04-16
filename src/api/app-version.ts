import packageJson from "../../package.json";
import { createLogger } from "../lib/logger";

const log = createLogger("AppVersion");

const APP_VERSION = packageJson.version;
const GITHUB_OWNER = "zbejas";
const GITHUB_REPO = "nana";
const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const TAGS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=1`;
const CACHE_TTL_MS = 15 * 60 * 1000;

interface AppVersionResponse {
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    releasesUrl: string;
}

let cachedPayload: AppVersionResponse | null = null;
let cacheExpiresAt = 0;
let pendingPayload: Promise<AppVersionResponse> | null = null;

function normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, "");
}

function parseVersion(version: string): { core: number[]; prerelease: Array<number | string> } {
    const normalized = normalizeVersion(version);
    const [corePart = "", prereleasePart] = normalized.split("-", 2);

    return {
        core: corePart
            .split(".")
            .map((part) => Number.parseInt(part, 10))
            .map((part) => (Number.isFinite(part) ? part : 0)),
        prerelease: prereleasePart
            ? prereleasePart.split(".").map((part) => {
                const numericValue = Number.parseInt(part, 10);
                return /^\d+$/.test(part) && Number.isFinite(numericValue)
                    ? numericValue
                    : part.toLowerCase();
            })
            : [],
    };
}

function compareVersions(left: string, right: string): number {
    const leftVersion = parseVersion(left);
    const rightVersion = parseVersion(right);
    const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);

    for (let index = 0; index < coreLength; index += 1) {
        const leftPart = leftVersion.core[index] ?? 0;
        const rightPart = rightVersion.core[index] ?? 0;

        if (leftPart !== rightPart) {
            return leftPart > rightPart ? 1 : -1;
        }
    }

    const leftPrerelease = leftVersion.prerelease;
    const rightPrerelease = rightVersion.prerelease;

    if (leftPrerelease.length === 0 && rightPrerelease.length === 0) {
        return 0;
    }

    if (leftPrerelease.length === 0) {
        return 1;
    }

    if (rightPrerelease.length === 0) {
        return -1;
    }

    const prereleaseLength = Math.max(leftPrerelease.length, rightPrerelease.length);

    for (let index = 0; index < prereleaseLength; index += 1) {
        const leftPart = leftPrerelease[index];
        const rightPart = rightPrerelease[index];

        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;

        if (typeof leftPart === "number" && typeof rightPart === "number") {
            return leftPart > rightPart ? 1 : -1;
        }

        if (typeof leftPart === "number") return -1;
        if (typeof rightPart === "number") return 1;

        return leftPart > rightPart ? 1 : -1;
    }

    return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
    const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "nana-version-check",
    };

    try {
        const releaseResponse = await fetch(LATEST_RELEASE_API_URL, { headers });

        if (releaseResponse.ok) {
            const release = await releaseResponse.json() as { tag_name?: string };
            if (release.tag_name) {
                return normalizeVersion(release.tag_name);
            }
        } else if (releaseResponse.status !== 404) {
            log.warn(`GitHub latest release request failed with ${releaseResponse.status}`);
        }
    } catch (error) {
        log.warn("GitHub latest release request failed", error);
    }

    try {
        const tagResponse = await fetch(TAGS_API_URL, { headers });

        if (!tagResponse.ok) {
            log.warn(`GitHub tags request failed with ${tagResponse.status}`);
            return null;
        }

        const tags = await tagResponse.json() as Array<{ name?: string }>;
        const latestTag = tags[0]?.name;

        return latestTag ? normalizeVersion(latestTag) : null;
    } catch (error) {
        log.warn("GitHub tags request failed", error);
        return null;
    }
}

async function buildPayload(): Promise<AppVersionResponse> {
    const latestVersion = await fetchLatestVersion();

    return {
        currentVersion: APP_VERSION,
        latestVersion,
        updateAvailable: latestVersion ? compareVersions(latestVersion, APP_VERSION) > 0 : false,
        releasesUrl: RELEASES_URL,
    };
}

async function getVersionPayload(): Promise<AppVersionResponse> {
    if (cachedPayload && Date.now() < cacheExpiresAt) {
        return cachedPayload;
    }

    if (!pendingPayload) {
        pendingPayload = buildPayload()
            .then((payload) => {
                cachedPayload = payload;
                cacheExpiresAt = Date.now() + CACHE_TTL_MS;
                return payload;
            })
            .finally(() => {
                pendingPayload = null;
            });
    }

    return pendingPayload;
}

export async function handleAppVersion(req: Request): Promise<Response> {
    if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    try {
        const payload = await getVersionPayload();

        return new Response(JSON.stringify(payload), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=300",
            },
        });
    } catch (error) {
        log.error("Failed to resolve app version metadata", error);

        return new Response(JSON.stringify({
            currentVersion: APP_VERSION,
            latestVersion: null,
            updateAvailable: false,
            releasesUrl: RELEASES_URL,
        } satisfies AppVersionResponse), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    }
}
