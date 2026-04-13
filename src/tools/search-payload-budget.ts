type SearchPayloadMode = 'compact' | 'full';

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
