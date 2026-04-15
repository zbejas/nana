import packageJson from "../../../package.json";
import logo from "../../assets/nana.svg";
import bunLogo from "../../assets/tech_logos/bun.svg";
import reactLogo from "../../assets/tech_logos/react.svg";
import tailwindLogo from "../../assets/tech_logos/tailwind.svg";
import pocketbaseLogo from "../../assets/tech_logos/pocketbase.svg";

export function AboutTab() {
  const runtimePackages = Object.entries(packageJson.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const devPackages = Object.entries(packageJson.devDependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-full flex flex-col">
      <div className="flex-1 rounded-lg border border-white/10 bg-white/5 p-6">
      <div className="flex-1 space-y-6">
        <header className="flex items-center gap-4">
          <div className="flex-shrink-0">
            <img 
              src={logo} 
              alt="Nana Logo" 
              className="w-16 h-16 rounded-lg"
            />
          </div>

          <div className="flex-1">
            <h2 className="text-2xl font-bold text-white">Nana</h2>
            <p className="text-gray-400 text-sm italic">Not Another Notes App</p>
          </div>
        </header>

        <p className="text-gray-300 text-sm leading-relaxed">
          A self-hosted markdown document management system with version control, designed for simplicity and privacy.
        </p>

        <div className="border-t border-white/10 pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Version Information</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-24">App Version</span>
                  <span className="text-white font-medium">{packageJson.version}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-24">License</span>
                  <a 
                    href="https://github.com/zbejas/nana/blob/master/LICENSE" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-white font-medium hover:text-blue-400 transition-colors"
                  >
                    AGPL-3.0
                  </a>
                </div>
              </div>

              <div className="mt-5">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Built with</h4>
                <div className="grid grid-cols-2 gap-1.5 max-w-sm">
                  <a
                    href="https://bun.sh"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <img src={bunLogo} alt="Bun" className="h-[18px] w-[18px] shrink-0" />
                    <span>Bun</span>
                  </a>
                  <a
                    href="https://react.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <img src={reactLogo} alt="React" className="h-[18px] w-[18px] shrink-0" />
                    <span>React</span>
                  </a>
                  <a
                    href="https://tailwindcss.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <img src={tailwindLogo} alt="Tailwind" className="h-[18px] w-[18px] shrink-0" />
                    <span>Tailwind CSS</span>
                  </a>
                  <a
                    href="https://pocketbase.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <img src={pocketbaseLogo} alt="PocketBase" className="h-[18px] w-[18px] shrink-0" />
                    <span>PocketBase</span>
                  </a>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Features</h3>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Rich markdown editor with live preview</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Organized documents</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Attach files to documents</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Powerful search and filters</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Multi-user support with user management</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>SMTP support</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Self-hosted for privacy and control</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <section className="border-t border-white/10 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Packages</h3>
            <span className="text-xs text-gray-500">
              {runtimePackages.length} runtime, {devPackages.length} dev
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <ul className="space-y-1 rounded-lg border border-white/10 bg-black/20 p-3">
              {runtimePackages.map(([name, version]) => (
                <li key={name} className="flex items-center justify-between gap-3 text-xs">
                  <a 
                    href={`https://www.npmjs.com/package/${name}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-gray-300 hover:text-blue-400 transition-colors"
                  >
                    {name}
                  </a>
                  <span className="text-gray-500">{version}</span>
                </li>
              ))}
            </ul>

            <ul className="space-y-1 rounded-lg border border-white/10 bg-black/20 p-3">
              {devPackages.map(([name, version]) => (
                <li key={name} className="flex items-center justify-between gap-3 text-xs">
                  <a 
                    href={`https://www.npmjs.com/package/${name}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-gray-300 hover:text-blue-400 transition-colors"
                  >
                    {name}
                  </a>
                  <span className="text-gray-500">{version}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
      <footer className="mt-6 border-t border-white/10 pt-6">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>© 2026 <a href="https://github.com/zbejas" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">Zbejas</a></span>
          <a 
            href="https://github.com/zbejas/nana" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            View on GitHub →
          </a>
        </div>
      </footer>
      </div>
    </div>
  );
}
