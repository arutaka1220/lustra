import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { common } from '../src/i18n/common'
import { english } from '../src/i18n/locales/english'
import { flattenTranslationLeaves } from '../src/i18n/validation'

const ignoredOptions = new Set(['ns', 'lng', 'defaultValue', 'context', 'ordinal', 'postProcess', 'returnObjects', 'joinArrays', 'keyPrefix', 'interpolation', 'replace'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

function properties(node: ts.Expression | undefined): { names: Set<string>; hasSpread: boolean } {
  if (!node || !ts.isObjectLiteralExpression(node)) return { names: new Set(), hasSpread: true }
  const names = new Set<string>()
  let hasSpread = false
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      hasSpread = true
      continue
    }
    const name = property.name
    if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) names.add(name.text)
  }
  return { names, hasSpread }
}

function variables(text: string): Set<string> {
  return new Set([...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]))
}

describe('translation call interpolation', () => {
  it('requires exactly the interpolation variables declared by the English resource', () => {
    const locale = flattenTranslationLeaves(english)
    const shared = flattenTranslationLeaves(common)
    const issues: string[] = []

    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
          const key = node.arguments[0]
          if (key && ts.isStringLiteralLike(key)) {
            const options = properties(node.arguments[1])
            if (!options.hasSpread) {
              const namespace = options.names.has('ns') && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
                ? node.arguments[1].properties.find((property): property is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(property) && property.name.getText(source).replace(/["']/g, '') === 'ns',
                  )?.initializer
                : undefined
              const isCommon = namespace && ts.isStringLiteralLike(namespace) && namespace.text === 'common'
              const dictionary = isCommon ? shared : locale
              const resourceTexts = dictionary[key.text] !== undefined
                ? [dictionary[key.text]]
                : Object.entries(dictionary).filter(([path]) => path.startsWith(`${key.text}_`)).map(([, text]) => text)
              if (resourceTexts.length) {
                const required = new Set(resourceTexts.flatMap((text) => [...variables(text)]))
                const provided = new Set([...options.names].filter((name) => !ignoredOptions.has(name)))
                for (const name of required) if (!provided.has(name)) issues.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${key.text}: missing {{${name}}}`)
                for (const name of provided) if (!required.has(name)) issues.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${key.text}: unexpected {{${name}}}`)
              }
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(issues).toEqual([])
  })
})
