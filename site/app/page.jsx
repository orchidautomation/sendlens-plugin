import WaitlistForm from "./waitlist-form";

const QUESTIONS = [
  "Rank every active campaign by what most needs attention: bounce risk, lead runway, or low replies.",
  "How many days of new prospects do I have left before I run dry?",
  "Rank my top campaigns by winning steps and copy variants, and tell me how confident you are.",
  "Which sentence in my Step 0 email are prospects reacting to, and which is triggering objections?",
  "Summarize positive vs. negative reply themes for this campaign. Quote representative replies.",
  "Which custom lead fields show up more often on prospects who reply positively?",
  "Build this week's account-manager brief: wins, risks, actions, asks, next review date."
];

function BrandMark({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M70 84C70 60 90 42 113 42H170"
        stroke="#2DD4BF"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <path
        d="M70 84V152C70 184 96 210 128 210H148"
        stroke="#F2EFE6"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M148 210C180 210 206 184 206 152V120"
        stroke="#2DD4BF"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="180" cy="42" r="11" fill="#F2EFE6" />
    </svg>
  );
}

export default function Page() {
  return (
    <main className="stage">
      <section className="board">
        <aside className="board__hero">
          <a href="/" className="brand">
            <span className="brand-mark">
              <BrandMark size={56} />
            </span>
            <span className="brand-name">
              <span className="brand-name__send">Send</span>
              <span className="brand-name__lens">Lens</span>
            </span>
          </a>
          <span className="board__rule" aria-hidden="true" />

          <div className="board__hero-inner">
            <span className="eyebrow">
              <span className="dot" />
              Free · Open source · Local-first
            </span>

            <h1 className="display">
              Agentic intelligence
              <br />
              for <span className="display__em">outbound.</span>
            </h1>

            <p className="lede">
              SendLens turns your Instantly account into something you can talk
              to. Ask in plain English inside Claude or Codex and get a clear,
              evidence-backed answer about your actual campaigns, your actual
              senders, and what your actual prospects are saying back.
            </p>

            <div className="oracle" aria-label="Example questions you can ask">
              <span className="oracle__prefix">Ask</span>
              <ul className="oracle__list">
                {QUESTIONS.map((q, i) => (
                  <li key={i} style={{ animationDelay: `${i * 4}s` }}>
                    {q}
                  </li>
                ))}
              </ul>
              <span className="oracle__caret" aria-hidden="true" />
            </div>

            <div className="caption">
              <span className="caption__rule" />
              <span>SendLens / 2026</span>
            </div>
          </div>
        </aside>

        <aside className="board__form" id="install">
          <WaitlistForm />
        </aside>
      </section>
    </main>
  );
}
