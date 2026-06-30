export const SOURCE_PROVIDER_MODES = ["instantly", "smartlead", "all"] as const;
export type SourceProviderMode = typeof SOURCE_PROVIDER_MODES[number];
export type SourceProvider = Exclude<SourceProviderMode, "all">;

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";
const SMARTLEAD_ACCESS_PARAM = "api" + "_key";

export type ProviderModeResolution = {
  mode: SourceProviderMode;
  raw: string | null;
  valid: boolean;
  defaulted: boolean;
  message?: string;
};

export type ProviderCredentialValidation = {
  status: "valid" | "invalid" | "unreachable";
  message: string;
  http_status?: number;
  returned_campaigns?: number;
  redacted_url?: string;
};

function normalizeProviderMode(value: string | undefined | null) {
  return value?.trim().toLowerCase() ?? "";
}

export function isUnresolvedProviderMode(value: string | undefined | null) {
  const normalized = normalizeProviderMode(value);
  return (
    normalized.includes("+ name +") ||
    normalized.includes("${") ||
    normalized.includes("{{") ||
    normalized.includes("}}") ||
    normalized === "your_provider" ||
    normalized === "your-provider" ||
    normalized === "provider"
  );
}

export function resolveSourceProviderMode(
  rawValue = process.env.SENDLENS_PROVIDER,
): ProviderModeResolution {
  const normalized = normalizeProviderMode(rawValue);
  if (!normalized || isUnresolvedProviderMode(rawValue)) {
    return {
      mode: "instantly",
      raw: normalized || null,
      valid: true,
      defaulted: true,
    };
  }

  if (SOURCE_PROVIDER_MODES.includes(normalized as SourceProviderMode)) {
    return {
      mode: normalized as SourceProviderMode,
      raw: normalized,
      valid: true,
      defaulted: false,
    };
  }

  return {
    mode: "instantly",
    raw: normalized,
    valid: false,
    defaulted: false,
    message: "SENDLENS_PROVIDER must be one of instantly, smartlead, or all.",
  };
}

export function providersForMode(mode: SourceProviderMode): SourceProvider[] {
  return mode === "all" ? ["instantly", "smartlead"] : [mode];
}

export function providerModeIncludes(mode: SourceProviderMode, provider: SourceProvider) {
  return providersForMode(mode).includes(provider);
}

export function buildSmartleadAccessProbeUrl(accessValue: string) {
  const url = new URL(`${SMARTLEAD_API_BASE}/campaigns/`);
  url.searchParams.set("include_tags", "true");
  url.searchParams.set(SMARTLEAD_ACCESS_PARAM, accessValue);
  return url.toString();
}

export function redactSmartleadAccess(
  value: string,
  sensitiveValues: Array<string | null | undefined> = [],
) {
  let redacted = value.replace(
    new RegExp(`([?&]${SMARTLEAD_ACCESS_PARAM}=)([^&#\\s]+)`, "gi"),
    "$1[REDACTED]",
  );

  for (const sensitiveValue of sensitiveValues) {
    const trimmed = sensitiveValue?.trim();
    if (!trimmed) continue;
    redacted = redacted.split(trimmed).join("[REDACTED]");
  }

  return redacted;
}

function countCampaignRows(data: unknown) {
  if (Array.isArray(data)) return data.length;
  const record = data as Record<string, unknown> | null;
  if (!record || typeof record !== "object") return 0;
  for (const key of ["data", "items", "campaigns"]) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows.length;
  }
  return 0;
}

export async function validateSmartleadApiKey(
  accessValue: string,
  timeoutMs = 5000,
): Promise<ProviderCredentialValidation> {
  const url = buildSmartleadAccessProbeUrl(accessValue);
  const redactedUrl = redactSmartleadAccess(url, [accessValue]);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const returnedCampaigns = countCampaignRows(data);
      return {
        status: "valid",
        message: `Smartlead accepted the key and returned ${returnedCampaigns} campaign row${returnedCampaigns === 1 ? "" : "s"} in the probe.`,
        http_status: res.status,
        returned_campaigns: returnedCampaigns,
        redacted_url: redactedUrl,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        status: "invalid",
        message: `Smartlead rejected the key with HTTP ${res.status}.`,
        http_status: res.status,
        redacted_url: redactedUrl,
      };
    }

    return {
      status: "unreachable",
      message: `Smartlead credential probe returned HTTP ${res.status}; retry setup after Smartlead connectivity is healthy.`,
      http_status: res.status,
      redacted_url: redactedUrl,
    };
  } catch (error) {
    const detail = error instanceof Error
      ? redactSmartleadAccess(error.message, [accessValue])
      : null;
    return {
      status: "unreachable",
      message: detail
        ? `Smartlead credential probe could not complete: ${detail}.`
        : "Smartlead credential probe could not complete.",
      redacted_url: redactedUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}
