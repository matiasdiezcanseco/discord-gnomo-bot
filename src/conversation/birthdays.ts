import { ScheduledNotices } from './scheduled-notices'

export type BirthdaySource = () => Promise<unknown>
export const discordId = /^\d{17,20}$/
const datePattern =
  /^(?:01-(?:0[1-9]|[12]\d|3[01])|02-(?:0[1-9]|1\d|2[0-9])|(?:03|05|07|08|10|12)-(?:0[1-9]|[12]\d|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12]\d|30))$/

export function birthdayRecords(source: unknown): { id: string; name: string; date: string }[] {
  if (!Array.isArray(source)) return []
  return source.filter(
    (row): row is { id: string; name: string; date: string } =>
      !!row &&
      typeof row === 'object' &&
      typeof row.id === 'string' &&
      discordId.test(row.id) &&
      typeof row.name === 'string' &&
      row.name.trim().length > 0 &&
      row.name.length <= 200 &&
      typeof row.date === 'string' &&
      datePattern.test(row.date),
  )
}

export function limaDate(now: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Sole birthday producer, independent of conversation pilot membership. */
export async function scheduleBirthdays(
  now: number,
  destination: { guildId?: string; channelId?: string },
  source: BirthdaySource,
  notices: ScheduledNotices,
) {
  const { guildId, channelId } = destination
  if (!guildId || !channelId || !discordId.test(guildId) || !discordId.test(channelId)) return []
  const calendarDate = limaDate(now)
  const due = Date.parse(`${calendarDate}T08:00:00-05:00`)
  const records = []
  for (const row of birthdayRecords(await source())) {
    if (row.date !== calendarDate.slice(5)) continue
    // Source names are display data; neutralize mention syntax as well as allowedMentions.
    const name = row.name.replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ')
    records.push(
      await notices.save(
        {
          kind: 'birthday',
          guildId,
          channelId,
          requester: { id: row.id, username: name },
          calendarDate,
        },
        name,
        due,
      ),
    )
  }
  return records
}
