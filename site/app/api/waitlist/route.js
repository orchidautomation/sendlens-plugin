import { put } from "@vercel/blob";

function sanitize(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const email = sanitize(payload.email);
    const company = sanitize(payload.company);

    if (!email || !email.includes("@")) {
      return Response.json({ error: "A valid work email is required." }, { status: 400 });
    }

    if (!company) {
      return Response.json({ error: "Company is required." }, { status: 400 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Waitlist storage is not configured yet." },
        { status: 500 }
      );
    }

    const record = {
      submittedAt: new Date().toISOString(),
      name: sanitize(payload.name),
      email,
      company,
      title: sanitize(payload.title),
      teamType: sanitize(payload.teamType),
      tools: Array.isArray(payload.tools)
        ? payload.tools.map((entry) => sanitize(entry)).filter(Boolean)
        : [],
      useCase: sanitize(payload.useCase),
      source: "sendlens.app",
      userAgent: request.headers.get("user-agent") || "",
      forwardedFor: request.headers.get("x-forwarded-for") || ""
    };

    const key = `waitlist/${Date.now()}-${slugify(email)}.json`;

    await put(key, JSON.stringify(record, null, 2), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500 }
    );
  }
}
