import { describe, expect, it } from 'vitest'
import { BOM, csvCell, csvFilename, toCsv, utcIso } from './csv.js'

const rows = [{ name: 'Apollo', budget: 1200.5, due: '2026-10-15' }]
const columns = [
  { header: 'Project', value: (r) => r.name },
  { header: 'Budget (USD)', value: (r) => r.budget },
  { header: 'Due', value: (r) => r.due },
]

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, has a readable header row and ends lines with CRLF', () => {
    const csv = toCsv(columns, rows)
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.slice(1)).toBe('Project,Budget (USD),Due\r\nApollo,1200.5,2026-10-15\r\n')
  })

  it('quotes cells with commas, quotes or line breaks and doubles inner quotes (RFC 4180)', () => {
    expect(csvCell('Smith, Jane')).toBe('"Smith, Jane"')
    expect(csvCell('the "big" one')).toBe('"the ""big"" one"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('plain')).toBe('plain')
  })

  it('neutralises spreadsheet formulas by prefixing a single quote', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(csvCell('+1 555')).toBe("'+1 555")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@risk')).toBe("'@risk")
    expect(csvCell('\tTabbed')).toBe("'\tTabbed")
    expect(csvCell('\rReturn')).toBe(`"'\rReturn"`)
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`)
  })

  it('writes numbers as plain numbers, even negative ones, and empty cells for missing values', () => {
    expect(csvCell(-250)).toBe('-250')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(true)).toBe('Yes')
    expect(csvCell(false)).toBe('No')
  })

  it('keeps non-ASCII text as is', () => {
    expect(toCsv([{ header: 'Name', value: (r) => r }], ['Zoë Ångström'])).toContain('Zoë Ångström')
  })
})

describe('utcIso', () => {
  it('writes timestamps as ISO 8601 in UTC whatever offset the server used', () => {
    expect(utcIso('2026-10-14T23:07:08.338010-04:00')).toBe('2026-10-15T03:07:08.338Z')
    expect(utcIso(null)).toBe(null)
  })
})

describe('csvFilename', () => {
  it('names the file after the table and the local date', () => {
    expect(csvFilename('projects', new Date(2026, 9, 15, 23, 30))).toBe('scout-projects-2026-10-15.csv')
  })
})
