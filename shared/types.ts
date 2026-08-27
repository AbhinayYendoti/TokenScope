/**
 * The contract between the TokenScope server, the task pane and the benchmark.
 *
 * Every token number that crosses this boundary carries its own provenance in a
 * `source` field. Nothing in the UI is allowed to render a count without saying
 * where it came from, which is the whole point of the product.
 */

/** Where a token count came from. The UI renders a different badge per value. */
export type TokenSource =
  /** Reported by SuperDocs for a real job it ran. Not computed by us. */
  | "measured"
  /** Tokenized locally from the exact text with a real BPE tokenizer. */
  | "tokenized"
  /** Derived from measured and tokenized values. Never a guess, but not observed. */
  | "estimated";

export interface TokenCount {
  tokens: number;
  source: TokenSource;
  /** One sentence a reviewer can check the number against. */
  method: string;
}

/** A paragraph of the document as the host (Word, or the demo surface) sees it. */
export interface Paragraph {
  id: string;
  text: string;
}

export interface DocumentSnapshot {
  paragraphs: Paragraph[];
}

/** What the user selected, resolved against the document. */
export interface Selection {
  /** Ids of the paragraphs the selection covers, in document order. */
  paragraphIds: string[];
  /** The selected text itself. */
  text: string;
}

/** One proposed edit, exactly as SuperDocs returned it. Not applied yet. */
export interface ProposedChange {
  changeId: string;
  chunkId: string;
  operation: string;
  oldHtml: string;
  newHtml: string;
  oldText: string;
  newText: string;
  explanation: string;
}

export interface Measurement {
  /** Tokens in the selected text alone. Context for the reader, not a cost. */
  selection: TokenCount;
  /** Tokens in the whole document body. Context for the reader, not a cost. */
  document: TokenCount;
  /** What the surgical rewrite actually cost, as reported by SuperDocs. */
  surgical: TokenCount;
  /** What regenerating the whole document would cost. */
  wholeDocument: TokenCount;
  /** wholeDocument - surgical, and that difference as a fraction of wholeDocument. */
  savings: { tokens: number; ratio: number };
}

/** Result of running the whole-document counterfactual for real. */
export interface WholeDocumentRun {
  sessionId: string;
  jobId: string;
  tokens: TokenCount;
  elapsedMs: number;
}

export interface AccountStatus {
  configured: boolean;
  tier?: string;
  quota?: { monthlyLimit: number; used: number; remaining: number; resetsAt: string | null };
  /** Present when the key is missing or rejected. */
  problem?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; hint?: string };
}
