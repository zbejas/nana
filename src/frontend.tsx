/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { createLogger } from "./lib/logger";

const log = createLogger('SW');

function start() {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <Provider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Provider>
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      log.error('Service worker registration failed', error);
    });
  });
}
