function field(text: string, low: number, high: number, weekday = false): Set<number> {
  const values = new Set<number>();
  for (const segment of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(segment);
    if (!match) throw new Error(`Invalid cron field: ${text}`);
    const base = match[1]!, step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error('Cron step must be a positive integer');
    const range = base === '*' ? [low, high] : base.split('-').map(Number);
    const start = range[0]!, end = range[1] ?? start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < low || end > high || start > end) throw new Error(`Cron field out of range: ${text}`);
    for (let value = start; value <= end; value += step) values.add(weekday && value === 7 ? 0 : value);
  }
  return values;
}

export function parseCron(expression: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron must contain exactly five fields');
  return {
    minute: field(parts[0]!, 0, 59), hour: field(parts[1]!, 0, 23), dayOfMonth: field(parts[2]!, 1, 31),
    month: field(parts[3]!, 1, 12), dayOfWeek: field(parts[4]!, 0, 7, true),
    dayOfMonthWildcard: parts[2]!.startsWith('*'), dayOfWeekWildcard: parts[4]!.startsWith('*'),
  };
}

export function cronMatches(expression: string, date: Date): boolean {
  const cron = parseCron(expression);
  if (!cron.minute.has(date.getUTCMinutes()) || !cron.hour.has(date.getUTCHours()) || !cron.month.has(date.getUTCMonth() + 1)) return false;
  const dayOfMonth = cron.dayOfMonth.has(date.getUTCDate()), dayOfWeek = cron.dayOfWeek.has(date.getUTCDay());
  // Cron's wildcard flag is syntactic (also applies to */N), not the expanded set's size.
  return cron.dayOfMonthWildcard || cron.dayOfWeekWildcard ? dayOfMonth && dayOfWeek : dayOfMonth || dayOfWeek;
}
