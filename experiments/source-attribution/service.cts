import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
const { withSourceSpan } = require('./source.cjs') as typeof import('./source.cjs');

type SourceAttributes = {
  'spantrail.source.file': string;
  'spantrail.source.line': number;
  'spantrail.source.column': number;
};

const tracer = trace.getTracer('spantrail-source-attribution');

export async function runService(fail = false): Promise<string> {
  return withSourceSpan('action.service', // SOURCE:service
    (evidence: SourceAttributes | undefined) => tracer.startActiveSpan('action.service', { kind: SpanKind.INTERNAL }, async outer => {
    if (evidence) outer.setAttributes(evidence);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (false) {
        await withSourceSpan('action.unexecuted', // SOURCE:unexecuted
          (nested: SourceAttributes | undefined) => tracer.startActiveSpan('action.unexecuted', { kind: SpanKind.INTERNAL }, span => {
          if (nested) span.setAttributes(nested);
          span.end();
        }));
      }
      return await withSourceSpan('action.after-await', // SOURCE:after-await
        (nestedEvidence: SourceAttributes | undefined) => tracer.startActiveSpan('action.after-await', { kind: SpanKind.INTERNAL }, async nested => {
        if (nestedEvidence) nested.setAttributes(nestedEvidence);
        try {
          if (fail) throw new Error('local fixture failure');
          return outer.spanContext().traceId;
        } catch {
          nested.setStatus({ code: SpanStatusCode.ERROR });
          outer.setStatus({ code: SpanStatusCode.ERROR });
          throw new Error('action failed');
        } finally {
          nested.end();
        }
      }));
    } catch {
      outer.setStatus({ code: SpanStatusCode.ERROR });
      throw new Error('action failed');
    } finally {
      outer.end();
    }
  }));
}
