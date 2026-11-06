import { z } from 'zod'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { defineCapability } from './catalog'
import type { Invocation } from '../core/conversation/invocation'
import type { ScheduledNotices } from './scheduled-notices'

dayjs.extend(utc)
dayjs.extend(timezone)
const request = /^(?:por favor,?\s+)?(?:recu[eé]rdame|recordarme)\s+(.+)$/i
function parse(invocation: Invocation) {
  let body = request.exec(invocation.content.trim())?.[1]
  if (!body || /<@|@everyone|@here/.test(body)) return null
  body = body.replace(
    /a las (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    (literal, hour, minute, period) => {
      const h = Number(hour)
      if (h < 1 || h > 12 || Number(minute ?? 0) > 59) return literal
      return `a las ${String((h % 12) + (period.toLowerCase() === 'pm' ? 12 : 0)).padStart(2, '0')}:${minute ?? '00'}`
    },
  )
  const relative = /^en (\d+) (minutos?|horas?|d[ií]as?)\s+(.+)$/i.exec(body)
  if (relative) {
    const units = /^min/i.test(relative[2])
      ? 60000
      : /^hora/i.test(relative[2])
        ? 3600000
        : 86400000
    const due = invocation.createdAt + Number(relative[1]) * units
    return Number(relative[1]) > 0 && Number(relative[1]) <= 525600 && Number.isSafeInteger(due)
      ? { due, text: relative[3] }
      : null
  }
  const tomorrow = /^ma[ñn]ana a las (\d{2}:\d{2})\s+(.+)$/i.exec(body)
  const dated =
    /^(\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})\s+(.+)$/i.exec(body) ??
    (tomorrow
      ? [
          '',
          dayjs(invocation.createdAt).tz('America/Lima').add(1, 'day').format('YYYY-MM-DD'),
          tomorrow[1],
          tomorrow[2],
        ]
      : null)
  if (dated) {
    const literal = `${dated[1]} ${dated[2]}`
    let date: dayjs.Dayjs
    try {
      date = dayjs.tz(literal, 'America/Lima')
    } catch {
      return null
    }
    if (
      date.isValid() &&
      date.format('YYYY-MM-DD HH:mm') === literal &&
      date.valueOf() > invocation.createdAt
    )
      return { due: date.valueOf(), text: dated[3] }
  }
  return null
}
export function reminderCapability(store?: ScheduledNotices) {
  return defineCapability({
    name: 'reminder_create',
    description:
      'Crea solo un recordatorio propio pedido explícitamente en la invocación actual. Sin argumentos: fecha y texto proceden de la petición actual. Si el tiempo es ambiguo pide fecha YYYY-MM-DD a las HH:mm en America/Lima, o en N minutos/horas/días.',
    capability: 'reminders.own',
    scope: 'channel',
    effect: 'write',
    input: z.strictObject({}),
    output: z.strictObject({ message: z.string() }),
    maxCalls: 1,
    maxResultChars: 1000,
    available: async () => true,
    direct: {
      matches: (i) => request.test(i.content.trim()),
      input: {},
      render: (r) =>
        r.status === 'success'
          ? (r.value as { message: string }).message
          : r.status === 'uncertain'
            ? 'El guardado tiene estado incierto; no puedo confirmarlo ni reintentarlo automáticamente.'
            : 'No pude guardar el recordatorio.',
    },
    execute: async (_, context) => {
      const parsed = parse(context.invocation)
      if (!parsed || parsed.text.length > 1000)
        return {
          message:
            '¿Qué fecha y hora exactas en America/Lima? Usa «recuérdame YYYY-MM-DD a las HH:mm texto» o «recuérdame en N minutos texto». Solo puedo recordártelo a ti aquí.',
        }
      if (!store) return { message: 'Recordatorios no disponibles; no se guardó ninguno.' }
      context.signal.throwIfAborted()
      const saved = await context.external(() =>
        store.save(context.invocation, parsed.text, parsed.due),
      )
      return {
        message: `Recordatorio guardado para ${dayjs(saved.due).tz('America/Lima').format('YYYY-MM-DD HH:mm')} America/Lima.`,
      }
    },
  })
}
