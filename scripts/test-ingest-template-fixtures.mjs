import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  extractCampaignVariants,
  renderTemplateValue,
  resolveLeadTemplate,
} = require("../build/plugin/instantly-ingest.js");

const normalCampaign = {
  sequences: [
    {
      steps: [
        {
          type: "email",
          delay: 2,
          delay_unit: "days",
          variants: [
            {
              subject: "Intro for {{first_name}}",
              body: { html: "<p>Hi {{first_name}}</p><p>Saw {{companyName}}</p>" },
            },
            {
              subject: "Alt for {{ company_domain }}",
              text: "Quick note for {{company_domain}}",
            },
          ],
        },
        {
          type: "email",
          delay: "bad",
          subjects: ["Follow-up {{firstName}}"],
          bodies: ["<div>Still relevant for {{ personalization }}?</div>"],
        },
      ],
    },
  ],
};

const templates = extractCampaignVariants(normalCampaign);
assert.equal(templates.length, 3);
assert.deepEqual(
  templates.map((template) => ({
    sequenceIndex: template.sequenceIndex,
    step: template.step,
    variant: template.variant,
    stepType: template.stepType,
    delayValue: template.delayValue,
    delayUnit: template.delayUnit,
    subject: template.subject,
    bodyText: template.bodyText,
  })),
  [
    {
      sequenceIndex: 0,
      step: 0,
      variant: 0,
      stepType: "email",
      delayValue: 2,
      delayUnit: "days",
      subject: "Intro for {{first_name}}",
      bodyText: "Hi {{first_name}} Saw {{companyName}}",
    },
    {
      sequenceIndex: 0,
      step: 0,
      variant: 1,
      stepType: "email",
      delayValue: 2,
      delayUnit: "days",
      subject: "Alt for {{ company_domain }}",
      bodyText: "Quick note for {{company_domain}}",
    },
    {
      sequenceIndex: 0,
      step: 1,
      variant: 0,
      stepType: "email",
      delayValue: null,
      delayUnit: null,
      subject: "Follow-up {{firstName}}",
      bodyText: "Still relevant for {{ personalization }}?",
    },
  ],
);

const fallbackCampaign = {
  steps: [
    {
      type: "email",
      subjects: ["Fallback subject"],
      bodies: [{ children: [{ text: "Nested body text" }] }],
    },
    {
      type: "email",
      variants: [{ body: "<p>Body without subject</p>" }],
    },
    {
      type: "email",
    },
  ],
};
const fallbackTemplates = extractCampaignVariants(fallbackCampaign);
assert.equal(fallbackTemplates.length, 2);
assert.equal(fallbackTemplates[0].subject, "Fallback subject");
assert.equal(fallbackTemplates[0].bodyText, "Nested body text");
assert.equal(fallbackTemplates[1].subject, null);
assert.equal(fallbackTemplates[1].bodyText, "Body without subject");

const lead = {
  email: "alex@example.com",
  first_name: "Alex",
  last_name: "Avery",
  company_name: "Acme Health",
  company_domain: "acme.test",
  job_title: "VP Operations",
  personalization: "your CHNA cycle",
  custom_payload: JSON.stringify({
    segment: "Healthcare",
    customHook: "patient access",
  }),
};

assert.equal(
  renderTemplateValue(
    "Hi {{ first_name }} at {{companyName}} — {{ customHook }} / {{missing_key}}",
    lead,
  ),
  "Hi Alex at Acme Health — patient access / {{missing_key}}",
);
assert.equal(renderTemplateValue(null, lead), null);

const repliedResolution = resolveLeadTemplate(
  { ...lead, email_replied_step: 0, email_replied_variant: 1 },
  templates,
);
assert.equal(repliedResolution.resolutionSource, "replied_step_variant");
assert.equal(repliedResolution.stepResolved, "0");
assert.equal(repliedResolution.variantResolved, "1");
assert.equal(repliedResolution.template.subject, "Alt for {{ company_domain }}");

const clickedResolution = resolveLeadTemplate(
  { ...lead, email_clicked_step: 1, email_clicked_variant: 0 },
  templates,
);
assert.equal(clickedResolution.resolutionSource, "clicked_step_variant");
assert.equal(clickedResolution.stepResolved, "1");
assert.equal(clickedResolution.variantResolved, "0");
assert.equal(clickedResolution.template.subject, "Follow-up {{firstName}}");

const openedFallbackResolution = resolveLeadTemplate(
  { ...lead, email_opened_step: 0, email_opened_variant: 9 },
  templates,
);
assert.equal(openedFallbackResolution.resolutionSource, "opened_step_variant");
assert.equal(openedFallbackResolution.stepResolved, "0");
assert.equal(openedFallbackResolution.variantResolved, "0");
assert.equal(openedFallbackResolution.template.subject, "Intro for {{first_name}}");

const defaultResolution = resolveLeadTemplate(lead, templates);
assert.equal(defaultResolution.resolutionSource, "default_first_variant");
assert.equal(defaultResolution.stepResolved, "0");
assert.equal(defaultResolution.variantResolved, "0");

const missingResolution = resolveLeadTemplate(
  { ...lead, email_replied_step: 2, email_replied_variant: 0 },
  [],
);
assert.equal(missingResolution.resolutionSource, "missing_template");
assert.equal(missingResolution.stepResolved, null);
assert.equal(missingResolution.variantResolved, null);
assert.equal(missingResolution.template, null);

console.log("ingest template fixture tests passed");
