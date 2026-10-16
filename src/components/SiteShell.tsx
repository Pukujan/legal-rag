import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/demo", label: "Ask" },
  { to: "/benchmarks", label: "Benchmarks" },
];

export default function SiteShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-navy-800 focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="border-b border-navy-800/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link
            to="/"
            className="flex items-baseline gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
          >
            <span className="headline text-[1.05rem]">Starfield</span>
            <span className="hidden text-xs text-ink-mute sm:inline">US case law, shown with its receipts</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan",
                  pathname.startsWith(item.to) ? "bg-navy-800 text-ink" : "text-ink-mute hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-navy-800/80">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-ink-mute sm:flex-row sm:items-center sm:justify-between">
          <p>Research aid only. Not legal advice. Always read the full opinion.</p>
          <p>
            Questions are logged without your name, without your device and without any contact details in
            the text, and what is logged is published on the{" "}
            <Link to="/benchmarks" className="text-cyan-soft underline-offset-4 hover:underline">
              Benchmarks
            </Link>{" "}
            page.
          </p>
        </div>
      </footer>
    </div>
  );
}
