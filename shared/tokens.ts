import { encode } from "gpt-tokenizer";
import type { DocumentSnapshot, Measurement, Selection, TokenCount } from "./types.js";

/**
 * Token arithmetic.
 *
 * Two different things are called "tokens" in this file and they must never be
 * conflated:
 *
 *   1. Text tokens  - how many tokens a piece of text is worth. Produced by a
 *                     real BPE tokenizer (o200k_base) over the exact string.
 *                     Deterministic, reproducible, and free.
 *   2. Operation cost - how many tokens SuperDocs actually burned running a job.
 *                     Only SuperDocs can report this; we read it back off the
 *                     job record. It includes the agent's system prompt, tool
 *                     definitions and reasoning, none of which we can see.
 *
 * (1) is never used as a stand-in for (2). It is used to reason about the *delta*
 * between the two sides of the comparison, which is stated explicitly below.
 */

/** o200k_base is not necessarily SuperDocs' tokenizer. See README, "Limitations". */
export const TEXT_TOKENIZER = "o200k_base (gpt-tokenizer)";

export function countTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}

export function documentText(document: DocumentSnapshot): string {
  return document.paragraphs.map((p) => p.text).join("\n\n");
}

export function tokenizeText(text: string, what: string): TokenCount {
  return {
    tokens: countTextTokens(text),
    source: "tokenized",
    method: `${what} tokenized locally with ${TEXT_TOKENIZER}`
  };
}

/**
 * The whole-document counterfactual, derived from measured values.
 *
 * A whole-document regeneration has to do everything the surgical edit did, and
 * then also read the rest of the document into the prompt and re-emit it in the
 * output. So:
 *
 *     estimate = measured_surgical + 2 x (document_tokens - selection_tokens)
 *
 * `measured_surgical` carries the fixed agent overhead, so both sides of the
 * comparison include it and the difference is attributable to document size
 * alone. The factor of 2 is the read and the write of the untouched remainder.
 *
 * This is an estimate and is labelled as one everywhere it is shown. Run
 * `npm run bench` to replace it with a measured number: the benchmark performs
 * a real whole-document regeneration and records what it actually cost.
 */
export function estimateWholeDocumentTokens(
  surgicalTokens: number,
  documentTokens: number,
  selectionTokens: number
): TokenCount {
  const remainder = Math.max(0, documentTokens - selectionTokens);

  return {
    tokens: surgicalTokens + 2 * remainder,
    source: "estimated",
    method:
      "measured surgical cost + 2 x (document - selection) text tokens: the untouched " +
      "remainder has to be read into the prompt and written back out again"
  };
}

export function savings(
  wholeDocument: number,
  surgical: number
): { tokens: number; ratio: number } {
  const tokens = wholeDocument - surgical;
  return { tokens, ratio: wholeDocument === 0 ? 0 : tokens / wholeDocument };
}

export interface MeasureInput {
  document: DocumentSnapshot;
  selection: Selection;
  /** Cost SuperDocs reported for the surgical job. */
  surgicalTokens: number;
  /** Cost SuperDocs reported for a real whole-document regeneration, if one ran. */
  measuredWholeDocumentTokens?: number;
}

export function measure(input: MeasureInput): Measurement {
  const selection = tokenizeText(input.selection.text, "selected text");
  const document = tokenizeText(documentText(input.document), "document body");

  const surgical: TokenCount = {
    tokens: input.surgicalTokens,
    source: "measured",
    method: "reported by SuperDocs as metadata.cumulative_tokens on the rewrite job"
  };

  const wholeDocument: TokenCount =
    input.measuredWholeDocumentTokens === undefined
      ? estimateWholeDocumentTokens(surgical.tokens, document.tokens, selection.tokens)
      : {
          tokens: input.measuredWholeDocumentTokens,
          source: "measured",
          method:
            "reported by SuperDocs as metadata.cumulative_tokens on a real " +
            "whole-document regeneration of the same document"
        };

  return {
    selection,
    document,
    surgical,
    wholeDocument,
    savings: savings(wholeDocument.tokens, surgical.tokens)
  };
}
