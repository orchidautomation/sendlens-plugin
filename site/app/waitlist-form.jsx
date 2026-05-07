"use client";

import { useMemo, useState } from "react";

const INSTALL_COMMANDS = [
  {
    host: "Claude Code",
    command:
      "curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-claude-code.sh | bash"
  },
  {
    host: "Codex",
    command:
      "curl -fsSL https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install-codex.sh | bash"
  }
];

const TOOLS = ["Instantly", "Smartlead", "HeyReach", "Other"];

export default function WaitlistForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    title: "",
    teamType: "agency",
    tools: ["Instantly"],
    useCase: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [copiedHost, setCopiedHost] = useState("");

  const toolSummary = useMemo(() => form.tools.join(", "), [form.tools]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleTool(tool) {
    setForm((current) => {
      const has = current.tools.includes(tool);
      const next = has
        ? current.tools.filter((item) => item !== tool)
        : [...current.tools, tool];
      return { ...current, tools: next };
    });
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tools: form.tools })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Something went wrong.");
      }

      setSubmitted(true);
    } catch (submissionError) {
      setError(submissionError.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCommand(host, command) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = command;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedHost(host);
      window.setTimeout(() => setCopiedHost(""), 1400);
    } catch {
      setError("Could not copy that command. Select the command text and copy it manually.");
    }
  }

  return (
    <div className="form-card">
      <div className="form-card-head">
        <span className="label">Get the plugin</span>
        <h2>
          Show me the install command for{" "}
          <span className="brand-name brand-name--inline">
            <span className="brand-name__send">Send</span>
            <span className="brand-name__lens">Lens.</span>
          </span>
        </h2>
        <p>
          The plugin is free and open source. Add your work email and outbound
          stack, then we&apos;ll show the installer for the AI tool you use. Your
          signup helps us learn which teams need shared reviews, cross-platform
          analysis, and client-ready reporting next.
        </p>
      </div>

      {!submitted ? (
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="Obi-Wan Kenobi"
              />
            </div>
            <div className="field">
              <label htmlFor="email">Work email *</label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                placeholder="hello@banthaanalytics.com"
              />
            </div>
            <div className="field">
              <label htmlFor="company">Company *</label>
              <input
                id="company"
                required
                value={form.company}
                onChange={(event) => updateField("company", event.target.value)}
                placeholder="Bantha Analytics"
              />
            </div>
            <div className="field">
              <label htmlFor="title">Job title</label>
              <input
                id="title"
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="Founder, RevOps, Agency owner"
              />
            </div>
            <div className="field">
              <label htmlFor="teamType">Team type</label>
              <select
                id="teamType"
                value={form.teamType}
                onChange={(event) => updateField("teamType", event.target.value)}
              >
                <option value="agency">Agency</option>
                <option value="internal">Internal GTM team</option>
                <option value="freelancer">Solo operator / freelancer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label>Outbound stack</label>
              <div className="checkboxes">
                {TOOLS.map((tool) => (
                  <label className="check" key={tool}>
                    <input
                      type="checkbox"
                      checked={form.tools.includes(tool)}
                      onChange={() => toggleTool(tool)}
                    />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field-stack">
              <label htmlFor="useCase">What&apos;s the first question you&apos;d ask it?</label>
              <textarea
                id="useCase"
                value={form.useCase}
                onChange={(event) => updateField("useCase", event.target.value)}
                placeholder="E.g. which campaigns are winning right now, what's common among my best replies, what should I test next."
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              className="btn btn-primary btn-block"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Sending…" : "Get the install commands"}
              <span className="arrow">→</span>
            </button>
            <span className="subtle">
              No paid account. The OSS plugin is read-only and does not upload
              Instantly data to a SendLens server. We only store this form
              submission.
            </span>
          </div>

          {toolSummary ? (
            <p className="subtle" style={{ marginTop: 14 }}>
              Stack noted: <span style={{ color: "var(--ink)" }}>{toolSummary}</span>
            </p>
          ) : null}

          {error ? <p className="error">⚠ {error}</p> : null}
        </form>
      ) : null}

      {submitted ? (
        <div className="success">
          <span className="success-pill">✓ You are on the list</span>
          <h3>
            Install commands <span className="brand-name__lens">ready.</span>
          </h3>
          <p>
            Copy the installer for your AI tool below. The OSS plugin stays
            free; your signup helps prioritize shared workspaces, scheduled
            reviews, cross-platform analysis, and team-ready reporting.
          </p>
          <p className="success-note">
            Want the source too?{" "}
            <a href="https://github.com/orchidautomation/sendlens-plugin">
              View the GitHub repo ↗
            </a>
          </p>
          <div className="command-list">
            {INSTALL_COMMANDS.map((entry) => (
              <div className="command-card" key={entry.host}>
                <div className="command-header">
                  <strong>{entry.host}</strong>
                  <button
                    aria-label={`Copy ${entry.host} install command`}
                    className="command-copy"
                    onClick={() => copyCommand(entry.host, entry.command)}
                    title={`Copy ${entry.host} install command`}
                    type="button"
                  >
                    {copiedHost === entry.host ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                <code>{entry.command}</code>
              </div>
            ))}
          </div>
          <div className="setup-steps">
            <h4>After it installs</h4>
            <ol>
              <li>
                Add your Instantly API key where your AI tool can read it:
                <code>export SENDLENS_INSTANTLY_API_KEY=&quot;your_key_here&quot;</code>
              </li>
              <li>
                Restart Claude Code or Codex so it picks up the environment
                variable.
              </li>
              <li>
                Ask SendLens a campaign question, like which campaigns to
                scale, rewrite, pause, or inspect next.
              </li>
            </ol>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        width="13"
        x="8"
        y="8"
      />
      <path
        d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
