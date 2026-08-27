import { randomUUID } from "node:crypto";
import {
  buildSurgicalMessage,
  buildWholeDocumentMessage,
  checkScope,
  htmlToText,
  toDocumentHtml,
  type ScopeReport
} from "../shared/selection.js";
import { measure } from "../shared/tokens.js";
import type {
  DocumentSnapshot,
  Measurement,
  ProposedChange,
  Selection,
  WholeDocumentRun
} from "../shared/types.js";
import { TokenScopeError } from "./errors.js";
import type { ModelTier } from "./config.js";
import {
  decideChange,
  pendingChanges,
  reportedTokens,
  startEdit,
  waitForJob,
  type Job,
  type PendingChange
} from "./superdocs.js";

/**
 * The two operations TokenScope measures, and the rule that makes them
 * comparable.
 *
 * Both run in a **fresh session**. That is deliberate: `cumulative_tokens`
 * reflects the session's agent context, so a session that has already taken a
 * turn reports a figure carrying that turn with it. One session per measurement
 * means the number attributed to an operation is that operation's own, and the
 * surgical and whole-document figures are arrived at the same way.
 */

function freshSessionId(kind: "surgical" | "wholedoc"): string {
  return `tokenscope-${kind}-${randomUUID().slice(0, 12)}`;
}

function toProposedChange(change: PendingChange): ProposedChange {
  const oldHtml = change.old_html ?? "";
  const newHtml = change.new_html ?? "";

  return {
    changeId: change.change_id,
    chunkId: change.chunk_id ?? "",
    operation: change.operation ?? "edit",
    oldHtml,
    newHtml,
    oldText: htmlToText(oldHtml),
    newText: htmlToText(newHtml),
    explanation: change.ai_explanation ?? ""
  };
}

/** The cost of a job, or a clear failure. A missing number is never treated as 0. */
function costOf(job: Job, what: string): number {
  const tokens = reportedTokens(job);

  if (tokens === undefined) {
    throw new TokenScopeError(
      "unexpected_response",
      `SuperDocs did not report a token count for the ${what}.`,
      {
        hint:
          "TokenScope reads metadata.cumulative_tokens off the job record. Without it " +
          "there is no measured number to show, and it will not invent one."
      }
    );
  }

  return tokens;
}

export interface SurgicalRewrite {
  sessionId: string;
  jobId: string;
  reply: string;
  changes: ProposedChange[];
  scope: ScopeReport;
  measurement: Measurement;
  elapsedMs: number;
}

export interface RewriteOptions {
  document: DocumentSnapshot;
  selection: Selection;
  instruction: string;
  modelTier?: ModelTier;
  onProgress?: (progress: number, status: string) => void;
}

/**
 * Rewrite the selection, and measure what it cost.
 *
 * Nothing is applied here. The job is started in ask_every_time mode and stops
 * at `awaiting_approval`; the proposed changes are returned for the user to look
 * at, and the document is untouched until `applyChange` is called.
 */
export async function rewriteSelection(options: RewriteOptions): Promise<SurgicalRewrite> {
  const sessionId = freshSessionId("surgical");
  const startedAt = Date.now();

  const { jobId } = await startEdit({
    sessionId,
    message: buildSurgicalMessage(options.selection, options.instruction),
    documentHtml: toDocumentHtml(options.document),
    ...(options.modelTier === undefined ? {} : { modelTier: options.modelTier })
  });

  const job = await waitForJob(jobId, {
    ...(options.onProgress === undefined
      ? {}
      : {
          onProgress: (j: Job) => options.onProgress?.(j.progress ?? 0, j.status)
        })
  });

  const changes = pendingChanges(job).map(toProposedChange);
  const scope = checkScope(changes, options.document, options.selection);

  return {
    sessionId,
    jobId,
    reply: replyOf(job),
    changes,
    scope,
    measurement: measure({
      document: options.document,
      selection: options.selection,
      surgicalTokens: costOf(job, "rewrite")
    }),
    elapsedMs: Date.now() - startedAt
  };
}

/**
 * Run the counterfactual for real.
 *
 * Regenerating the whole document is the thing this product argues against, so
 * the number attached to it should not be something we asserted. This performs
 * the regeneration as a genuine SuperDocs job, in a throwaway session, on a copy
 * of the document, and reads the same `cumulative_tokens` field off it. The
 * user's document and session are not involved and nothing is ever approved.
 */
export async function measureWholeDocument(options: {
  document: DocumentSnapshot;
  instruction: string;
  modelTier?: ModelTier;
  onProgress?: (progress: number, status: string) => void;
}): Promise<WholeDocumentRun> {
  const sessionId = freshSessionId("wholedoc");
  const startedAt = Date.now();

  const { jobId } = await startEdit({
    sessionId,
    message: buildWholeDocumentMessage(options.instruction),
    documentHtml: toDocumentHtml(options.document),
    ...(options.modelTier === undefined ? {} : { modelTier: options.modelTier })
  });

  const job = await waitForJob(jobId, {
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: (j: Job) => options.onProgress?.(j.progress ?? 0, j.status) })
  });

  return {
    sessionId,
    jobId,
    tokens: {
      tokens: costOf(job, "whole-document regeneration"),
      source: "measured",
      method:
        "reported by SuperDocs as metadata.cumulative_tokens on a real whole-document " +
        "regeneration of the same document, run in a throwaway session"
    },
    elapsedMs: Date.now() - startedAt
  };
}

/** Apply one change the user chose. The only call that mutates the document. */
export async function applyChange(options: {
  sessionId: string;
  jobId: string;
  changeId: string;
}): Promise<{ applied: true }> {
  await decideChange({ ...options, approved: true });
  return { applied: true };
}

function replyOf(job: Job): string {
  const result = job.result;

  if (result !== null && typeof result === "object" && "response" in result) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string") return response;
  }

  return "";
}
