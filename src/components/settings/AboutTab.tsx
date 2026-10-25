import { useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, HeartIcon } from "@heroicons/react/24/outline";
import packageJson from "../../../package.json";
import logo from "../../assets/nana.svg";
import bunLogo from "../../assets/tech_logos/bun.svg";
import reactLogo from "../../assets/tech_logos/react.svg";
import tailwindLogo from "../../assets/tech_logos/tailwind.svg";
import pocketbaseLogo from "../../assets/tech_logos/pocketbase.svg";
import { Badge, Button, Card } from "../ui";

const RELEASES_URL = "https://github.com/zbejas/nana/releases";

interface AppVersionResponse {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releasesUrl: string;
}

const FEATURES = [
  "Markdown writing with live preview",
  "Folders, tags, and a calm timeline",
  "Multiple boards, with an archive for work you set aside",
  "AI chat that reads your notes and boards on request",
  "Public sharing for notes and folders",
  "Version history and a real trash",
  "Attachments, export, and a mobile app shell",
  "Self-hosted, multi-user, and yours",
];

const STACK = [
  { label: "Bun", href: "https://bun.sh", logo: bunLogo },
  { label: "React", href: "https://react.dev", logo: reactLogo },
  { label: "Tailwind", href: "https://tailwindcss.com", logo: tailwindLogo },
  { label: "PocketBase", href: "https://pocketbase.io", logo: pocketbaseLogo },
];

export function AboutTab() {
  const [versionInfo, setVersionInfo] = useState<AppVersionResponse>({
    currentVersion: packageJson.version,
    latestVersion: null,
    updateAvailable: false,
    releasesUrl: RELEASES_URL,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadVersionInfo() {
      try {
        const response = await fetch("/api/app/version");
        if (!response.ok) return;

        const data = (await response.json()) as AppVersionResponse;
        if (!cancelled) {
          setVersionInfo(data);
        }
      } catch {
        // Keep the local package version if the remote check fails.
      }
    }

    void loadVersionInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-5">
            <img src={logo} alt="Nana" className="h-20 w-20 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-3xl leading-none tracking-tight text-ink">Nana</h2>
                <Badge tone="neutral">v{versionInfo.currentVersion}</Badge>
                {versionInfo.updateAvailable && versionInfo.latestVersion && (
                  <Badge tone="signal">v{versionInfo.latestVersion} available</Badge>
                )}
              </div>
              <p className="mt-2 text-base text-ink-secondary">Not Another Notes App</p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-secondary">
                A self-hosted document workspace with a warm desk, a clear board, and your own AI. Built to keep the
                writing — and the work around it — in one place you control.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm" iconRight={<ArrowTopRightOnSquareIcon />}>
                Website
              </Button>
            </a>
            <a href="https://github.com/zbejas/nana" target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm" iconRight={<ArrowTopRightOnSquareIcon />}>
                GitHub
              </Button>
            </a>
            <a href={versionInfo.releasesUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" iconRight={<ArrowTopRightOnSquareIcon />}>
                Releases
              </Button>
            </a>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h3 className="text-lg text-ink">What is inside</h3>
          <ul className="mt-4 space-y-2.5">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-secondary">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted/50" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <h3 className="text-lg text-ink">Built with</h3>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {STACK.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-control border border-line bg-surface-sunken/50 px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
                >
                  <img src={item.logo} alt="" className="h-4 w-4 shrink-0" />
                  {item.label}
                </a>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <HeartIcon className="h-4 w-4 text-signal" />
              <h3 className="text-lg text-ink">Support Nana</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Free and open source, built with care in spare time. If Nana makes your day a little lighter, you can
              support its development.
            </p>
            <a
              href="https://github.com/sponsors/zbejas"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block"
            >
              <Button variant="secondary" size="sm" icon={<HeartIcon />}>
                Sponsor on GitHub
              </Button>
            </a>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-ink-muted">
        <span>
          AGPL-3.0 · © 2026{" "}
          <a href="https://github.com/zbejas" target="_blank" rel="noopener noreferrer" className="text-ink-secondary hover:text-signal">
            Zbejas
          </a>
        </span>
        <span>Self-hosted by you. No telemetry, no third-party account.</span>
      </div>
    </div>
  );
}
