import type { Measurement, TokenCount } from "../../shared/types.js";

/**
 * The comparison. This is the product.
 *
 * Two numbers next to each other are only worth showing if the reader can tell
 * which of them was observed and which was worked out. Every figure here carries
 * its provenance badge, and the badge is not decorative: an estimate says so, in
 * the same size type as the number.
 */

const BADGES: Record<TokenCount["source"], { label: string; title: string }> = {
  measured: {
    label: "Measured",
    title: "Reported by SuperDocs for a job it actually ran. Not computed by TokenScope."
  },
  tokenized: {
    label: "Tokenized",
    title: "Counted from the exact text with a real BPE tokenizer, locally."
  },
  estimated: {
    label: "Estimated",
    title: "Derived from measured and tokenized values. Not an observed cost."
  }
};

function Badge({ source }: { source: TokenCount["source"] }): JSX.Element {
  const badge = BADGES[source];

  return (
    <span className={`badge badge--${source}`} title={badge.title}>
      {badge.label}
    </span>
  );
}

function format(value: number): string {
  return value.toLocaleString("en-US");
}

function Figure({
  label,
  count,
  tone
}: {
  label: string;
  count: TokenCount;
  tone: "surgical" | "whole";
}): JSX.Element {
  return (
    <div className={`figure figure--${tone}`}>
      <div className="figure__label">{label}</div>
      <div className="figure__value">{format(count.tokens)}</div>
      <div className="figure__unit">tokens</div>
      <Badge source={count.source} />
      <p className="figure__method">{count.method}</p>
    </div>
  );
}

export function TokenComparison({
  measurement,
  onMeasureWholeDocument,
  measuring
}: {
  measurement: Measurement;
  onMeasureWholeDocument: () => void;
  measuring: boolean;
}): JSX.Element {
  const { surgical, wholeDocument, savings, selection, document } = measurement;
  const cheaper = savings.tokens > 0;

  return (
    <section className="comparison" aria-label="Token comparison">
      <div className="comparison__pair">
        <Figure label="Surgical edit" count={surgical} tone="surgical" />
        <Figure label="Whole document" count={wholeDocument} tone="whole" />
      </div>

      <div className={`savings ${cheaper ? "savings--positive" : "savings--negative"}`}>
        <div className="savings__ratio">
          {cheaper ? "" : "+"}
          {(Math.abs(savings.ratio) * 100).toFixed(2)}%
        </div>
        <div className="savings__caption">
          {cheaper ? (
            <>
              saved by editing the selection instead of the document
              <span className="savings__delta">{format(savings.tokens)} tokens not spent</span>
            </>
          ) : (
            <>
              more expensive than regenerating this document
              <span className="savings__delta">
                At this size the agent&rsquo;s fixed overhead dominates. The gap turns over as the
                document grows &mdash; see the benchmark.
              </span>
            </>
          )}
        </div>
      </div>

      {wholeDocument.source === "estimated" && (
        <div className="comparison__upgrade">
          <p>
            The whole-document figure above is an estimate. TokenScope can measure it instead, by
            running the regeneration for real in a throwaway session. Your document is not touched.
          </p>
          <button type="button" onClick={onMeasureWholeDocument} disabled={measuring}>
            {measuring ? "Regenerating the whole document…" : "Measure it for real"}
          </button>
          <span className="comparison__cost">
            Costs one SuperDocs operation. Slow on large documents.
          </span>
        </div>
      )}

      <dl className="context">
        <div>
          <dt>Selected text</dt>
          <dd>
            {format(selection.tokens)} tokens <Badge source={selection.source} />
          </dd>
        </div>
        <div>
          <dt>Whole document body</dt>
          <dd>
            {format(document.tokens)} tokens <Badge source={document.source} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
