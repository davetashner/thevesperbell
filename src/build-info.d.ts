// Build-time constants injected by vite.config.ts `define` (mw-e00.21).

/** Short commit SHA of this build, shown on screen next to the scene name. */
declare const __BUILD_SHA__: string;

/**
 * Whether this build includes the debug console (mw-e33.1): true unless built with
 * VESPER_DEBUG_CONSOLE=off, which drops the console chunk from the build entirely.
 */
declare const __DEBUG_CONSOLE__: boolean;

/**
 * Whether this build includes the input latency and controller cost probe (mw-e02.8): true in builds
 * made with VESPER_LATENCY_PROBE=on, false in every other build (the dev server also enables it, by
 * import.meta.env.DEV in src/main.ts).
 */
declare const __LATENCY_PROBE__: boolean;
