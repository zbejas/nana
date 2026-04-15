/**
 * logger.ts — Structured logger for Nana.
 *
 * Works in both **browser console** (CSS `%c` styling) and
 * **terminal / Node / Bun** (ANSI escape codes).
 *
 * In production, `debug` output is silenced. All other levels always log.
 *
 * Usage:
 *   import { createLogger } from "@/lib/logger";
 *   const log = createLogger("Auth");
 *   log.info("Login successful", { userId: "abc" });
 *   log.warn("Token expires soon");
 *   log.error("Failed to save", err);
 *   log.debug("Raw PB record", record);
 *   log.group("Batch operation");
 *   log.groupEnd();
 *   log.table(data);
 *   log.time("fetch");
 *   log.timeEnd("fetch");
 *
 * Legacy singleton (for files that haven't migrated yet):
 *   import { logger } from "@/lib/logger";
 *   logger.info("Hello");            // module = "App"
 *   logger.error("Boom", { id: 1 }); // meta spread as extra arg
 */

// ── Environment detection ───────────────────────────────────────────

const IS_DEV =
    typeof process !== "undefined"
        ? process.env.NODE_ENV !== "production"
        : true;

/** True when running inside a browser (has `window`). */
const IS_BROWSER = typeof window !== "undefined";

// ── ANSI helpers (terminal) ─────────────────────────────────────────

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    fg: {
        blue: "\x1b[34m",
        cyan: "\x1b[36m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        red: "\x1b[31m",
        magenta: "\x1b[35m",
        white: "\x1b[37m",
        gray: "\x1b[90m",
    },
    bg: {
        red: "\x1b[41m",
        yellow: "\x1b[43m",
    },
} as const;

// ── Color palettes ──────────────────────────────────────────────────

/** Browser palette: hex colors used in CSS `%c` styles. */
const BROWSER_PALETTE = [
    "#7c8af6", // soft indigo
    "#5ba0f5", // sky blue
    "#45b97c", // emerald
    "#eab050", // warm amber
    "#ef6b73", // soft red
    "#a78bfa", // lavender
    "#f08c49", // peach
    "#38bec9", // teal
    "#c27adb", // orchid
    "#78909c", // slate
];

/** Terminal palette: ANSI color codes (matched to browser palette). */
const TERMINAL_PALETTE = [
    ANSI.fg.blue,
    ANSI.fg.cyan,
    ANSI.fg.green,
    ANSI.fg.yellow,
    ANSI.fg.red,
    ANSI.fg.magenta,
    ANSI.fg.cyan,
    ANSI.fg.green,
    ANSI.fg.magenta,
    ANSI.fg.gray,
];

let colorIndex = 0;
const moduleColorsBrowser = new Map<string, string>();
const moduleColorsTerminal = new Map<string, string>();

function getBrowserColor(module: string): string {
    const existing = moduleColorsBrowser.get(module);
    if (existing) return existing;
    const color =
        BROWSER_PALETTE[colorIndex % BROWSER_PALETTE.length] ?? "#78909c";
    moduleColorsBrowser.set(module, color);
    return color;
}

function getTerminalColor(module: string): string {
    const existing = moduleColorsTerminal.get(module);
    if (existing) return existing;
    const color =
        TERMINAL_PALETTE[colorIndex % TERMINAL_PALETTE.length] ?? ANSI.fg.white;
    moduleColorsTerminal.set(module, color);
    colorIndex++;
    return color;
}

// ── Level config ────────────────────────────────────────────────────

interface LevelCfg {
    icon: string;
    browserColor: string;
    ansi: string;
    method: "log" | "warn" | "error" | "debug";
    /** If true, only emit in development. */
    devOnly?: boolean;
}

const LEVELS: Record<string, LevelCfg> = {
    info: {
        icon: "●",
        browserColor: "#5ba0f5",
        ansi: ANSI.fg.blue,
        method: "log",
    },
    warn: {
        icon: "▲",
        browserColor: "#eab050",
        ansi: ANSI.fg.yellow,
        method: "warn",
    },
    error: {
        icon: "✖",
        browserColor: "#ef6b73",
        ansi: ANSI.fg.red,
        method: "error",
    },
    debug: {
        icon: "◆",
        browserColor: "#78909c",
        ansi: ANSI.fg.gray,
        method: "debug",
        devOnly: true,
    },
};

// ── Logger interface ────────────────────────────────────────────────

export interface Logger {
    /** Informational message — general flow events. */
    info(message: string, ...data: unknown[]): void;
    /** Warning — something unexpected but non-fatal. */
    warn(message: string, ...data: unknown[]): void;
    /** Error — a failure that should be investigated. */
    error(message: string, ...data: unknown[]): void;
    /** Debug — verbose output, silenced in production. */
    debug(message: string, ...data: unknown[]): void;
    /** Start a collapsed console group (browser) / header line (terminal). */
    group(label: string): void;
    /** End the current console group. */
    groupEnd(): void;
    /** Render tabular data via console.table. */
    table(data: unknown): void;
    /** Start a named timer. */
    time(label: string): void;
    /** End a named timer and print elapsed time. */
    timeEnd(label: string): void;
}

// ── Timestamp ───────────────────────────────────────────────────────

function timestamp(): string {
    return new Date().toLocaleTimeString("en-GB", {
        hour12: false,
        fractionalSecondDigits: 3,
    });
}

// ── Browser logger ──────────────────────────────────────────────────

function createBrowserLogger(module: string): Logger {
    const color = getBrowserColor(module);
    getTerminalColor(module); // keep color indexes in sync

    const sModule = `color:${color};font-weight:700`;
    const sTs = "color:#666;font-weight:400;font-size:10px";
    const sMsg = "color:inherit;font-weight:400";
    const sReset = "color:inherit;font-weight:400";

    function emit(level: string, message: string, data: unknown[]) {
        const cfg = LEVELS[level];
        if (!cfg) return;
        if (cfg.devOnly && !IS_DEV) return;

        const { icon, browserColor, method } = cfg;
        const sIcon = `color:${browserColor};font-weight:700`;
        const ts = timestamp();

        const fmt = `%c${icon} %c${module}%c  ${ts}  %c${message}`;
        const styles = [sIcon, sModule, sTs, sMsg];

        if (data.length > 0) {
            console[method](fmt, ...styles, ...data);
        } else {
            console[method](fmt, ...styles);
        }
    }

    const timerLabel = (l: string) => `⏱ ${module} › ${l}`;

    return {
        info: (msg, ...d) => emit("info", msg, d),
        warn: (msg, ...d) => emit("warn", msg, d),
        error: (msg, ...d) => emit("error", msg, d),
        debug: (msg, ...d) => emit("debug", msg, d),

        group(label) {
            console.groupCollapsed(
                `%c▸ %c${module}%c  ${label}`,
                `color:${color};font-weight:700`,
                sModule,
                sReset
            );
        },
        groupEnd() {
            console.groupEnd();
        },
        table(data) {
            console.table(data);
        },
        time(label) {
            console.time(timerLabel(label));
        },
        timeEnd(label) {
            console.timeEnd(timerLabel(label));
        },
    };
}

// ── Terminal logger ─────────────────────────────────────────────────

function createTerminalLogger(module: string): Logger {
    getBrowserColor(module); // keep color indexes in sync
    const ansiMod = getTerminalColor(module);

    const R = ANSI.reset;
    const B = ANSI.bold;
    const D = ANSI.dim;

    /** Pad module name to 14 chars for alignment. */
    const padded = module.padEnd(14);

    function emit(level: string, message: string, data: unknown[]) {
        const cfg = LEVELS[level];
        if (!cfg) return;
        if (cfg.devOnly && !IS_DEV) return;

        const { icon, ansi, method } = cfg;
        const ts = timestamp();

        const line = `${ansi}${icon}${R} ${B}${ansiMod}${padded}${R} ${D}${ts}${R}  ${message}`;

        if (data.length > 0) {
            console[method](line, ...data);
        } else {
            console[method](line);
        }
    }

    const timerLabel = (l: string) => `⏱ ${module} › ${l}`;
    let groupDepth = 0;

    return {
        info: (msg, ...d) => emit("info", msg, d),
        warn: (msg, ...d) => emit("warn", msg, d),
        error: (msg, ...d) => emit("error", msg, d),
        debug: (msg, ...d) => emit("debug", msg, d),

        group(label) {
            const indent = "  ".repeat(groupDepth);
            console.log(`${indent}${B}${ansiMod}▸ ${padded}${R}  ${label}`);
            groupDepth++;
        },
        groupEnd() {
            if (groupDepth > 0) groupDepth--;
        },

        table(data) {
            if (typeof console.table === "function") {
                console.table(data);
            } else {
                console.log(data);
            }
        },

        time(label) {
            console.time(timerLabel(label));
        },
        timeEnd(label) {
            console.timeEnd(timerLabel(label));
        },
    };
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a scoped logger for a specific module / component.
 *
 * @param module  A short label like "Auth", "Proxy", "Realtime"
 * @returns A Logger instance (debug-only silenced in production)
 *
 * Browser console:   ● Auth  12:34:56.789  Login successful  { userId: "abc" }
 * Terminal:          ● Auth          12:34:56.789  Login successful  { userId: "abc" }
 */
export function createLogger(module: string): Logger {
    return IS_BROWSER ? createBrowserLogger(module) : createTerminalLogger(module);
}

// ── Legacy singleton ────────────────────────────────────────────────

/**
 * Pre-made logger with module = "App".
 * Kept for backward-compatibility — prefer `createLogger("YourModule")`.
 */
export const logger = createLogger("App");
export default logger;
