import WaitlistForm from "./waitlist-form";

const QUESTIONS = [
  "Rank every active campaign by bounce risk, lead runway, missing senders, low replies, or stopped sending.",
  "Which campaign should I scale, kill, or rewrite this week?",
  "Audit my sent emails for unfilled personalization tokens, blank bodies, and affected variants.",
  "Which sentence in my Step 0 email are prospects reacting to, and which one is triggering objections?",
  "Pull the latest replies and separate real buying signals from auto-replies and out-of-office noise.",
  "Which lead fields show up more often on prospects who reply positively? Treat it as a hypothesis.",
  "Build this week's account-manager brief: wins, risks, current actions, client asks, and next review date."
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
      className="brand-mark__svg"
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
              Free OSS plugin · Instantly today · No spreadsheets
            </span>

            <h1 className="display">
              A senior outbound analyst
              <br />
              inside your <span className="display__em">AI tool.</span>
            </h1>

            <p className="lede">
              SendLens turns Instantly into clear answers about which campaigns
              to scale, kill, or rewrite, which copy is pulling replies, where
              sender or lead risk is building, and what to test next. Ask in
              plain language. Get evidence-backed answers without dashboards,
              spreadsheets, or SQL.
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
          </div>
        </aside>

        <aside className="board__form" id="install">
          <WaitlistForm />
        </aside>
      </section>
    </main>
  );
}
