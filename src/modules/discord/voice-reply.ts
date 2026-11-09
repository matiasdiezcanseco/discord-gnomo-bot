import { MessageFlags, PermissionFlagsBits, Routes, type Message } from 'discord.js'
import type { Reply } from '../../conversation/harness'
import type { ReplyFile } from '../../conversation/catalog'

type VoiceFile = ReplyFile & { voice: NonNullable<ReplyFile['voice']> }

export function voiceFile(reply: Reply): VoiceFile | undefined {
  const file = reply.files?.length === 1 ? reply.files[0] : undefined
  return file?.voice ? (file as VoiceFile) : undefined
}

/** The REST body of a voice-message reply: flag, no text, and the attachment's audio metadata. */
export function voiceMessageBody(messageId: string, file: VoiceFile) {
  return {
    flags: MessageFlags.IsVoiceMessage,
    message_reference: { message_id: messageId, fail_if_not_exists: false },
    allowed_mentions: { parse: [], replied_user: false },
    attachments: [
      {
        id: 0,
        filename: file.name,
        duration_secs: file.voice.durationSecs,
        waveform: file.voice.waveform,
      },
    ],
  }
}

function canSendVoice(message: Message) {
  const me = message.guild?.members.me
  const channel = message.channel
  if (!me || !('permissionsFor' in channel)) return false
  return channel.permissionsFor(me)?.has(PermissionFlagsBits.SendVoiceMessages) ?? false
}

/**
 * discord.js only forwards `id` and `description` for uploaded files, so the voice-message
 * metadata Discord requires (`duration_secs`, `waveform`) is posted through REST directly.
 * Without SendVoiceMessages the same Ogg/Opus goes out as a regular, still playable, file.
 */
export async function replyWithVoice(message: Message, file: VoiceFile) {
  if (!canSendVoice(message)) {
    await message.reply({
      allowedMentions: { parse: [], repliedUser: false },
      files: [{ attachment: file.attachment, name: file.name }],
    })
    return
  }
  await message.client.rest.post(Routes.channelMessages(message.channelId), {
    body: voiceMessageBody(message.id, file),
    files: [{ name: file.name, data: file.attachment, contentType: 'audio/ogg' }],
  })
}
