import { DEMO_WORKSPACE_ID } from "./demo-workspace";
import { isUnresolvedEnvValue } from "./env";
import {
  providerModeIncludes,
  providersForMode,
  resolveSourceProviderMode,
  type SourceProviderMode,
} from "./provider-config";

export type ActiveDataStateStatus =
  | "no_workspace"
  | "demo_workspace"
  | "cached_workspace_refresh_disabled"
  | "cached_workspace_refresh_configured";

type CredentialKey = "SENDLENS_INSTANTLY_API_KEY" | "SENDLENS_SMARTLEAD_API_KEY";

type ActiveDataStateOptions = {
  workspaceId?: string | null;
  dbExists?: boolean;
  localCacheReadable?: boolean;
  sourceProviderMode?: SourceProviderMode;
  liveRefreshReady?: boolean;
};

function configuredSecret(envKey: CredentialKey) {
  const value = process.env[envKey]?.trim();
  return Boolean(value) && !isUnresolvedEnvValue(value);
}

function providerCredentialEnvKey(provider: "instantly" | "smartlead"): CredentialKey {
  return provider === "instantly" ? "SENDLENS_INSTANTLY_API_KEY" : "SENDLENS_SMARTLEAD_API_KEY";
}

function selectedProviders(mode: SourceProviderMode) {
  return providersForMode(mode).filter(
    (provider): provider is "instantly" | "smartlead" =>
      provider === "instantly" || provider === "smartlead",
  );
}

export function selectedProviderCredentialState(
  sourceProviderMode: SourceProviderMode = resolveSourceProviderMode().mode,
) {
  const providers = selectedProviders(sourceProviderMode);
  const configuredProviderKeys = providers
    .filter((provider) => configuredSecret(providerCredentialEnvKey(provider)))
    .map((provider) => providerCredentialEnvKey(provider));
  const missingProviderKeys = providers
    .filter((provider) => !configuredSecret(providerCredentialEnvKey(provider)))
    .map((provider) => providerCredentialEnvKey(provider));

  return {
    source_provider_mode: sourceProviderMode,
    source_providers: providers,
    configured_provider_keys: configuredProviderKeys,
    missing_provider_keys: missingProviderKeys,
    selected_provider_keys_configured: missingProviderKeys.length === 0,
    instantly_selected: providerModeIncludes(sourceProviderMode, "instantly"),
    smartlead_selected: providerModeIncludes(sourceProviderMode, "smartlead"),
  };
}

export function buildActiveDataState(options: ActiveDataStateOptions = {}) {
  const providerMode = options.sourceProviderMode ?? resolveSourceProviderMode().mode;
  const credentialState = selectedProviderCredentialState(providerMode);
  const workspaceId = options.workspaceId ?? null;
  const hasWorkspace = Boolean(workspaceId) && options.localCacheReadable !== false;
  const isDemoWorkspace = workspaceId === DEMO_WORKSPACE_ID;
  const liveRefreshConfigured = options.liveRefreshReady ?? credentialState.selected_provider_keys_configured;
  const noWorkspace = !hasWorkspace;

  let status: ActiveDataStateStatus;
  let label: string;
  let message: string;
  let analysisNotice: string;
  let recommendedAction: string;

  if (noWorkspace) {
    status = "no_workspace";
    label = "No active workspace";
    message = "No SendLens workspace is available yet in the local cache.";
    analysisNotice = "There is no real or demo SendLens workspace available for analysis yet.";
    recommendedAction = liveRefreshConfigured
      ? "Run refresh_data to load the configured provider workspace, or call seed_demo_workspace only when you intentionally want synthetic proof data."
      : "Configure the selected provider API key(s), or call seed_demo_workspace when you intentionally want canned synthetic demo data.";
  } else if (isDemoWorkspace) {
    status = "demo_workspace";
    label = "Synthetic demo workspace";
    message = liveRefreshConfigured
      ? "The active SendLens cache is the synthetic demo workspace; provider credentials are configured but live data has not replaced the demo workspace yet."
      : "No live provider workspace is configured; SendLens is showing synthetic demo fixtures from demo_workspace.";
    analysisNotice = "All active SendLens data is synthetic demo fixture data, not real customer or campaign data.";
    recommendedAction = liveRefreshConfigured
      ? "Run refresh_data to replace demo_workspace with live provider data, or continue only if you want demo analysis."
      : "Configure the selected provider API key(s) for real workspace analysis, or continue only if you want demo analysis.";
  } else if (liveRefreshConfigured) {
    status = "cached_workspace_refresh_configured";
    label = "Local workspace cache with refresh configured";
    message = "A local SendLens workspace cache is available and the selected provider credential(s) are configured for refresh.";
    analysisNotice = "SendLens is reading the active local workspace cache; use refresh_status for freshness before treating it as current.";
    recommendedAction = "Use workspace_snapshot for analysis, or run refresh_data when you explicitly need a fresh provider pull.";
  } else {
    status = "cached_workspace_refresh_disabled";
    label = "Local workspace cache without live refresh";
    message = "A local SendLens workspace cache is available, but live provider refresh is disabled because selected provider credential(s) are missing.";
    analysisNotice = "SendLens can analyze the existing local cache, but it cannot refresh live Instantly or Smartlead data in this environment.";
    recommendedAction = "Use the cache only if preserved local data is acceptable; configure the selected provider API key(s) before running refresh_data for fresh data.";
  }

  return {
    schema_version: "sendlens_active_data_state.v1",
    status,
    label,
    workspace_id: workspaceId,
    is_demo_workspace: isDemoWorkspace,
    local_cache_readable: hasWorkspace,
    live_refresh_configured: liveRefreshConfigured,
    source_provider_mode: credentialState.source_provider_mode,
    source_providers: credentialState.source_providers,
    configured_provider_keys: credentialState.configured_provider_keys,
    missing_provider_keys: credentialState.missing_provider_keys,
    message,
    analysis_notice: analysisNotice,
    recommended_action: recommendedAction,
  };
}
