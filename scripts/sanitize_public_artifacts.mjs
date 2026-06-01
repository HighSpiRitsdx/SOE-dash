import fs from 'node:fs'
import path from 'node:path'

const root = 'D:/Codex/workspace/SOE analysis'
const targets = [
  path.join(root, 'public/data/lukang-workbook-snapshot.json'),
  path.join(root, 'public/data/formula-validation-report.json'),
  path.join(root, 'docs/tongfang-ifrs17-working-logic.md'),
]

const replacements = [
  [/\u9646\u5bb6\u5634\u56fd\u6cf0/g, '某寿险公司'],
  [/\u540c\u65b9\u5168\u7403/g, '目标寿险公司'],
  [/\u540c\u65b9/g, '目标公司'],
  [/\u4e2d\u65b9/g, '客户项目'],
  [/\u004d1\u004d2\u5408\u7406\u6027\u5206\u6790_\u5ba2\u6237\u9879\u76ee2512_0213/g, 'ifrs17-analysis-workbook'],
  [/M1M2_客户项目2512_0213/g, 'ifrs17-analysis-workbook'],
  [/\u004d1\u004d2\u5408\u7406\u6027\u5206\u6790_[^\\/"\s]+\.xlsx/g, 'ifrs17-analysis-workbook.xlsx'],
  [/M1M2_[^\\/"\s]+/g, 'ifrs17-analysis-workbook'],
  [/D:\\\\Codex\\\\workspace\\\\SOE analysis\\\\素材\\\\[^"]+?\.xlsx/g, 'ifrs17-analysis-workbook.xlsx'],
  [/[^\s",:：{}[\]]*(?:终身寿险|年金保险|两全保险|医疗保险|重大疾病保险)[^",:：{}[\]]*/g, '产品'],
]

function sanitizeText(text) {
  return replacements.reduce((output, [pattern, replacement]) => output.replace(pattern, replacement), text)
}

let changed = 0
for (const target of targets) {
  if (!fs.existsSync(target)) continue
  const before = fs.readFileSync(target, 'utf8')
  const after = sanitizeText(before)
  if (before !== after) {
    fs.writeFileSync(target, after, 'utf8')
    changed += 1
  }
}

console.log(JSON.stringify({ sanitizedFiles: changed }, null, 2))
