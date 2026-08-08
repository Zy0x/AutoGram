import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const srcRoot = path.join(root, 'src');
const localesRoot = path.join(srcRoot, 'locales');

function walk(dir, predicate) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full, predicate));
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function flatten(value, prefix = '', output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, full, output);
    else output.set(full, child);
  }
  return output;
}

function loadLocale(language) {
  const output = new Map();
  for (const file of walk(path.join(localesRoot, language), (item) => item.endsWith('.json'))) {
    const namespace = path.basename(file, '.json');
    const values = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const [key, value] of values) output.set(`${namespace}.${key}`, value);
  }
  return output;
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return value
    .replace(/&#10;/gi, '\n')
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&rarr;/gi, '→');
}

function looksUserFacing(value) {
  const text = normalizeText(decodeEntities(value));
  if (!text || !/[A-Za-z\u00c0-\u024f\u0400-\u04ff\u4e00-\u9fff]/u.test(text)) return false;
  if (/^(https?:|data:|blob:|file:|[.#/]|--)/i.test(text)) return false;
  if (/^[a-z0-9_-]+\.(css|json|ts|tsx|js|jsx|rs|py)$/i.test(text)) return false;
  return true;
}

const id = loadLocale('id');
const en = loadLocale('en');
const idOnly = [...id.keys()].filter((key) => !en.has(key));
const enOnly = [...en.keys()].filter((key) => !id.has(key));
const used = new Set();
const fallbackCalls = [];
const hardcoded = [];
const files = walk(srcRoot, (file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file));
const attrNames = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);
const uiSetterNames = /^(?:set\w*(?:Error|Text|Message|Msg|Hint|Warn|Notice|Toast|Label|Title|Progress)\w*|flash\w*Warn|alert|confirm)$/;

function containingUiContext(node, source) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText(source).split('.').at(-1) ?? '';
      return uiSetterNames.test(callee) ? { kind: 'ui-call', boundary: current } : undefined;
    }
    if (ts.isJsxAttribute(current)) {
      const attr = current.name.getText(source);
      if (attrNames.has(attr)) return { kind: attr, boundary: current };
      if (attr === 'value') {
        const tag = current.parent.parent.tagName?.getText(source) ?? '';
        if (/^[A-Z]/.test(tag)) return { kind: 'component-value', boundary: current };
      }
      return undefined;
    }
    if (ts.isJsxExpression(current) && !ts.isJsxAttribute(current.parent)) return { kind: 'jsx-expression', boundary: current };
    if (ts.isFunctionLike(current)) return undefined;
  }
  return undefined;
}

function flowsToUi(node, boundary) {
  let current = node;
  while (current.parent && current.parent !== boundary) {
    const parent = current.parent;
    if (ts.isConditionalExpression(parent)) {
      if (parent.condition === current) return false;
    } else if (ts.isBinaryExpression(parent)) {
      if (![ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) return false;
    } else if (!ts.isParenthesizedExpression(parent) && !ts.isAsExpression(parent) && !ts.isSatisfiesExpression(parent)) {
      return false;
    }
    current = parent;
  }
  return current.parent === boundary;
}

for (const file of files) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const [first, second] = node.arguments;
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) used.add(first.text);
      if (second && (ts.isStringLiteral(second) || ts.isNoSubstitutionTemplateLiteral(second))) {
        fallbackCalls.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, value: second.text });
      }
    }
    if (ts.isJsxText(node) && looksUserFacing(node.text)) {
      hardcoded.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: 'jsx', value: normalizeText(decodeEntities(node.text)) });
    }
    if (ts.isJsxAttribute(node) && attrNames.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer) && looksUserFacing(node.initializer.text)) {
      hardcoded.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: node.name.getText(source), value: normalizeText(decodeEntities(node.initializer.text)) });
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent)) {
      const context = containingUiContext(node, source);
      const value = normalizeText(decodeEntities(node.text));
      const isTranslationKey = ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 't' && node.parent.arguments[0] === node;
      if (context && flowsToUi(node, context.boundary) && !isTranslationKey && looksUserFacing(value) && !/^[-\w]+\/[\w.+-]+$/.test(value)) {
        hardcoded.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: context.kind, value });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const missing = [...used].filter((key) => !id.has(key) || !en.has(key));
const summary = {
  localeKeys: { id: id.size, en: en.size },
  parity: { idOnly, enOnly },
  usedKeys: used.size,
  missing,
  fallbackCalls,
  hardcodedCount: hardcoded.length,
  hardcodedByFile: Object.entries(Object.groupBy(hardcoded, (item) => item.file)).map(([file, items]) => ({ file, count: items.length })).sort((a, b) => b.count - a.count),
  hardcoded,
};

const outputPath = process.argv[2];
if (outputPath) fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, hardcoded: undefined }, null, 2));
if (idOnly.length || enOnly.length || missing.length || fallbackCalls.length) process.exitCode = 1;
