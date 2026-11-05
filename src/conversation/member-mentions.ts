import type { ConversationPorts } from './harness'
import type { MemberDirectory } from './member-directory'

/** Only direct, whole-message requests grant authority. Model results and embedded syntax never do. */
export function memberMentions(
  directory: MemberDirectory,
): NonNullable<ConversationPorts['allowedUserMentions']> {
  return async (invocation, context) => {
    const request =
      /^(?:por favor[, ]+)?(?:menciona|mencioná|etiqueta|etiquetá|mention|tag)\s+(?:a\s+)?(<@!?\d+>|[\p{L}\p{N}_ .-]{1,64}?)[.!]?$/iu.exec(
        invocation.content.trim(),
      )
    if (!request) return []
    const target = request[1].trim()
    let id = /^(?:<@!?)?(\d+)>?$/.exec(target)?.[1]
    if (!id) {
      const candidates = new Map<string, string>()
      let after: string | undefined
      let complete = false
      for (let page = 0; page < 3; page++) {
        const result = await directory.list(context, 100, after)
        for (const member of result.members) {
          if (
            [member.username, member.nickname, member.displayName].some(
              (name) => name?.toLocaleLowerCase() === target.toLocaleLowerCase(),
            )
          )
            candidates.set(member.id, member.username)
        }
        if (result.coverage === 'complete') {
          complete = true
          break
        }
        if (!result.nextAfter) break
        after = result.nextAfter
      }
      if (!complete || candidates.size !== 1)
        return {
          users: [],
          clarification: `Necesito aclarar a quién mencionar${complete ? '' : ' (cobertura incompleta)'}. Indica el ID del miembro.${
            candidates.size
              ? ` Coincidencias: ${[...candidates]
                  .slice(0, 10)
                  .map(([id, name]) => `${name} (ID ${id})`)
                  .join(', ')}.`
              : ''
          }`,
        }
      id = candidates.keys().next().value!
    }
    const result = await directory.detail(context, id)
    return result.coverage === 'complete' && result.member?.id === id
      ? [id]
      : {
          users: [],
          clarification:
            'No pude confirmar que ese ID pertenezca actualmente al servidor; no autoricé la mención.',
        }
  }
}
