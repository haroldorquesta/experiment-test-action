export function generateMarkdownTable(headers: string[], rows: string[][]) {
  let table = `| ${headers.join(' | ')} |\n`
  table += `|${headers.map(() => '---').join('|')}|\n`

  for (const row of rows) {
    table += `| ${row.join(' | ')} |\n`
  }

  return table
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function decodeBase64String(message: string) {
  return Buffer.from(message, 'base64').toString('utf8')
}
