/** Authenticated event data, independent of Discord's live objects. */
export interface Invocation {
  messageId: string
  guildId: string
  /** A thread's own ID, never its parent's ID. */
  channelId: string
  requester: { id: string; username: string }
  content: string
  createdAt: number
  attachments: {
    id: string
    url: string
    name: string
    contentType: string | null
    size: number
  }[]
}

export interface InvocationResponse {
  text: string | null
  success: boolean
}

export interface InvocationPorts {
  respond(invocation: Invocation): Promise<InvocationResponse>
  reply(invocation: Invocation, response: InvocationResponse): Promise<void>
}

/** Keep the reply tied to the originating invocation, including during concurrent calls. */
export async function respondToInvocation(
  invocation: Invocation,
  ports: InvocationPorts,
): Promise<void> {
  const response = await ports.respond(invocation)
  await ports.reply(invocation, response)
}
