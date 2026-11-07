type SearchPayloadMode = 'compact' | 'full';

/** Whole contiguous source lines only; never cut a condition/effect mid-line. */
export function boundSearchPreview(
  lines: string[],
  anchor: number
): { text: string; start: number; end: number } | undefined {
  const maximumLines = 7;
  const maximumSerializedBytes = 480;
  let start = Math.max(0, Math.min(anchor - 2, lines.length - maximumLines));
  let end = Math.min(lines.length, start + maximumLines);
  while (start < end) {
    const text = lines.slice(start, end).join('\n');
    // Include the field key and JSON escaping, with room for the surrounding
    // result object's indentation and comma (compact results serialize pretty).
    if (
      Buffer.byteLength(JSON.stringify({ signaturePreview: text }, null, 2), 'utf8') + 8 <=
      maximumSerializedBytes
    ) {
      return text.trim() ? { text, start, end } : undefined;
    }
    // Retain the matched line, removing the furthest context line first.
    if (anchor - start > end - 1 - anchor) start += 1;
    else end -= 1;
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildWarning(tokenEstimate: number, mode: SearchPayloadMode): string | undefined {
  if (tokenEstimate <= 4000) {
    return undefined;
  }

  if (mode === 'compact') {
    return `Large search payload: estimated ${tokenEstimate} tokens. Try tighter filters (e.g. layer=, language=) to reduce payload size.`;
  }

  return `Large search payload: estimated ${tokenEstimate} tokens. Prefer compact mode or tighter filters before pasting into an agent.`;
}

export function finalizeSearchPayloadText(
  payload: Record<string, unknown>,
  options: {
    mode: SearchPayloadMode;
    pretty?: boolean;
    transportAware?: boolean;
  }
): string {
  if (!isPlainRecord(payload.searchQuality)) {
    return JSON.stringify(payload, null, options.pretty ? 2 : undefined);
  }

  let tokenEstimate =
    typeof payload.searchQuality.tokenEstimate === 'number'
      ? payload.searchQuality.tokenEstimate
      : 0;
  let warning =
    typeof payload.searchQuality.warning === 'string' ? payload.searchQuality.warning : undefined;
  let renderedPayload = '';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    renderedPayload = JSON.stringify(
      {
        ...payload,
        searchQuality: {
          ...payload.searchQuality,
          ...(warning ? { warning } : {}),
          tokenEstimate
        }
      },
      null,
      options.pretty ? 2 : undefined
    );

    const estimatedTransportPayload =
      options.transportAware && process.platform === 'win32'
        ? renderedPayload.replace(/\n/g, '\r\n')
        : renderedPayload;
    const nextTokenEstimate = Math.ceil(estimatedTransportPayload.length / 4);
    const nextWarning = buildWarning(nextTokenEstimate, options.mode);

    if (nextTokenEstimate === tokenEstimate && nextWarning === warning) {
      return renderedPayload;
    }

    tokenEstimate = nextTokenEstimate;
    warning = nextWarning;
  }

  return renderedPayload;
}
