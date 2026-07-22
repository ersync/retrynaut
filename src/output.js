export function createPrinter(stream, env = process.env) {
  const colors = colorEnabled(stream, env)
  const paint = (code, value) => colors
    ? `\u001b[${code}m${String(value)}\u001b[0m`
    : String(value)
  const write = (value = '') => stream.write(`${value}\n`)

  const printer = {
    line: write,
    blank: () => write(),
    bold: (value) => paint(1, value),
    dim: (value) => paint(2, value),
    green: (value) => paint(32, value),
    yellow: (value) => paint(33, value),
    red: (value) => paint(31, value),
    title(name, detail) {
      write(`${this.bold(name)}${detail ? ` ${this.dim(detail)}` : ''}`)
    },
    section(name) {
      write(this.bold(name))
    },
    rows(entries) {
      const width = Math.max(0, ...entries.map(([label]) => label.length))
      for (const [label, value] of entries) {
        write(`  ${this.dim(label.padEnd(width))}  ${value}`)
      }
    },
    fields(entries) {
      const width = Math.max(0, ...entries.map(([label]) => label.length))
      for (const [label, value] of entries) {
        write(`${label.padEnd(width)}  ${value}`)
      }
    },
    warning(message) {
      write(`${this.yellow('!')} ${message}`)
    },
    failure(message) {
      write(this.red(message))
    },
  }
  return printer
}

export const output = createPrinter(process.stdout)
export const errorOutput = createPrinter(process.stderr)

function colorEnabled(stream, env) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false
  if (env.FORCE_COLOR === '0') return false
  if (Object.hasOwn(env, 'FORCE_COLOR')) return true
  return Boolean(stream.isTTY)
}
