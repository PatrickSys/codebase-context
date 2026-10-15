import { createRequire } from 'module';
import { Language, Parser, type Node } from 'web-tree-sitter';
import {
  CURATED_LANGUAGE_TO_WASM,
  supportsCuratedTreeSitter,
  resolveGrammarPath
} from '../grammars/manifest.js';

export interface TreeSitterSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  content: string;
  nodeType: string;
  symbolPath?: string[];
}

export interface TreeSitterSymbolExtraction {
  grammarFile: string;
  symbols: TreeSitterSymbol[];
}

const require = createRequire(import.meta.url);

const CORE_WASM_PATH = require.resolve('web-tree-sitter/tree-sitter.wasm');

const SYMBOL_CANDIDATE_NODE_TYPES = [
  'class_declaration',
  'class_definition',
  'class_specifier',
  'constructor_declaration',
  'enum_declaration',
  'enum_item',
  'function_declaration',
  'function_definition',
  'function_item',
  'generator_function_declaration',
  'interface_declaration',
  'lexical_declaration',
  'method',
  'method_declaration',
  'method_definition',
  'pair',
  'field_definition',
  'public_field_definition',
  'struct_item',
  'struct_specifier',
  'trait_item',
  'type_alias_declaration',
  'type_declaration',
  'type_spec',
  'variable_declarator'
] as const;

const NAME_FIELD_CANDIDATES = ['name', 'declarator', 'property', 'path'] as const;
const NAME_NODE_TYPE_HINTS = [
  'identifier',
  'type_identifier',
  'property_identifier',
  'scoped_identifier',
  'constant',
  'name'
] as const;

const MAX_TREE_SITTER_PARSE_BYTES = 1024 * 1024;
const TREE_SITTER_PARSE_TIMEOUT_MICROS = 30_000_000n;

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Promise<Language>>();
const parserCache = new Map<string, Promise<Parser>>();

function maybeResetParser(parser: Parser): void {
  const maybeReset = (parser as Parser & { reset?: () => void }).reset;
  if (typeof maybeReset === 'function') {
    maybeReset.call(parser);
  }
}

function evictParser(language: string, parser?: Parser): void {
  if (parser) {
    maybeResetParser(parser);
  }
  parserCache.delete(language);
}

function setParseTimeout(parser: Parser): void {
  const maybeSetTimeout = (
    parser as Parser & { setTimeoutMicros?: (timeout: number | bigint) => void }
  ).setTimeoutMicros;
  if (typeof maybeSetTimeout === 'function') {
    try {
      maybeSetTimeout.call(parser, TREE_SITTER_PARSE_TIMEOUT_MICROS);
    } catch {
      try {
        maybeSetTimeout.call(parser, Number(TREE_SITTER_PARSE_TIMEOUT_MICROS));
      } catch {
        // Ignore timeout wiring failures; parser execution still proceeds.
      }
    }
  }
}

function sliceUtf8(content: string, startIndex: number, endIndex: number): string {
  const utf8 = Buffer.from(content, 'utf8');
  return utf8.subarray(startIndex, endIndex).toString('utf8');
}

function extractNodeContent(node: Node, content: string): string {
  const byteSlice = sliceUtf8(content, node.startIndex, node.endIndex);
  const codeUnitSlice = content.slice(node.startIndex, node.endIndex);

  if (node.text === codeUnitSlice && node.text !== byteSlice) {
    return codeUnitSlice;
  }

  return byteSlice;
}

function isTreeSitterDebugEnabled(): boolean {
  return Boolean(process.env.CODEBASE_CONTEXT_DEBUG);
}

export function supportsTreeSitter(language: string): boolean {
  return supportsCuratedTreeSitter(language);
}

async function ensureParserInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        if (scriptName === 'tree-sitter.wasm') {
          return CORE_WASM_PATH;
        }
        return scriptName;
      }
    });
  }

  await initPromise;
}

async function loadLanguage(language: string): Promise<Language> {
  const wasmFile = CURATED_LANGUAGE_TO_WASM[language];
  if (!wasmFile) {
    throw new Error(`Tree-sitter grammar is not configured for '${language}'.`);
  }

  let cachedLanguage = languageCache.get(language);
  if (!cachedLanguage) {
    const { wasmPath } = resolveGrammarPath(language, import.meta.url);
    cachedLanguage = Language.load(wasmPath).catch((err) => {
      // Evict failed entry so later calls can retry after fixes
      languageCache.delete(language);
      throw err;
    });
    languageCache.set(language, cachedLanguage);
  }

  return cachedLanguage;
}

async function getParserForLanguage(language: string): Promise<Parser> {
  let cachedParser = parserCache.get(language);
  if (!cachedParser) {
    cachedParser = (async () => {
      await ensureParserInitialized();
      const parser = new Parser();
      try {
        parser.setLanguage(await loadLanguage(language));
      } catch (err) {
        // setLanguage failed — evict both caches so retry is possible
        parserCache.delete(language);
        languageCache.delete(language);
        throw err;
      }
      return parser;
    })();
    parserCache.set(language, cachedParser);
  }

  return cachedParser;
}

function getNodeKind(nodeType: string): string {
  if (nodeType.includes('class')) return 'class';
  if (nodeType.includes('interface')) return 'interface';
  if (nodeType.includes('enum')) return 'enum';
  if (nodeType.includes('struct')) return 'struct';
  if (nodeType.includes('trait')) return 'trait';
  if (nodeType.includes('constructor')) return 'method';
  if (nodeType.includes('method')) return 'method';
  if (nodeType.includes('type_alias') || nodeType === 'type_spec') return 'type';
  return 'function';
}

function normalizeSymbolName(rawName: string): string {
  return rawName
    .replace(/[\s\n\t]+/g, ' ')
    .trim()
    .replace(/^[:@#]+/, '');
}

function maybeGetNameNode(node: Node): Node | null {
  for (const fieldName of NAME_FIELD_CANDIDATES) {
    const field = node.childForFieldName(fieldName);
    if (field) {
      return field;
    }
  }

  for (const child of node.namedChildren) {
    if (!child) continue;
    if (NAME_NODE_TYPE_HINTS.some((hint) => child.type.includes(hint))) {
      return child;
    }
  }

  return null;
}

function extractNodeName(node: Node): string {
  if (node.type === 'pair') return staticPropertyName(node.childForFieldName('key')) ?? 'anonymous';
  if (['method_definition', 'field_definition', 'public_field_definition'].includes(node.type)) {
    return staticPropertyName(node.childForFieldName('name')) ?? 'anonymous';
  }
  const nameNode = maybeGetNameNode(node);
  if (nameNode?.text) {
    const normalized = normalizeSymbolName(nameNode.text);
    if (normalized) {
      return normalized;
    }
  }

  const compact = node.text.slice(0, 120).replace(/\s+/g, ' ').trim();
  const match = compact.match(
    /(?:class|interface|enum|struct|trait|function|def|fn)\s+([A-Za-z_][\w$]*)/
  );
  if (match?.[1]) {
    return match[1];
  }

  return 'anonymous';
}

/** Read only literal property keys; a computed identifier is not its runtime value. */
function staticPropertyName(node: Node | null): string | null {
  if (!node) return null;
  if (node.type === 'computed_property_name') {
    const expression = node.namedChildren[0];
    return expression?.type === 'string' || expression?.type === 'number'
      ? staticPropertyName(expression)
      : null;
  }
  if (node.type === 'string') {
    const text = node.text.slice(1, -1);
    return text.replace(
      /\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi,
      (
        _match: string,
        codePoint: string | undefined,
        unicode: string | undefined,
        hex: string | undefined,
        escaped: string | undefined
      ) => {
        const digits = codePoint ?? unicode ?? hex;
        if (digits) return String.fromCodePoint(Number.parseInt(digits, 16));
        const escapes: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          v: '\v',
          '0': '\0',
          '\n': '',
          '\r': ''
        };
        return escaped === undefined ? '' : (escapes[escaped] ?? escaped);
      }
    );
  }
  return ['identifier', 'property_identifier', 'private_property_identifier', 'number'].includes(
    node.type
  )
    ? normalizeSymbolName(node.text)
    : null;
}

function isCallableValue(node: Node | null): boolean {
  if (node?.type === 'parenthesized_expression')
    return isCallableValue(node.namedChildren[0] ?? null);
  return (
    node?.type === 'arrow_function' ||
    node?.type === 'function_expression' ||
    node?.type === 'generator_function'
  );
}

/** Property descriptors keep their immediate named owner and implementation together. */
function isCallableDescriptor(node: Node | null): boolean {
  if (node?.type !== 'object') return false;
  const fields = node.namedChildren.filter(
    (child): child is Node => child !== null && child.type !== 'comment'
  );
  const descriptorKeys = new Set(['value', 'get', 'set', 'writable', 'enumerable', 'configurable']);
  const fieldKey = (field: Node): string | null =>
    staticPropertyName(field.childForFieldName(field.type === 'pair' ? 'key' : 'name'));
  return (
    fields.length > 0 &&
    fields.every(
      (field) =>
        (field.type === 'pair' || field.type === 'method_definition') &&
        descriptorKeys.has(fieldKey(field) ?? '')
    ) &&
    fields.some((field) => {
      return (
        ['value', 'get', 'set'].includes(fieldKey(field) ?? '') &&
        (field.type === 'method_definition'
          ? field.childForFieldName('body') !== null
          : isCallableValue(field.childForFieldName('value')))
      );
    })
  );
}

function getSymbolPath(node: Node): string[] {
  const names: string[] = [];
  let current: Node | null = node;
  while (current) {
    if (
      current.type === 'pair' ||
      current.type === 'variable_declarator' ||
      ((SYMBOL_CANDIDATE_NODE_TYPES as readonly string[]).includes(current.type) &&
        !['lexical_declaration', 'type_declaration'].includes(current.type))
    ) {
      const name = extractNodeName(current);
      // A dynamic property interrupts the static route; omitting it would falsely
      // connect the inner declaration directly to an outer owner.
      if (
        ['pair', 'method_definition', 'field_definition', 'public_field_definition'].includes(
          current.type
        ) &&
        name === 'anonymous'
      )
        break;
      if (name !== 'anonymous') names.unshift(name);
    }
    current = current.parent;
  }
  return names;
}

function isFunctionVariableDeclarator(node: Node): boolean {
  if (node.type !== 'variable_declarator') {
    return false;
  }

  const valueNode = node.childForFieldName('value');
  if (!valueNode) {
    return false;
  }

  return valueNode.type === 'arrow_function' || valueNode.type === 'function_expression';
}

function shouldSkipNode(language: string, node: Node): boolean {
  if (
    (node.type === 'pair' || node.type === 'method_definition') &&
    node.parent?.parent?.type === 'pair' &&
    isCallableDescriptor(node.parent)
  ) {
    return true;
  }
  if (node.type === 'pair') {
    const value = node.childForFieldName('value');
    return !isCallableValue(value) && !isCallableDescriptor(value);
  }
  if (node.type === 'field_definition' || node.type === 'public_field_definition') {
    return !isCallableValue(node.childForFieldName('value'));
  }
  if (node.type === 'variable_declarator') {
    return (
      !['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(language) ||
      !isFunctionVariableDeclarator(node)
    );
  }

  if (node.type === 'lexical_declaration') {
    return true;
  }

  if (node.type === 'type_declaration') {
    return true;
  }

  return false;
}

function getSymbolRangeNode(node: Node): Node {
  const parent = node.parent;
  if (parent?.type === 'export_statement') {
    return parent;
  }
  return node;
}

function buildSymbol(node: Node, content: string): TreeSitterSymbol {
  const rangeNode = getSymbolRangeNode(node);

  return {
    name: extractNodeName(node),
    kind: getNodeKind(node.type),
    startLine: rangeNode.startPosition.row + 1,
    endLine: rangeNode.endPosition.row + 1,
    startIndex: rangeNode.startIndex,
    endIndex: rangeNode.endIndex,
    content: extractNodeContent(rangeNode, content),
    nodeType: node.type,
    symbolPath: getSymbolPath(node)
  };
}

export async function extractTreeSitterSymbols(
  content: string,
  language: string
): Promise<TreeSitterSymbolExtraction | null> {
  if (!supportsTreeSitter(language) || !content.trim()) {
    return null;
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_TREE_SITTER_PARSE_BYTES) {
    return null;
  }

  try {
    const parser = await getParserForLanguage(language);
    setParseTimeout(parser);

    let tree: ReturnType<Parser['parse']>;
    try {
      tree = parser.parse(content);
    } catch (error) {
      evictParser(language, parser);
      throw error;
    }

    if (!tree) {
      evictParser(language, parser);
      return null;
    }

    try {
      const hasErrorValue = tree.rootNode.hasError as unknown;
      const rootHasError =
        typeof hasErrorValue === 'function'
          ? Boolean((hasErrorValue as () => unknown)())
          : Boolean(hasErrorValue);

      if (rootHasError) {
        return null;
      }

      const nodes = tree.rootNode.descendantsOfType([...SYMBOL_CANDIDATE_NODE_TYPES]);
      const seen = new Set<string>();
      const symbols: TreeSitterSymbol[] = [];

      for (const node of nodes) {
        if (!node || !node.isNamed || shouldSkipNode(language, node)) {
          continue;
        }

        const symbol = buildSymbol(node, content);
        if (symbol.name === 'anonymous') {
          continue;
        }

        const key = `${symbol.kind}:${symbol.name}:${symbol.startIndex}:${symbol.endIndex}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        symbols.push(symbol);
      }

      symbols.sort((a, b) => {
        if (a.startLine !== b.startLine) {
          return a.startLine - b.startLine;
        }
        return a.endLine - b.endLine;
      });

      return {
        grammarFile: CURATED_LANGUAGE_TO_WASM[language] ?? language,
        symbols
      };
    } finally {
      tree.delete();
    }
  } catch (error) {
    evictParser(language);

    if (isTreeSitterDebugEnabled()) {
      console.error(
        `[DEBUG] Tree-sitter symbol extraction failed for '${language}':`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  }
}

export interface IdentifierOccurrence {
  line: number;
  startIndex: number;
  endIndex: number;
  nodeType: string;
}

const LEXICAL_IDENTIFIER_CONTINUE = /(?:\p{ID_Continue}|[$]|\u200c|\u200d)/u;
const ASCII_IDENTIFIER_CONTINUE = /[A-Za-z0-9_$]/;
const ASCII_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Conservatively nominate source for identifier matching without parsing longer
 * ASCII identifiers. Non-ASCII and non-identifier query spellings retain raw
 * substring behavior, so grammar-specific and uncertain cases remain included.
 */
export function hasIdentifierCandidate(content: string, symbol: string): boolean {
  const normalizedSymbol = symbol.trim();
  if (!normalizedSymbol) return false;
  if (!ASCII_IDENTIFIER.test(normalizedSymbol)) return content.includes(normalizedSymbol);

  let searchFrom = 0;
  while (searchFrom <= content.length - normalizedSymbol.length) {
    const startIndex = content.indexOf(normalizedSymbol, searchFrom);
    if (startIndex === -1) return false;

    const endIndex = startIndex + normalizedSymbol.length;
    const previous = startIndex > 0 ? content[startIndex - 1] : undefined;
    const next = endIndex < content.length ? content[endIndex] : undefined;
    const hasLeftBoundary = previous === undefined || !ASCII_IDENTIFIER_CONTINUE.test(previous);
    const hasRightBoundary = next === undefined || !ASCII_IDENTIFIER_CONTINUE.test(next);
    if (hasLeftBoundary && hasRightBoundary) return true;

    searchFrom = startIndex + Math.max(1, normalizedSymbol.length);
  }
  return false;
}

/**
 * Conservative language-neutral token matching for files without a usable parser.
 * This preserves whole identifier boundaries for Unicode, `_`, and `$` spellings.
 */
export function findLexicalIdentifierOccurrences(
  content: string,
  symbol: string
): IdentifierOccurrence[] {
  const normalizedSymbol = symbol.trim();
  if (!normalizedSymbol) return [];

  const occurrences: IdentifierOccurrence[] = [];
  let searchFrom = 0;
  let lineCursor = 0;
  let line = 1;
  while (searchFrom <= content.length - normalizedSymbol.length) {
    const startIndex = content.indexOf(normalizedSymbol, searchFrom);
    if (startIndex === -1) break;
    const endIndex = startIndex + normalizedSymbol.length;
    const previousIndex = startIndex > 0 ? startIndex - 1 : -1;
    const previousCodePointIndex =
      previousIndex >= 0 &&
      content.charCodeAt(previousIndex) >= 0xdc00 &&
      content.charCodeAt(previousIndex) <= 0xdfff
        ? previousIndex - 1
        : previousIndex;
    const previousCodePoint =
      previousCodePointIndex >= 0
        ? String.fromCodePoint(content.codePointAt(previousCodePointIndex) ?? 0)
        : undefined;
    const nextCodePoint =
      endIndex < content.length
        ? String.fromCodePoint(content.codePointAt(endIndex) ?? 0)
        : undefined;
    const hasIdentifierBoundary =
      (!previousCodePoint || !LEXICAL_IDENTIFIER_CONTINUE.test(previousCodePoint)) &&
      (!nextCodePoint || !LEXICAL_IDENTIFIER_CONTINUE.test(nextCodePoint));

    while (lineCursor < startIndex) {
      if (content.charCodeAt(lineCursor) === 10) line += 1;
      lineCursor += 1;
    }
    if (hasIdentifierBoundary) {
      occurrences.push({ line, startIndex, endIndex, nodeType: 'lexical_identifier' });
    }
    searchFrom = startIndex + Math.max(1, normalizedSymbol.length);
  }
  return occurrences;
}

const IDENTIFIER_NODE_TYPES = [
  'identifier',
  'type_identifier',
  'property_identifier',
  'field_identifier',
  'shorthand_property_identifier_pattern',
  'shorthand_property_identifier',
  'jsx_identifier',
  'scoped_identifier'
] as const;

const NON_CODE_ANCESTOR_TYPE_FRAGMENTS = [
  'comment',
  'string',
  'template_string',
  'regex',
  'jsx_text'
] as const;

function isInsideNonCodeContext(node: Node): boolean {
  let cursor: Node | null = node;
  let depth = 0;
  while (cursor && depth < 40) {
    const cursorType = cursor.type;
    for (const fragment of NON_CODE_ANCESTOR_TYPE_FRAGMENTS) {
      if (cursorType.includes(fragment)) {
        return true;
      }
    }
    cursor = cursor.parent;
    depth += 1;
  }
  return false;
}

/**
 * Find identifier occurrences of `symbol` in `content` using Tree-sitter.
 * Returns null when Tree-sitter isn't available/supported, so callers can fall back safely.
 */
export async function findIdentifierOccurrences(
  content: string,
  language: string,
  symbol: string
): Promise<IdentifierOccurrence[] | null> {
  const normalizedSymbol = symbol.trim();
  if (!normalizedSymbol) {
    return [];
  }

  if (!supportsTreeSitter(language) || !content.trim()) {
    return null;
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_TREE_SITTER_PARSE_BYTES) {
    return null;
  }

  try {
    const parser = await getParserForLanguage(language);
    setParseTimeout(parser);

    let tree: ReturnType<Parser['parse']>;
    try {
      tree = parser.parse(content);
    } catch (error) {
      evictParser(language, parser);
      throw error;
    }

    if (!tree) {
      evictParser(language, parser);
      return null;
    }

    try {
      const hasErrorValue = tree.rootNode.hasError as unknown;
      const rootHasError =
        typeof hasErrorValue === 'function'
          ? Boolean((hasErrorValue as () => unknown)())
          : Boolean(hasErrorValue);

      if (rootHasError) {
        return null;
      }

      const nodes = tree.rootNode.descendantsOfType([...IDENTIFIER_NODE_TYPES]);
      const occurrences: IdentifierOccurrence[] = [];
      const seen = new Set<string>();

      for (const node of nodes) {
        if (!node || !node.isNamed) continue;
        if (node.text !== normalizedSymbol) continue;
        if (isInsideNonCodeContext(node)) continue;

        const occ: IdentifierOccurrence = {
          line: node.startPosition.row + 1,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          nodeType: node.type
        };
        const key = `${occ.line}:${occ.startIndex}:${occ.endIndex}:${occ.nodeType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        occurrences.push(occ);
      }

      occurrences.sort((a, b) => {
        if (a.line !== b.line) return a.line - b.line;
        return a.startIndex - b.startIndex;
      });

      return occurrences;
    } finally {
      tree.delete();
    }
  } catch (error) {
    evictParser(language);

    if (isTreeSitterDebugEnabled()) {
      console.error(
        `[DEBUG] Tree-sitter identifier occurrence scan failed for '${language}':`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  }
}
