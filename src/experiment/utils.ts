export function generateMarkdownTable(headers: string[], rows: string[][]) {
  let table = `| ${headers.join(' | ')} |\n`
  table += `|${headers.map(() => '---').join('|')}|\n`

  for (const row of rows) {
    table += `| ${row.join(' | ')} |\n`
  }

  return table
}

export function sleep(seconds = 5) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

export function decodeBase64String(message: string) {
  return Buffer.from(message, 'base64').toString('utf8')
}
