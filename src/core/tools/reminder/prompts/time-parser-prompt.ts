/**
 * Generate prompt for parsing Spanish time expressions
 * @param currentDateTime The current date and time formatted as YYYY-MM-DD HH:mm:ss
 * @param currentDayOfWeek The current day of week
 * @param timeExpression The user's time expression to parse
 */
export function getTimeParserPrompt(
  currentDateTime: string,
  currentDayOfWeek: string,
  timeExpression: string,
): string {
  return `Parse following Spanish time expression and convert it to minutes from now.

Current date and time: ${currentDateTime} (UTC-5)
Current day of week: ${currentDayOfWeek}

Time expression: "${timeExpression}"

Examples:
- "en 2 horas" → { minutes: 120, humanReadable: "en 2 horas", valid: true }
- "en 30 minutos" → { minutes: 30, humanReadable: "en 30 minutos", valid: true }
- "mañana a las 9am" (if now is 3pm) → { minutes: 1080, humanReadable: "mañana a las 9:00", valid: true }
- "en 1 día" → { minutes: 1440, humanReadable: "en 1 día", valid: true }
- "el viernes a las 3pm" → calculate minutes until that time
- "la próxima semana" → { minutes: 10080, humanReadable: "en 1 semana", valid: true }
- "gibberish" → { minutes: 0, humanReadable: "", valid: false }

Rules:
- If time has already passed today, assume next occurrence (tomorrow or next week)
- Always return positive minutes
- If expression is unclear or invalid, set valid to false
- humanReadable should be a natural Spanish phrase`;
}
