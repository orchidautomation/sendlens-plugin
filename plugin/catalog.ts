import type { DuckDBConnection } from "@duckdb/node-api";
import { CURRENT_SCHEMA_MIGRATION_ID, query, resolveDbPath } from "./local-db";
import { PUBLIC_TABLES, TABLE_DESCRIPTIONS, type PublicTableName } from "./constants";
import { getQueryRecipeById, type QueryRecipe } from "./query-recipes";

export type TableInfo = {
  name: string;
  description: string;
};

export type ColumnInfo = {
  name: string;
  type: string;
};

export class CatalogPublicTableError extends Error {
  code = "non_public_table" as const;

  constructor(public readonly tableName: string) {
    super(`Table "${tableName}" is not a public SendLens surface.`);
    this.name = "CatalogPublicTableError";
  }
}

export type CatalogMatch = {
  kind: "table" | "column";
  table: string;
  column?: string;
  description: string;
  matched_terms?: string[];
};

export type CatalogStarterSuggestion = {
  concept: string;
  topics: string[];
  recipe_ids: string[];
  reason: string;
  route_cards?: CatalogRecipeRouteCard[];
  correction_path?: CatalogCorrectionPath;
};

export type CatalogRecipeRouteCard = {
  recipe_id: string;
  intent: string;
  grain: string;
  time_basis: string;
  attribution: string;
  provider_scope: string;
  population_scope: string;
  tag_role: string;
  cost_class: "low" | "medium" | "high";
  privacy_class: string;
  prerequisites: string[];
  safe_adaptations: string[];
  forbidden_adaptations: string[];
};

export type CatalogCorrectionPath = {
  from_recipe_id: string;
  on_status: "zero_rows";
  correction_recipe_id: string;
  after_correction: "stop";
  max_follow_up_calls: 4;
  follow_up_starts_at: "primary_recipe_lookup";
  catalog_discovery_included: false;
};

export type CatalogSearchGuidance = {
  search_terms: string[];
  suggested_narrower_terms: string[];
  analysis_starter_suggestions: CatalogStarterSuggestion[];
  message?: string;
};

type ConceptHint = {
  concept: string;
  triggers: string[];
  searchTerms: string[];
  topics: string[];
  recipeIds: string[];
  reason: string;
};

type PublicColumnCache = Map<PublicTableName, ColumnInfo[]>;
type CatalogRouteBundle = {
  route_cards: CatalogRecipeRouteCard[];
  correction_path?: CatalogCorrectionPath;
};

export const CATALOG_ROUTE_CARD_RESPONSE_BUDGET_BYTES = 8_192;

const CATALOG_PRIMARY_ROUTE_CARD_IDS_BY_CONCEPT = new Map<string, string[]>([
  ["campaign-tag sender risk", ["campaign-sender-inventory-by-tag"]],
  ["tag", ["tag-scope-audit"]],
]);

const publicColumnCache = new Map<string, Promise<PublicColumnCache>>();
let publicColumnHydrationCountForTests = 0;
let publicColumnCacheGeneration = 0;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const CONCEPT_HINTS: ConceptHint[] = [
  {
    concept: "runway",
    triggers: ["runway", "lead runway", "out of leads", "lead supply"],
    searchTerms: ["campaign_overview", "campaign_daily_metrics", "campaign_tags", "lead_evidence", "daily volume"],
    topics: ["campaign-performance"],
    recipeIds: ["campaign-tag-runway-inputs", "campaign-tag-runway-daily-history", "campaign-tag-account-tag-capacity-runway"],
    reason: "Runway is a workflow concept; use campaign-performance starters before estimating lead exhaustion or capacity.",
  },
  {
    concept: "scale",
    triggers: ["scale", "scaling", "increase volume"],
    searchTerms: ["campaign_overview", "campaign_accounts", "account_daily_metrics", "sender_deliverability_health"],
    topics: ["campaign-performance", "campaign-launch-qa"],
    recipeIds: ["campaign-tag-daily-volume-utilization", "campaign-launch-qa-checklist"],
    reason: "Scale decisions need campaign performance, sender capacity, launch readiness, and deliverability context.",
  },
  {
    concept: "refill",
    triggers: ["refill", "lead refill", "more leads", "lead supply"],
    searchTerms: ["campaign_overview", "lead_evidence", "sampled_leads", "campaign_daily_metrics"],
    topics: ["campaign-performance", "account-manager-brief"],
    recipeIds: ["campaign-tag-runway-inputs", "account-manager-client-brief"],
    reason: "Refill questions are usually lead-supply or runway questions, not a single schema column.",
  },
  {
    concept: "deliverability",
    triggers: ["deliverability", "spam", "inbox placement", "sender health", "bounce"],
    searchTerms: ["inbox_placement", "sender_deliverability_health", "accounts", "bounce", "tracking"],
    topics: ["workspace-health", "campaign-launch-qa"],
    recipeIds: ["sender-deliverability-health", "inbox-placement-test-overview", "campaign-tracking-deliverability-settings"],
    reason: "Deliverability questions should inspect sender health, inbox-placement evidence, and campaign guardrails.",
  },
  {
    concept: "campaign-tag sender risk",
    triggers: [
      "campaign tag sender risk",
      "tag sender risk",
      "tagged campaign sender",
      "campaign tag inbox",
      "campaign tag deliverability",
      "tag deliverability",
    ],
    searchTerms: ["campaign_tags", "campaign_accounts", "campaign_overview", "accounts", "sender risk"],
    topics: ["workspace-health"],
    recipeIds: ["campaign-sender-inventory-by-tag", "campaign-tag-sender-coverage", "sender-deliverability-health"],
    reason: "Exact campaign-tag sender-risk questions should use campaign-sender-inventory-by-tag first; placement and daily-volume routes are follow-ons only after the sender inventory is known.",
  },
  {
    concept: "sender",
    triggers: ["sender", "sender account", "inbox", "inboxes"],
    searchTerms: ["accounts", "campaign_accounts", "campaign_account_assignments", "account_daily_metrics"],
    topics: ["workspace-health", "campaign-launch-qa"],
    recipeIds: ["campaign-sender-inventory-by-tag", "campaign-tag-sender-coverage", "sender-load-balance-by-campaign-tag"],
    reason: "Sender account discovery usually maps to account inventory, campaign assignments, and sender coverage recipes.",
  },
  {
    concept: "rendered outbound",
    triggers: ["rendered outbound", "rendered copy", "outbound copy", "personalization"],
    searchTerms: ["rendered_outbound_context", "sampled_outbound_emails", "campaign_variants", "template"],
    topics: ["copy-analysis"],
    recipeIds: ["rendered-outbound-sample", "personalization-leak-audit", "copy-template-review"],
    reason: "Rendered outbound is reconstructed sample evidence; copy-analysis starters preserve that caveat.",
  },
  {
    concept: "reply",
    triggers: ["reply", "replies", "reply rate"],
    searchTerms: ["reply_emails", "reply_email_context", "reply_context", "reply_count", "unique_replies"],
    topics: ["reply-patterns", "campaign-performance"],
    recipeIds: ["reply-feed", "reply-patterns-by-variant", "fetched-reply-text-by-campaign"],
    reason: "Reply questions can map to exact reply aggregates, fetched reply text, or reply-pattern starters depending on depth.",
  },
  {
    concept: "reply body",
    triggers: ["reply body", "reply text", "inbound reply", "reply wording"],
    searchTerms: ["reply_emails", "reply_email_context", "reply_context", "fetch_reply_text"],
    topics: ["reply-patterns", "copy-analysis"],
    recipeIds: ["reply-feed", "fetched-reply-text-by-campaign", "reply-email-context-feed"],
    reason: "Reply body analysis depends on fetched reply text and reply context, often after one-campaign hydration.",
  },
  {
    concept: "payload",
    triggers: ["payload", "lead payload", "variables"],
    searchTerms: ["lead_payload_kv", "lead_evidence", "sampled_leads", "payload"],
    topics: ["icp-signals"],
    recipeIds: ["campaign-payload-key-inventory", "campaign-payload-key-signals", "campaign-payload-presence-signals"],
    reason: "Payload discovery maps to sampled lead evidence and ICP starter recipes.",
  },
  {
    concept: "tag",
    triggers: ["tag", "tags", "tagged"],
    searchTerms: ["custom_tags", "custom_tag_mappings", "campaign_tags", "account_tags", "tag_scope_audit"],
    topics: ["workspace-health", "campaign-performance"],
    recipeIds: ["tag-catalog", "tag-scope-audit", "campaign-tag-sender-coverage"],
    reason: "Tag questions should start from the tag catalog and tag-scope audit before scoped analysis.",
  },
];

export async function listTables(): Promise<TableInfo[]> {
  return PUBLIC_TABLES.map((name) => ({
    name,
    description: TABLE_DESCRIPTIONS[name],
  }));
}

export async function listColumns(
  conn: DuckDBConnection,
  tableName: string,
): Promise<ColumnInfo[]> {
  const clean = tableName.replace(/^sendlens\./i, "").trim();
  if (!isPublicTableName(clean)) {
    throw new CatalogPublicTableError(clean);
  }
  return (await publicColumnsForConnection(conn)).get(clean) ?? [];
}

export async function searchCatalog(
  conn: DuckDBConnection,
  search: string,
): Promise<CatalogMatch[]> {
  const needle = search.trim().toLowerCase();
  if (!needle) return [];

  const rawTerms = buildRawSearchTerms(needle);
  const terms = buildSearchTerms(needle, rawTerms.length > 1);
  const scoredMatches: Array<{ match: CatalogMatch; score: number }> = [];

  for (const table of PUBLIC_TABLES) {
    const description = TABLE_DESCRIPTIONS[table as PublicTableName];
    const scored = scoreCatalogEntry(table, description, terms, needle);
    if (scored.score > 0) {
      scoredMatches.push({
        match: {
          kind: "table",
          table,
          description,
          matched_terms: scored.matchedTerms,
        },
        score: scored.score + 20,
      });
    }
  }

  const publicColumns = await publicColumnsForConnection(conn);
  for (const table of PUBLIC_TABLES) {
    const columns = publicColumns.get(table) ?? [];
    for (const column of columns) {
      const description = `${column.name} (${column.type})`;
      const scored = scoreCatalogEntry(`${table} ${column.name}`, description, terms, needle);
      if (scored.score > 0) {
        scoredMatches.push({
          match: {
            kind: "column",
            table,
            column: column.name,
            description,
            matched_terms: scored.matchedTerms,
          },
          score: scored.score,
        });
      }
    }
  }

  const sortedMatches = scoredMatches
    .sort((left, right) => right.score - left.score || formatMatch(left.match).localeCompare(formatMatch(right.match)))
    .map(({ match }) => match);

  return limitCatalogMatches(sortedMatches, terms.length > 1 ? 4 : 25, 25);
}

export function resetCatalogColumnCacheForTests() {
  publicColumnCache.clear();
  publicColumnHydrationCountForTests = 0;
  publicColumnCacheGeneration = 0;
}

export function invalidateCatalogColumnCache() {
  publicColumnCache.clear();
  publicColumnCacheGeneration += 1;
}

export function catalogColumnCacheStatsForTests() {
  return {
    public_column_hydrations: publicColumnHydrationCountForTests,
    cache_generation: publicColumnCacheGeneration,
  };
}

function isPublicTableName(tableName: string): tableName is PublicTableName {
  return (PUBLIC_TABLES as readonly string[]).includes(tableName);
}

async function publicColumnsForConnection(conn: DuckDBConnection): Promise<PublicColumnCache> {
  const cacheKey = publicColumnCacheKey();
  const existing = publicColumnCache.get(cacheKey);
  if (existing) return existing;
  const pending = hydratePublicColumns(conn).catch((error) => {
    publicColumnCache.delete(cacheKey);
    throw error;
  });
  publicColumnCache.set(cacheKey, pending);
  return pending;
}

async function hydratePublicColumns(conn: DuckDBConnection): Promise<PublicColumnCache> {
  publicColumnHydrationCountForTests += 1;
  const tableNames = PUBLIC_TABLES.map((table) => `'${table.replace(/'/g, "''")}'`).join(", ");
  const rows = await query(
    conn,
    `SELECT table_name, column_name AS name, data_type AS type
     FROM information_schema.columns
     WHERE table_schema = 'sendlens'
       AND table_name IN (${tableNames})
     ORDER BY table_name, ordinal_position`,
  );
  const columnsByTable: PublicColumnCache = new Map(PUBLIC_TABLES.map((table) => [table, []]));
  for (const row of rows) {
    const table = String(row.table_name);
    if (!isPublicTableName(table)) continue;
    columnsByTable.get(table)?.push({
      name: String(row.name),
      type: String(row.type),
    });
  }
  return columnsByTable;
}

function publicColumnCacheKey() {
  return [
    resolveDbPath(),
    CURRENT_SCHEMA_MIGRATION_ID,
    normalizedMode(process.env.SENDLENS_DEMO_MODE),
    publicColumnCacheGeneration,
  ].join("\u001f");
}

function normalizedMode(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" ? "demo" : "default";
}

export function buildCatalogSearchGuidance(search: string, matches: CatalogMatch[]): CatalogSearchGuidance {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return {
      search_terms: [],
      suggested_narrower_terms: [],
      analysis_starter_suggestions: [],
    };
  }

  const terms = buildSearchTerms(needle);
  const conceptHints = matchingConceptHints(needle);
  const matchedTerms = new Set(matches.flatMap((match) => match.matched_terms ?? []));
  const suggestedNarrowerTerms = unique([
    ...conceptHints.flatMap((hint) => hint.searchTerms),
    ...terms,
  ])
    .filter((term) => !matchedTerms.has(term) || matches.length === 0)
    .slice(0, 10);

  const analysisStarterSuggestions: CatalogStarterSuggestion[] = conceptHints.map((hint) => ({
    concept: hint.concept,
    topics: hint.topics,
    recipe_ids: hint.recipeIds,
    reason: hint.reason,
  }));
  addCatalogRouteCardsWithinBudget(conceptHints, analysisStarterSuggestions);

  return {
    search_terms: terms,
    suggested_narrower_terms: suggestedNarrowerTerms,
    analysis_starter_suggestions: analysisStarterSuggestions,
    message: buildGuidanceMessage(matches, analysisStarterSuggestions),
  };
}

function addCatalogRouteCardsWithinBudget(
  hints: ConceptHint[],
  suggestions: CatalogStarterSuggestion[],
) {
  const emittedRouteCardIds = new Set<string>();
  for (const [index, hint] of hints.entries()) {
    const bundle = catalogRouteBundle(hint, emittedRouteCardIds);
    if (!bundle) continue;
    const candidate = {
      ...suggestions[index],
      ...bundle,
    };
    const candidateSuggestions = [...suggestions];
    candidateSuggestions[index] = candidate;
    if (Buffer.byteLength(JSON.stringify(candidateSuggestions), "utf8") > CATALOG_ROUTE_CARD_RESPONSE_BUDGET_BYTES) {
      continue;
    }
    suggestions[index] = candidate;
    for (const card of bundle.route_cards) emittedRouteCardIds.add(card.recipe_id);
  }
}

function catalogRouteBundle(
  hint: ConceptHint,
  emittedRouteCardIds: Set<string>,
): CatalogRouteBundle | undefined {
  const routeCards: CatalogRecipeRouteCard[] = [];
  let correctionPath: CatalogCorrectionPath | undefined;
  for (const recipeId of CATALOG_PRIMARY_ROUTE_CARD_IDS_BY_CONCEPT.get(hint.concept) ?? []) {
    const recipe = getQueryRecipeById(recipeId);
    if (!recipe) continue;
    if (!emittedRouteCardIds.has(recipe.id) && recipe.route_card) {
      routeCards.push(compactCatalogRouteCard(recipe));
    }
    if (!recipe.zero_row_fallback) continue;
    correctionPath ??= {
      from_recipe_id: recipe.id,
      ...recipe.zero_row_fallback,
    };
    const correctionRecipe = getQueryRecipeById(recipe.zero_row_fallback.correction_recipe_id);
    if (correctionRecipe?.route_card && !emittedRouteCardIds.has(correctionRecipe.id)) {
      const correctionCard = compactCatalogRouteCard(correctionRecipe);
      if (recipe.zero_row_fallback.after_correction === "stop") {
        correctionCard.safe_adaptations = ["report inferred tag scope and stop"];
      }
      routeCards.push(correctionCard);
    }
  }
  if (routeCards.length === 0 && !correctionPath) return undefined;
  return {
    route_cards: routeCards,
    correction_path: correctionPath,
  };
}

function compactCatalogRouteCard(recipe: QueryRecipe): CatalogRecipeRouteCard {
  const card = recipe.route_card!;
  return {
    recipe_id: recipe.id,
    intent: card.preferred_intent,
    grain: card.grain,
    time_basis: card.time_basis,
    attribution: card.attribution,
    provider_scope: card.provider_scope,
    population_scope: card.population_scope,
    tag_role: card.tag_role,
    cost_class: card.cost,
    privacy_class: card.privacy_class,
    prerequisites: card.prerequisites.slice(0, 3),
    safe_adaptations: card.safe_adaptations.slice(0, 3),
    forbidden_adaptations: card.forbidden_adaptations.slice(0, 3),
  };
}

function buildSearchTerms(needle: string, includeConceptTerms = true): string[] {
  const rawTerms = buildRawSearchTerms(needle);
  const conceptTerms = includeConceptTerms
    ? matchingConceptHints(needle).flatMap((hint) => hint.searchTerms)
    : [];
  return unique([...rawTerms, ...conceptTerms]);
}

function buildRawSearchTerms(needle: string): string[] {
  return needle
    .split(/[^a-z0-9_]+/i)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function matchingConceptHints(needle: string): ConceptHint[] {
  return CONCEPT_HINTS.filter((hint) =>
    (hint.concept === "campaign-tag sender risk" && hasCampaignTagSenderRiskIntent(needle))
    || hint.triggers.some((trigger) => {
      const normalizedTrigger = trigger.toLowerCase();
      return normalizedTrigger.includes(" ")
        ? needle.includes(normalizedTrigger)
        : new RegExp(`\\b${escapeRegExp(normalizedTrigger)}\\b`).test(needle);
    }),
  ).sort((left, right) => conceptHintPriority(left) - conceptHintPriority(right));
}

function hasCampaignTagSenderRiskIntent(needle: string) {
  const hasTag = /\btags?\b|\btagged\b/.test(needle);
  const hasSender = /\bsenders?\b|\baccounts?\b|\binbox(?:es)?\b/.test(needle);
  const hasRisk = /\bdeliverability\b|\brisks?\b|\bbounces?\b|\bhealth\b|\bspam\b|\bplacement\b/.test(needle);
  return hasTag && hasSender && hasRisk;
}

function conceptHintPriority(hint: ConceptHint) {
  return hint.concept === "campaign-tag sender risk" ? 0 : 1;
}

function scoreCatalogEntry(name: string, description: string, terms: string[], needle: string) {
  const haystack = `${name} ${description}`.toLowerCase();
  const matchedTerms: string[] = [];
  let score = haystack.includes(needle) ? 100 : 0;

  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    matchedTerms.push(term);
    score += name.toLowerCase().includes(term) ? 8 : 3;
  }

  return {
    score,
    matchedTerms: unique(matchedTerms),
  };
}

function buildGuidanceMessage(matches: CatalogMatch[], suggestions: CatalogStarterSuggestion[]) {
  const hasRouteCards = suggestions.some((suggestion) => (suggestion.route_cards?.length ?? 0) > 0);
  const hasCorrectionPath = suggestions.some((suggestion) => suggestion.correction_path);
  if (hasRouteCards && hasCorrectionPath) {
    const matchStatus = matches.length === 0 ? "No direct schema matches found." : "Schema matches were found.";
    return `${matchStatus} Compact route cards name the exact analysis_starters route and its zero-row correction path. Catalog discovery reads no campaign evidence rows; the four-call follow-up budget starts at primary recipe lookup.`;
  }
  if (matches.length === 0 && suggestions.length > 0) {
    return "No direct schema matches found. The query looks like a workflow concept, so use the suggested analysis_starters topics or retry one of the narrower schema terms.";
  }
  if (matches.length === 0) {
    return "No direct schema matches found. Retry with one narrower table, column, or workflow term.";
  }
  if (suggestions.length > 0) {
    return "Schema matches were found. The query also includes workflow concepts, so consider the suggested analysis_starters topics before custom SQL.";
  }
  return undefined;
}

function formatMatch(match: CatalogMatch) {
  return `${match.kind}:${match.table}:${match.column ?? ""}`;
}

function limitCatalogMatches(matches: CatalogMatch[], perTableLimit: number, totalLimit: number) {
  const selected: CatalogMatch[] = [];
  const counts = new Map<string, number>();

  for (const match of matches) {
    const count = counts.get(match.table) ?? 0;
    if (count >= perTableLimit) continue;
    selected.push(match);
    counts.set(match.table, count + 1);
    if (selected.length >= totalLimit) return selected;
  }

  for (const match of matches) {
    if (selected.includes(match)) continue;
    selected.push(match);
    if (selected.length >= totalLimit) return selected;
  }

  return selected;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
