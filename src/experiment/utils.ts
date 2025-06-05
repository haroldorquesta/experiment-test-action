export function generateMarkdownTable(
  headers: string[],
  rows: string[][]
): string {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('Headers must be a non-empty array')
  }

  if (!Array.isArray(rows)) {
    throw new Error('Rows must be an array')
  }

  if (
    rows.some((row) => !Array.isArray(row) || row.length !== headers.length)
  ) {
    throw new Error('Each row must be an array with the same length as headers')
  }

  let table = `| ${headers.join(' | ')} |\n`
  table += `|${headers.map(() => '---').join('|')}|\n`

  for (const row of rows) {
    table += `| ${row.join(' | ')} |\n`
  }

  return table
}

export function sleep(seconds: number = 5): Promise<void> {
  if (typeof seconds !== 'number' || seconds < 0) {
    throw new Error('Seconds must be a non-negative number')
  }

  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

export function decodeBase64String(message: string): string {
  if (typeof message !== 'string') {
    throw new Error('Message must be a string')
  }

  if (message.length === 0) {
    return ''
  }

  try {
    return Buffer.from(message, 'base64').toString('utf8')
  } catch (error) {
    throw new Error(
      `Invalid base64 string: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export function formatNumber(value: number): string {
  // Check if the number has no fractional part
  if (value % 1 === 0) {
    return value.toString()
  }

  // For numbers >= 0.01, use 2 decimal places
  if (Math.abs(value) >= 0.01) {
    return parseFloat(value.toFixed(2)).toString()
  }

  // For very small numbers, use 2 significant digits
  return parseFloat(value.toPrecision(2)).toString()
}
