import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import SiteShell from "@/components/SiteShell";
import Benchmarks from "@/pages/Benchmarks";
import CaseView from "@/pages/CaseView";
import Demo from "@/pages/Demo";
import Index from "@/pages/Index";

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="headline text-2xl">That page is not here</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-dim">
        Nothing lives at this address. The search and the published numbers are one click away.
      </p>
      <div className="mt-5 flex gap-3">
        <Link to="/demo" className="rounded-md bg-cyan px-4 py-2 text-sm font-medium text-navy-950 hover:bg-cyan-soft">
          Ask a question
        </Link>
        <Link
          to="/benchmarks"
          className="rounded-md border border-navy-600 px-4 py-2 text-sm text-ink hover:bg-navy-800"
        >
          See the numbers
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SiteShell>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/cases/:id" element={<CaseView />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </SiteShell>
    </BrowserRouter>
  );
}
