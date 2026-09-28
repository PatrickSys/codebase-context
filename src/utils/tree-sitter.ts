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
  /** Exact AST declaration range, excluding export/decorator wrapper nodes. */
  declarationStartLine: number;
  declarationEndLine: number;
  declarationStartIndex: number;
  declarationEndIndex: number;
  startIndex: number;
  endIndex: number;
  content: string;
  nodeType: string;
}

export interface TreeSitterSymbolExtraction {
  grammarFile: string;
  symbols: TreeSitterSymbol[];
  /** Every supported declaration occurrence, including same-line duplicates. */
  occurrences: TreeSitterSymbol[];
  /** Local bindings outside the supported callable/type declaration set. */
  unresolvedBindings: string[];
  coverageComplete: boolean;
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

export const MAX_TREE_SITTER_PARSE_BYTES = 1024 * 1024;
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

export function supportsSymbolBindingCoverage(language: string): boolean {
  return ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(language);
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

function getNamedChildren(node: Node): Node[] {
  return node.namedChildren.filter((child): child is Node => child !== null);
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

function addBindingPattern(node: Node | null, bindings: Set<string>): boolean {
  if (!node) return false;

  if (['identifier', 'type_identifier', 'shorthand_property_identifier_pattern'].includes(node.type)) {
    const name = normalizeSymbolName(node.text);
    if (!name) return false;
    bindings.add(name);
    return true;
  }

  if (node.type === 'object_pattern') {
    let complete = true;
    for (const child of getNamedChildren(node)) {
      if (child.type === 'pair_pattern') {
        const value = child.childForFieldName('value') ?? getNamedChildren(child).at(-1) ?? null;
        if (!addBindingPattern(value, bindings)) complete = false;
      } else if (child.type === 'shorthand_property_identifier_pattern') {
        if (!addBindingPattern(child, bindings)) complete = false;
      } else if (child.type === 'rest_pattern' || child.type === 'assignment_pattern') {
        if (!addBindingPattern(child, bindings)) complete = false;
      } else {
        complete = false;
      }
    }
    return complete;
  }

  if (node.type === 'array_pattern') {
    let complete = true;
    for (const child of getNamedChildren(node)) {
      if (!addBindingPattern(child, bindings)) complete = false;
    }
    return complete;
  }

  if (node.type === 'rest_pattern') {
    return addBindingPattern(getNamedChildren(node)[0] ?? null, bindings);
  }

  if (node.type === 'assignment_pattern') {
    return addBindingPattern(node.childForFieldName('left') ?? getNamedChildren(node)[0] ?? null, bindings);
  }

  if (['required_parameter', 'optional_parameter', 'parameter', 'catch_parameter'].includes(node.type)) {
    const namedChildren = getNamedChildren(node).filter(
      (child) => !['type_annotation', 'accessibility_modifier', 'override_modifier'].includes(child.type)
    );
    const pattern =
      node.childForFieldName('pattern') ??
      node.childForFieldName('name') ??
      namedChildren[0] ??
      null;
    return addBindingPattern(pattern, bindings);
  }

  return false;
}

function collectParameterBindings(root: Node, bindings: Set<string>): boolean {
  let complete = true;
  for (const parameters of root.descendantsOfType(['formal_parameters', 'parameters'])) {
    if (!parameters) {
      complete = false;
      continue;
    }
    for (const parameter of getNamedChildren(parameters)) {
      if (!addBindingPattern(parameter, bindings)) complete = false;
    }
  }

  for (const arrow of root.descendantsOfType(['arrow_function'])) {
    if (!arrow) {
      complete = false;
      continue;
    }
    const parameter =
      arrow.childForFieldName('parameter') ?? arrow.childForFieldName('parameters');
    if (parameter && ['formal_parameters', 'parameters'].includes(parameter.type)) {
      continue; // Already visited above.
    }
    if (parameter) {
      if (!addBindingPattern(parameter, bindings)) complete = false;
      continue;
    }

    const parameterList = getNamedChildren(arrow).some((child) =>
      ['formal_parameters', 'parameters'].includes(child.type)
    );
    if (!parameterList) complete = false;
  }

  for (const clause of root.descendantsOfType(['catch_clause'])) {
    if (!clause) {
      complete = false;
      continue;
    }
    const parameter =
      clause.childForFieldName('parameter') ??
      getNamedChildren(clause).find((child) => child.type !== 'statement_block') ??
      null;
    if (parameter && !addBindingPattern(parameter, bindings)) complete = false;
  }
  return complete;
}

function shouldSkipNode(language: string, node: Node): boolean {
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
    declarationStartLine: node.startPosition.row + 1,
    declarationEndLine: node.endPosition.row + 1,
    declarationStartIndex: node.startIndex,
    declarationEndIndex: node.endIndex,
    startIndex: rangeNode.startIndex,
    endIndex: rangeNode.endIndex,
    content: extractNodeContent(rangeNode, content),
    nodeType: node.type
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
      const occurrences: TreeSitterSymbol[] = [];
      const unresolvedBindings = new Set<string>();
      let coverageComplete = true;

      for (const node of nodes) {
        if (!node || !node.isNamed) continue;
        if (shouldSkipNode(language, node)) {
          if (node.type === 'variable_declarator' && !isFunctionVariableDeclarator(node)) {
            const binding = node.childForFieldName('name');
            if (binding && ['identifier', 'type_identifier'].includes(binding.type)) {
              unresolvedBindings.add(normalizeSymbolName(binding.text));
            } else {
              coverageComplete = false;
            }
          } else if (node.type === 'type_declaration') {
            const binding = maybeGetNameNode(node);
            if (binding && ['identifier', 'type_identifier'].includes(binding.type)) {
              unresolvedBindings.add(normalizeSymbolName(binding.text));
            } else {
              coverageComplete = false;
            }
          }
          continue;
        }

        const symbol = buildSymbol(node, content);
        if (symbol.name === 'anonymous') {
          continue;
        }
        occurrences.push(symbol);

        const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}:${symbol.endLine}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        symbols.push(symbol);
      }

      if (!collectParameterBindings(tree.rootNode, unresolvedBindings)) {
        coverageComplete = false;
      }

      const importStatements = tree.rootNode.descendantsOfType(['import_statement']);
      for (const possibleStatement of importStatements) {
        if (!possibleStatement) {
          coverageComplete = false;
          continue;
        }
        const statement = possibleStatement;
        const statementChildren = getNamedChildren(statement);
        const clause = statementChildren.find((child) => child.type === 'import_clause');
        if (!clause) {
          if (
            statementChildren.some((child) => !['string', 'string_literal'].includes(child.type))
          ) {
            coverageComplete = false;
          }
          continue; // Side-effect-only imports introduce no local binding.
        }
        let recognized = false;
        for (const child of getNamedChildren(clause)) {
          if (child.type === 'identifier' || child.type === 'type_identifier') {
            unresolvedBindings.add(normalizeSymbolName(child.text));
            recognized = true;
          } else if (child.type === 'namespace_import') {
            const localName = getNamedChildren(child).at(-1);
            if (localName && ['identifier', 'type_identifier'].includes(localName.type)) {
              unresolvedBindings.add(normalizeSymbolName(localName.text));
              recognized = true;
            } else {
              coverageComplete = false;
            }
          } else if (child.type === 'named_imports') {
            const specifiers = child
              .descendantsOfType(['import_specifier'])
              .filter((specifier): specifier is Node => specifier !== null);
            for (const specifier of specifiers) {
              const localName =
                specifier.childForFieldName('alias') ?? specifier.childForFieldName('name');
              if (localName && ['identifier', 'type_identifier'].includes(localName.type)) {
                unresolvedBindings.add(normalizeSymbolName(localName.text));
              } else {
                coverageComplete = false;
              }
            }
            recognized = true;
          }
        }
        if (!recognized) coverageComplete = false;
      }

      symbols.sort((a, b) => {
        if (a.startLine !== b.startLine) {
          return a.startLine - b.startLine;
        }
        return a.endLine - b.endLine;
      });
      occurrences.sort((a, b) => a.declarationStartIndex - b.declarationStartIndex);

      return {
        grammarFile: CURATED_LANGUAGE_TO_WASM[language] ?? language,
        symbols,
        occurrences,
        unresolvedBindings: [...unresolvedBindings],
        coverageComplete
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
