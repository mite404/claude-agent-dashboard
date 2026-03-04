/**
 * Fix Tailwind v4 syntax
 * Converts: rounded-[var(--radius)] → rounded-(--radius)
 * Converts: bg-[var(--color)] → bg-(--color)
 * Converts: data-[disabled] → data-disabled
 * Converts: data-[state=open] → data-state-open
 */

import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const srcDir = './src'

async function fixFile(filepath: string) {
  let content = await readFile(filepath, 'utf-8')
  const original = content

  // Fix 1: [var(--something)] → (--something)
  content = content.replace(/\[var\(([^)]+)\)\]/g, '($1)')

  // Fix 2: data-[attributeName] → data-attributeName
  //        data-[state=open] → data-state-open (replace = with -)
  content = content.replace(/data-\[([^\]]+)\]/g, (match, attr) => {
    return `data-${attr.replace('=', '-')}`
  })

  if (original !== content) {
    await writeFile(filepath, content, 'utf-8')
    return true
  }
  return false
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files.push(...await walkDir(fullPath))
      }
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

async function main() {
  console.log('🔧 Fixing Tailwind v4 CSS variable syntax...\n')

  const files = await walkDir(srcDir)
  let fixed = 0

  for (const file of files) {
    if (await fixFile(file)) {
      console.log(`✓ ${file}`)
      fixed++
    }
  }

  console.log(`\n✅ Fixed ${fixed} file(s)`)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
