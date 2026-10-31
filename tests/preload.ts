import { beforeAll } from "bun:test";
import { waitForServer, PB_API, BASE_URL } from "./helpers/setup";

beforeAll(async () => {
    // Wait for the loopback PocketBase health endpoint.
    await waitForServer(`${PB_API}/health`, 30_000);
    // Wait for Bun server itself
    await waitForServer(`${BASE_URL}/api/app/version`, 30_000);
});
