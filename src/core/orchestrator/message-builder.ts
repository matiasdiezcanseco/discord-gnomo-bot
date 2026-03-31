import type { ModelMessage } from 'ai'
import type { BotContext, MessageHistory } from '../context/bot-context'

export class MessageBuilder {
  private convertHistoryToMessages(history: MessageHistory[]): ModelMessage[] {
    return history.map((msg) => {
      const baseContent = msg.role === 'user' ? `[${msg.username}]: ${msg.content}` : msg.content

      if (msg.images && msg.images.length > 0) {
        const content: ModelMessage['content'] = [{ type: 'text', text: baseContent }]

        for (const image of msg.images) {
          ;(content as Array<{ type: 'text' | 'image'; text?: string; image?: string }>).push({
            type: 'image',
            image: image.url,
          })
        }

        return {
          role: msg.role,
          content,
        } as ModelMessage
      }

      return {
        role: msg.role,
        content: baseContent,
      }
    })
  }

  build(ctx: BotContext): ModelMessage[] {
    const historyMessages = this.convertHistoryToMessages(ctx.history)

    const currentMessageBase = `[${ctx.userInfo.username}]: ${ctx.message}`

    if (ctx.images && ctx.images.length > 0) {
      const content: ModelMessage['content'] = [{ type: 'text', text: currentMessageBase }]

      for (const image of ctx.images) {
        ;(content as Array<{ type: 'text' | 'image'; text?: string; image?: string }>).push({
          type: 'image',
          image: image.url,
        })
      }

      historyMessages.push({
        role: 'user',
        content,
      } as ModelMessage)
    } else {
      historyMessages.push({
        role: 'user',
        content: currentMessageBase,
      })
    }

    return historyMessages
  }
}
