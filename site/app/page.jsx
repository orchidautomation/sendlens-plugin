import WaitlistForm from "./waitlist-form";

function BrandMark({ size = 26 }) {
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
        stroke="#0F766E"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <path
        d="M70 84V152C70 184 96 210 128 210H148"
        stroke="#0B0B0A"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M148 210C180 210 206 184 206 152V120"
        stroke="#0F766E"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="180" cy="42" r="11" fill="#0B0B0A" />
    </svg>
  );
}

export default function Page() {
  return (
    <main>
      {/* ---------- NAV ---------- */}
      <nav className="nav">
        <div className="shell nav-inner">
          <a href="/" className="brand">
            <span className="brand-mark">
              <BrandMark size={24} />
            </span>
            <span className="brand-name">SendLens</span>
          </a>
          <div className="nav-cta">
            <a className="nav-link" href="#ask">
              What you can ask
            </a>
            <a className="btn btn-primary" href="#install">
              Get install <span className="arrow">→</span>
            </a>
          </div>
        </div>
      </nav>

      {/* ---------- HERO ---------- */}
      <section className="hero">
        <div className="shell">
          <div className="eyebrow hero-eyebrow">
            <span className="dot" />
            Free MCP plugin · runs on your machine
          </div>

          <h1>
            Ask your agent <span className="serif">what&apos;s working.</span>
          </h1>

          <p className="hero-sub">
            SendLens connects your Instantly data to Claude and Codex. Ask
            plain-English questions about your campaigns and get analyst-grade
            answers — without leaving your editor or exporting another CSV.
          </p>

          <div className="hero-actions">
            <a className="btn btn-primary" href="#install">
              Get the install commands <span className="arrow">→</span>
            </a>
            <a className="btn btn-ghost" href="#ask">
              See what you can ask
            </a>
          </div>

          <div className="hero-meta">
            <span>
              <span className="check">✓</span> Read-only against Instantly
            </span>
            <span>
              <span className="check">✓</span> Works with Claude and Codex
            </span>
          </div>
        </div>
      </section>

      {/* ---------- WHAT YOU CAN ASK ---------- */}
      <section className="section" id="ask">
        <div className="shell">
          <div className="section-head">
            <span className="label">01 — What you can ask</span>
            <h2>
              Real questions, <span className="serif">real answers.</span>
            </h2>
            <p>
              These are the questions SendLens is built to answer. Type them
              straight into your agent — it reads from a local cache of your
              campaigns, leads, templates, and analytics.
            </p>
          </div>

          <div className="cards">
            <article className="card">
              <span className="num">01 — Find the winners</span>
              <h3>
                What&apos;s actually <span className="serif">landing?</span>
              </h3>
              <ul>
                <li>"Which campaigns are performing best and worst right now?"</li>
                <li>"Which step gets the most replies?"</li>
                <li>"Which variant is outperforming the rest?"</li>
              </ul>
            </article>
            <article className="card">
              <span className="num">02 — Understand who replies</span>
              <h3>
                Who&apos;s saying <span className="serif">yes?</span>
              </h3>
              <ul>
                <li>"What's common among positive responders in this campaign?"</li>
                <li>"Which lead variables show up in winning leads?"</li>
                <li>"Which segments are getting ignored or bouncing?"</li>
              </ul>
            </article>
            <article className="card">
              <span className="num">03 — Improve what&apos;s next</span>
              <h3>
                What should you <span className="serif">test next?</span>
              </h3>
              <ul>
                <li>"Show me the rendered copy a replied lead actually saw."</li>
                <li>"Compare these two campaigns without mixing their fields."</li>
                <li>"What should we test next to get more positive replies?"</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- WHY IT EXISTS ---------- */}
      <section className="section">
        <div className="shell">
          <div className="section-head">
            <span className="label">02 — Why it exists</span>
            <h2>
              Instantly has the data. It just doesn&apos;t reason{" "}
              <span className="serif">over it.</span>
            </h2>
            <p>
              You can see the dashboards. But when you actually want to know
              what&apos;s landing — across hundreds of campaigns and thousands
              of leads — exports and screenshots don&apos;t cut it. SendLens
              gives your agent a fast, local read on your campaigns so it can
              answer like an analyst would. Read-only. Private. Fast.
            </p>
          </div>

          <div className="split">
            <div className="split-cell left">
              <span className="label">Without SendLens</span>
              <h3>
                Export, paste, <span className="serif">repeat.</span>
              </h3>
              <p>
                Pull a CSV. Open a sheet. Pivot it. Screenshot the chart. Paste
                it into a Loom. Hope the team watches the Loom. Do it again
                next week, on a slightly different question.
              </p>
            </div>
            <div className="split-cell right">
              <span className="label">With SendLens</span>
              <h3>
                Just <span className="serif">ask.</span>
              </h3>
              <p>
                Type the question into your agent. SendLens grounds the answer
                in your actual campaign, lead, and template data — including
                the rendered copy a replied prospect saw. No upload, no export,
                no cleanup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- WHO IT'S FOR ---------- */}
      <section className="section">
        <div className="shell">
          <div className="section-head">
            <span className="label">03 — Who it&apos;s for</span>
            <h2>
              Built for people already shipping <span className="serif">cold outbound.</span>
            </h2>
            <p>
              SendLens is most useful when you already have campaigns running
              in Instantly and you&apos;re tired of explaining performance with
              a screenshot and a hunch.
            </p>
          </div>

          <div className="cards">
            <article className="card">
              <span className="num">A — Agency owners</span>
              <h3>You explain performance every Friday.</h3>
              <ul>
                <li>5 to 30 active clients, weekly performance ritual.</li>
                <li>Tired of stitching CSVs and Looms together by hand.</li>
                <li>Want a real read your team can run in seconds.</li>
              </ul>
            </article>
            <article className="card">
              <span className="num">B — RevOps &amp; GTM leads</span>
              <h3>You ship volume and need to know if it&apos;s working.</h3>
              <ul>
                <li>Multiple sequences live, lots of variants in the air.</li>
                <li>Want a fast read before scaling the wrong campaign.</li>
                <li>Need a clean answer for the leadership Slack thread.</li>
              </ul>
            </article>
            <article className="card">
              <span className="num">C — Agent-native operators</span>
              <h3>You already live in Claude or Codex.</h3>
              <ul>
                <li>Already running agentic routines for outbound work.</li>
                <li>Want a plugin that grades the work, not just writes it.</li>
                <li>Prefer answers grounded in real data, not generic advice.</li>
              </ul>
            </article>
          </div>

          <div className="hosts" style={{ marginTop: 56 }}>
            <span className="hosts-label">Works with</span>
            <span className="host">Claude Code</span>
            <span className="host">Codex</span>
          </div>
        </div>
      </section>

      {/* ---------- FORM SECTION ---------- */}
      <section className="form-section" id="install">
        <div className="shell-narrow">
          <WaitlistForm />
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="footer">
        <div className="shell footer-row">
          <span>SendLens · open source · runs locally</span>
          <a href="https://github.com/orchidautomation/sendlens-plugin">
            View on GitHub ↗
          </a>
        </div>
      </footer>
    </main>
  );
}
