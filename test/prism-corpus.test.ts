import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, type Schema } from "../src/index.ts";

/*
 * A conformance corpus from a CONSUMER, with verdicts from a standards
 * validator — not from this implementation.
 *
 * `test/fixtures/prism-corpus.json` is `cases.schema.json` from
 * Particle-Academy/prism-parity plus 24 real corpus documents and 7 constructed
 * cases. It exercises `$ref`, an 18-branch root `oneOf` (64 branches in total),
 * `if`/`then`, `additionalProperties: false` in 106 places, and all three of the
 * object keywords added in 0.2.0.
 *
 * ## Why this fixture is worth more than the tests beside it
 *
 * **Every `expect_valid` was produced by Python `jsonschema` 4.26.0**, recorded
 * in the bundle's own `source` block. Not by this validator, and not by the
 * consumer's reading of the spec. A fixture whose expectations come from the
 * implementation under test only records what that implementation already does —
 * it cannot discover a disagreement with the standard, which is the single thing
 * a validator most needs to know. This one can, and did: the keywords in 0.2.0
 * exist because this corpus showed this validator wrong in BOTH directions.
 *
 * ## What is deliberately NOT asserted
 *
 * Only the VERDICT. The bundle also carries `expect_keyword`, and the consumer
 * was explicit that it is the ROOT keyword only — `oneOf` on nearly everything,
 * because their root is an 18-branch `oneOf` and that is what the standard
 * blames at the top. Nested error detail legitimately differs between
 * implementations, so asserting on it would pin this validator to another one's
 * internal choices and fail on a change that is not a defect.
 */

interface Corpus {
  README: string;
  source: { repo: string; commit: string; verdicts_from: string };
  schema: Schema;
  positive_documents: { suite: string; expect_valid: boolean; document: unknown }[];
  negative_documents: { label: string; expect_valid: boolean; expect_keyword?: string; document: unknown }[];
}

const corpus: Corpus = JSON.parse(
  readFileSync(new URL("./fixtures/prism-corpus.json", import.meta.url), "utf8"),
);

test("the fixture is the shape this test believes it is", () => {
  // A vacuity guard. If the bundle is ever replaced by one that parses but
  // carries no documents, every assertion below passes over an empty set and
  // reports success — which is the failure mode this whole package exists to
  // catch in other people's data.
  assert.ok(corpus.positive_documents.length > 0, "no positive documents; this suite would assert nothing");
  assert.ok(corpus.negative_documents.length > 0, "no negative documents; this suite would assert nothing");
  assert.equal(corpus.source.verdicts_from.includes("jsonschema"), true, "verdicts must come from the standards validator");

  // The negative set MUST contain both expectations. One of its entries is a
  // deliberate control carrying `expect_valid: true` — it is there so that a
  // validator which rejects every skip map still fails the fixture. If the
  // control ever disappears, the set stops being able to catch that.
  const expectations = new Set(corpus.negative_documents.map((d) => d.expect_valid));
  assert.equal(expectations.has(true), true, "the control case (expect_valid: true) is gone from negative_documents");
  assert.equal(expectations.has(false), true, "negative_documents contains nothing that should be rejected");
});

test("every corpus document gets the verdict the standard gives it", () => {
  // `compile` once, validate many — the shape a corpus check actually has, and
  // the path a consumer uses. Running `validate` per document would leave the
  // compiled path untested against the hardest schema available.
  const validator = compile(corpus.schema);

  const disagreements: string[] = [];

  for (const { suite, expect_valid, document } of corpus.positive_documents) {
    const result = validator(document);
    if (result.valid !== expect_valid) {
      disagreements.push(
        `positive "${suite}": expected valid=${expect_valid}, got ${result.valid}` +
          (result.valid ? "" : ` — ${result.errors.map((e) => `${e.instancePath || "/"} ${e.keyword}: ${e.message}`).join("; ")}`),
      );
    }
  }

  for (const { label, expect_valid, document } of corpus.negative_documents) {
    const result = validator(document);
    if (result.valid !== expect_valid) {
      disagreements.push(
        `negative "${label}": expected valid=${expect_valid}, got ${result.valid}` +
          (result.valid ? "" : ` — ${result.errors.map((e) => `${e.instancePath || "/"} ${e.keyword}`).join("; ")}`),
      );
    }
  }

  // Report EVERY disagreement, not the first. A validator that differs from the
  // standard usually differs in a family, and fixing them one run at a time
  // hides the shape of the family.
  assert.deepEqual(
    disagreements,
    [],
    `${disagreements.length} disagreement(s) with ${corpus.source.verdicts_from}:\n  ${disagreements.join("\n  ")}`,
  );
});

test("a mutation of a valid document is actually caught", () => {
  // The corpus proves agreement on documents that exist. This proves the
  // agreement is not vacuous: break a known-good document and the validator
  // must notice. Without it, a validator that returned `valid: true`
  // unconditionally would pass the positive set perfectly.
  const validator = compile(corpus.schema);
  const good = corpus.positive_documents[0];
  assert.equal(validator(good.document).valid, true, "fixture's first positive document should be valid");

  const mutated = { ...(good.document as Record<string, unknown>), __definitely_not_in_the_schema__: true };
  assert.equal(
    validator(mutated).valid,
    false,
    "adding an unknown property to a valid document was not caught — additionalProperties is not holding",
  );
});
