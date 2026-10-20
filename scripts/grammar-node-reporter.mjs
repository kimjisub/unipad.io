// Preserve native test events, including failures and skipped tests, as JSON lines.
export default async function* report(events) {
  for await (const event of events) {
    yield `${JSON.stringify(event, (_key, value) => value instanceof Error
      ? { ...value, message: value.message, stack: value.stack } : value)}\n`;
  }
}
