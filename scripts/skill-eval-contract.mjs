import { createHash } from "node:crypto";

export const VALID_COHORTS = new Set(["train", "validation"]);
export const VALID_SUITES = new Set(["focused", "matrix"]);

function stableTriggerId(skillName, query) {
  const digest = createHash("sha256").update(`${skillName}\0${query}`).digest("hex").slice(0, 12);
  return `trigger-${digest}`;
}

export function blindOrderTriggerCases(cases) {
  return [...cases].sort((left, right) => left.id.localeCompare(right.id));
}

export function inspectOutputCases(skillName, label, payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { cases: [], errors: [`${label}: expected an object`] };
  }
  if (payload.skill_name !== skillName) errors.push(`${label}: skill_name must equal ${skillName}`);
  if (!Array.isArray(payload.evals) || payload.evals.length === 0) {
    return { cases: [], errors: [...errors, `${label}: zero discovered output cases`] };
  }

  const caseIds = new Set();
  let hostCases = 0;
  for (const testCase of payload.evals) {
    const prefix = `${label}: output case ${JSON.stringify(testCase?.id)}`;
    if (typeof testCase?.id !== "string" || testCase.id.length === 0) errors.push(`${label}: every output case needs a stable id`);
    else if (caseIds.has(testCase.id)) errors.push(`${label}: duplicate output case id ${JSON.stringify(testCase.id)}`);
    else caseIds.add(testCase.id);
    if (typeof testCase?.prompt !== "string" || testCase.prompt.length < 20) errors.push(`${prefix} needs a realistic prompt`);
    if (typeof testCase?.input !== "string" || testCase.input.length < 80) errors.push(`${prefix} needs self-contained synthetic input of at least 80 characters`);
    if (typeof testCase?.expected_output !== "string" || testCase.expected_output.length < 40) errors.push(`${prefix} needs a substantive expected_output`);
    if (!Array.isArray(testCase?.assertions) || testCase.assertions.length < 3) errors.push(`${prefix} needs at least three assertions`);
    else if (!testCase.assertions.every((value) => typeof value === "string" && value.trim())) errors.push(`${prefix} assertions must be non-empty strings`);
    if (!Array.isArray(testCase?.objective_checks) || testCase.objective_checks.length < 3) {
      errors.push(`${prefix} needs at least three objective_checks`);
    } else {
      const checkIds = new Set();
      for (const check of testCase.objective_checks) {
        if (typeof check?.id !== "string" || check.id.length === 0) errors.push(`${prefix} has an objective check without a stable id`);
        else if (checkIds.has(check.id)) errors.push(`${prefix} has duplicate objective check id ${JSON.stringify(check.id)}`);
        else checkIds.add(check.id);
        if (typeof check?.description !== "string" || check.description.length < 20) errors.push(`${prefix}/${check?.id} needs a substantive description`);
        if (typeof check?.pattern !== "string" || check.pattern.length === 0) errors.push(`${prefix}/${check?.id} needs a regex pattern`);
        else {
          try { new RegExp(check.pattern, "i"); } catch (error) { errors.push(`${prefix}/${check.id} has invalid regex: ${error.message}`); }
        }
        if (check?.mode !== undefined && !["required", "forbidden"].includes(check.mode)) errors.push(`${prefix}/${check.id} mode must be required or forbidden`);
        for (const bound of ["min_occurrences", "max_occurrences"]) {
          if (check?.[bound] !== undefined && (!Number.isInteger(check[bound]) || check[bound] < 0)) errors.push(`${prefix}/${check.id} ${bound} must be a non-negative integer`);
        }
        if (check?.min_occurrences !== undefined && check?.max_occurrences !== undefined && check.min_occurrences > check.max_occurrences) errors.push(`${prefix}/${check.id} min_occurrences cannot exceed max_occurrences`);
      }
    }
    if (typeof testCase?.host_case !== "boolean") errors.push(`${prefix} must declare host_case`);
    else if (testCase.host_case) hostCases += 1;
  }
  if (hostCases === 0) errors.push(`${label}: zero discovered host output cases`);
  return { cases: payload.evals, errors };
}

export function inspectTriggerCases(skillName, label, payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { cases: [], errors: [`${label}: zero discovered trigger cases`] };
  }
  const errors = [];
  const queries = new Set();
  const ids = new Set();
  const cases = payload.map((entry, index) => {
    const prefix = `${label}: trigger case ${index + 1}`;
    if (typeof entry?.query !== "string" || !entry.query.trim()) errors.push(`${prefix} needs a non-empty query`);
    else if (queries.has(entry.query)) errors.push(`${prefix} duplicates query ${JSON.stringify(entry.query)}`);
    else queries.add(entry.query);
    if (typeof entry?.should_trigger !== "boolean") errors.push(`${prefix} needs boolean should_trigger`);
    if (!VALID_COHORTS.has(entry?.cohort)) errors.push(`${prefix} cohort must be train or validation`);
    if (!Array.isArray(entry?.suites) || entry.suites.length === 0) errors.push(`${prefix} needs at least one suite`);
    else if (!entry.suites.every((suite) => VALID_SUITES.has(suite))) errors.push(`${prefix} suites may contain only focused or matrix`);
    const id = stableTriggerId(skillName, entry?.query ?? `invalid-${index}`);
    if (ids.has(id)) errors.push(`${prefix} collides on stable trigger id ${id}`);
    ids.add(id);
    return { ...entry, id, skill_name: skillName };
  });
  return { cases, errors };
}
