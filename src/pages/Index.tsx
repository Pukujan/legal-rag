import { Link } from "react-router-dom";
import StarField from "@/components/StarField";
import { SceneGraph } from "@/lib/scene";
import { useReducedMotion } from "@/lib/useReducedMotion";

const PROMISES = [
  {
    title: "Every sentence points at the page it came from",
    body: "Each statement carries a number. Press it and you are in the opinion, at the words underneath it — not a summary of a summary.",
  },
  {
    title: "Nothing gets said that the opinions do not say",
    body: "If a sentence cannot be matched word for word to a stored passage, it is left out. You are told it was left out and why.",
  },
  {
    title: "When it does not know, it says so",
    body: "If the passages found do not really answer your question, you get that answer instead of a confident-sounding paragraph.",
  },
  {
    title: "You can see how it reached the shortlist",
    body: "The opinions it looked at, the reason each one turned up, and how long each step took — beside the answer, not hidden behind it.",
  },
];

const idleScene = new SceneGraph();

export default function Index() {
  const reducedMotion = useReducedMotion();

  return (
    <div>
      <section className="relative isolate overflow-hidden">
        <StarField
          scene={idleScene}
          revision={0}
          mode="ambient"
          reducedMotion={reducedMotion}
          className="absolute inset-0 -z-10 h-full w-full"
        />
        <div className="mx-auto w-full max-w-3xl px-5 pb-20 pt-16 sm:pb-28 sm:pt-24">
          <p className="eyebrow">Case-law research</p>
          <h1 className="headline mt-3 text-[2rem] leading-[1.15] sm:text-[2.7rem]">
            Read the opinion behind every sentence of your research note.
          </h1>
          <p className="mt-5 max-w-prose text-[1.02rem] leading-relaxed text-ink-dim">
            You already know the risk: a paragraph that sounds right, written from a summary, that nobody
            checked against the court&apos;s own words. Starfield answers your question out of the stored
            opinions and keeps the passage attached to each line, so checking takes seconds and a bad note
            never leaves your desk.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/demo"
              className="inline-flex h-12 items-center rounded-md bg-cyan px-6 font-medium text-navy-950 transition-[background] duration-150 hover:bg-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              Ask a question about case law
            </Link>
            <span className="text-sm text-ink-mute">No account, no upload — one box, one question.</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="promise-heading" className="mx-auto w-full max-w-6xl px-5 pb-16">
        <h2 id="promise-heading" className="headline text-xl">
          What you get, every time
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {PROMISES.map((item) => (
            <li key={item.title} className="card-surface p-5">
              <h3 className="headline text-[1.02rem]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 pb-20">
        <h2 className="headline text-xl">What is actually in here</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          4,151 US court opinions with stored text, inside a larger citation graph. That is the whole
          collection — it is not the law of every court, and a missing opinion is not the same as no
          opinion. Where the answer is thin, the page says so.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-dim">
          Searching runs in nine steps, and you watch them: read the question, look for your words, look
          for the same meaning in other words, merge the two shortlists, follow the citations between
          opinions, re-order by fit, weigh the evidence, write, then check every line against its quote.
          The points of light on the Ask page are the opinions that surfaced in those steps.
        </p>
        <p className="mt-6 text-sm text-ink-mute">
          The numbers it is judged on are public, along with every question people have asked it (with
          names, addresses and numbers stripped out):{" "}
          <Link to="/benchmarks" className="text-cyan-soft underline-offset-4 hover:underline">
            Benchmarks
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
