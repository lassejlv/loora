import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { Databuddy } from "@databuddy/sdk/react";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { THEME_INIT_SCRIPT, watchSystemTheme } from "#/lib/theme";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "loora",
      },
      {
        name: "theme-color",
        content: "#2440e6",
      },
      {
        name: "application-name",
        content: "loora",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "loora",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Prefer PNG in the tab; ICO is the fallback for older clients.
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
    scripts: [
      {
        children: THEME_INIT_SCRIPT,
      },
    ],
  }),
  shellComponent: RootDocument,
});

// The id is a public identifier (every visitor sees it; Databuddy's domain
// allowlist is the protection), so a hardcoded fallback is safe. The env var
// still wins so other environments can point elsewhere or set '' to disable.
// Railway's Dockerfile build-arg passthrough proved unreliable, hence the
// fallback.
const DATABUDDY_CLIENT_ID =
  (import.meta.env.VITE_DATABUDDY_CLIENT_ID as string | undefined) ??
  "c54c0e63-bc75-4058-b37a-75e3b5323ea2";

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => watchSystemTheme(), []);
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {DATABUDDY_CLIENT_ID && (
          <Databuddy
            clientId={DATABUDDY_CLIENT_ID}
            trackWebVitals
            trackErrors
            trackHashChanges={true}
            trackAttributes={true}
            trackOutgoingLinks={true}
            trackInteractions={true}
          />
        )}
        <NuqsAdapter>{children}</NuqsAdapter>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
