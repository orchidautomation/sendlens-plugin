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

  return (
    <div className="form-card">
      <div className="form-card-head">
        <span className="label">Get access</span>
        <h2>
          Install{" "}
          <span className="brand-name brand-name--inline">
            <span className="brand-name__send">Send</span>
            <span className="brand-name__lens">Lens.</span>
          </span>
        </h2>
        <p>
          Add your details to unlock the install command for your host. The
          plugin is free. This just helps us see who&apos;s using SendLens.
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
                placeholder="ObiWan Keniboi"
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
              Private by default. The plugin runs locally. This form only logs
              who is evaluating SendLens and what they want help with.
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
          <span className="success-pill">✓ Access granted</span>
          <h3>
            Install commands <span className="brand-name__lens">ready.</span>
          </h3>
          <p>
            You are in. The plugin stays free. The business later is shared
            workflow, agency operations, cross-provider normalization, and
            outcome-graded outbound intelligence.
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
                  <span>copy &amp; run</span>
                </div>
                <code>{entry.command}</code>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
