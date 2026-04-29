import type {
  ContextBenchEvidenceReference,
  ContextBenchStructuredAnswer,
  JsonSchemaDefinition,
  JsonValue
} from './contextbench-types.js';

export interface StructuredAnswerParseResult {
  status: 'valid' | 'invalid_schema';
  answer: ContextBenchStructuredAnswer | null;
  errors: string[];
}

export interface SchemaBoundDiagnostics {
  missingRequiredFacts?: string[];
  contradictoryFacts?: string[];
  missingEvidenceFiles?: string[];
  unsupportedEvidenceFiles?: string[];
}

export interface AnswerClassification {
  unsupportedClaim: boolean;
  falseReady: boolean;
  reasons: string[];
}

const confidenceValues = new Set(['low', 'medium', 'high']);

const evidenceReferenceFields = new Set(['file', 'lineRange', 'reason']);
const lineRangeFields = new Set(['start', 'end']);

export const CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS = [
  'answer',
  'confidence',
  'evidence',
  'filesReferenced',
  'symbolsReferenced',
  'unsupportedClaims',
  'readyToEdit'
] as const;

export const CONTEXTBENCH_STRUCTURED_ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS],
  properties: {
    answer: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'lineRange', 'reason'],
        properties: {
          file: { type: 'string', minLength: 1 },
          lineRange: {
            type: 'object',
            additionalProperties: false,
            required: ['start', 'end'],
            properties: {
              start: { type: 'integer', minimum: 1 },
              end: { type: 'integer', minimum: 1 }
            }
          },
          reason: { type: 'string', minLength: 1 }
        }
      }
    },
    filesReferenced: { type: 'array', items: { type: 'string' } },
    symbolsReferenced: { type: 'array', items: { type: 'string' } },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    readyToEdit: { type: 'boolean' }
  }
} satisfies JsonSchemaDefinition;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function findAdditionalFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  prefix: string
): string[] {
  return Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) => `additional_${prefix}_${field}`);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function isValidEvidenceReference(value: unknown): value is ContextBenchEvidenceReference {
  if (!isRecord(value)) return false;
  if (findAdditionalFields(value, evidenceReferenceFields, 'evidence_field').length > 0)
    return false;
  const lineRange = value.lineRange;
  if (!isRecord(lineRange)) return false;
  if (findAdditionalFields(lineRange, lineRangeFields, 'line_range_field').length > 0) return false;
  const start = lineRange.start;
  const end = lineRange.end;
  return (
    typeof value.file === 'string' &&
    value.file.trim().length > 0 &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0 &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    start > 0 &&
    end >= start
  );
}

function validateStructuredAnswer(value: unknown): StructuredAnswerParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { status: 'invalid_schema', answer: null, errors: ['answer_root_not_object'] };
  }

  for (const field of CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`missing_${field}`);
  }
  errors.push(
    ...findAdditionalFields(
      value,
      new Set(CONTEXTBENCH_STRUCTURED_ANSWER_REQUIRED_FIELDS),
      'root_field'
    )
  );

  if (!isJsonValue(value.answer)) errors.push('answer_not_json_value');
  if (typeof value.confidence !== 'string' || !confidenceValues.has(value.confidence))
    errors.push('invalid_confidence');
  if (!Array.isArray(value.evidence)) errors.push('evidence_not_array');
  if (!isStringArray(value.filesReferenced)) errors.push('files_referenced_not_string_array');
  if (!isStringArray(value.symbolsReferenced)) errors.push('symbols_referenced_not_string_array');
  if (!isStringArray(value.unsupportedClaims)) errors.push('unsupported_claims_not_string_array');
  if (typeof value.readyToEdit !== 'boolean') errors.push('ready_to_edit_not_boolean');

  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  for (const entry of evidence) {
    if (!isRecord(entry)) continue;
    errors.push(...findAdditionalFields(entry, evidenceReferenceFields, 'evidence_field'));
    if (isRecord(entry.lineRange)) {
      errors.push(...findAdditionalFields(entry.lineRange, lineRangeFields, 'line_range_field'));
    }
  }
  const malformedEvidence = evidence.some((entry) => !isValidEvidenceReference(entry));
  if (malformedEvidence) errors.push('malformed_evidence_reference');

  if (errors.length > 0) return { status: 'invalid_schema', answer: null, errors };

  return {
    status: 'valid',
    answer: {
      answer: value.answer as JsonValue,
      confidence: value.confidence as ContextBenchStructuredAnswer['confidence'],
      evidence: evidence as ContextBenchEvidenceReference[],
      filesReferenced: value.filesReferenced as string[],
      symbolsReferenced: value.symbolsReferenced as string[],
      unsupportedClaims: value.unsupportedClaims as string[],
      readyToEdit: value.readyToEdit as boolean
    },
    errors: []
  };
}

export function parseStructuredAnswer(raw: string): StructuredAnswerParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return { status: 'invalid_schema', answer: null, errors: ['missing_json'] };
  try {
    return validateStructuredAnswer(JSON.parse(trimmed) as unknown);
  } catch {
    return { status: 'invalid_schema', answer: null, errors: ['invalid_json'] };
  }
}

export function classifyStructuredAnswer(
  answer: ContextBenchStructuredAnswer,
  diagnostics: SchemaBoundDiagnostics = {}
): AnswerClassification {
  const reasons: string[] = [];
  const malformedEvidence = answer.evidence.some((entry) => !isValidEvidenceReference(entry));
  if (answer.unsupportedClaims.length > 0) reasons.push('model_reported_unsupported_claims');
  if ((diagnostics.unsupportedEvidenceFiles?.length ?? 0) > 0)
    reasons.push('unsupported_evidence_files');
  if ((diagnostics.missingRequiredFacts?.length ?? 0) > 0) reasons.push('missing_required_facts');
  if ((diagnostics.contradictoryFacts?.length ?? 0) > 0) reasons.push('contradictory_facts');
  if ((diagnostics.missingEvidenceFiles?.length ?? 0) > 0) reasons.push('missing_evidence_files');

  const unsupportedClaim = reasons.length > 0;
  if (answer.readyToEdit && answer.confidence === 'low') reasons.push('ready_with_low_confidence');
  if (answer.readyToEdit && answer.evidence.length === 0) reasons.push('ready_without_evidence');
  if (answer.readyToEdit && malformedEvidence) reasons.push('ready_with_malformed_evidence');

  const falseReady =
    answer.readyToEdit &&
    (unsupportedClaim ||
      answer.confidence === 'low' ||
      answer.evidence.length === 0 ||
      malformedEvidence);
  return { unsupportedClaim, falseReady, reasons: [...new Set(reasons)] };
}

export function evaluateSchemaBoundDiagnostics(
  answer: ContextBenchStructuredAnswer,
  expected: { requiredFacts?: string[]; requiredEvidenceFiles?: string[] }
): SchemaBoundDiagnostics {
  const answerText = JSON.stringify(answer.answer).toLowerCase();
  const citedFiles = new Set(answer.evidence.map((entry) => entry.file));
  return {
    missingRequiredFacts: (expected.requiredFacts ?? []).filter(
      (fact) => !answerText.includes(fact.toLowerCase())
    ),
    missingEvidenceFiles: (expected.requiredEvidenceFiles ?? []).filter(
      (file) => !citedFiles.has(file)
    )
  };
}
