import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import { inspect } from 'util'

import { Context, Session } from 'koishi'

import type { OneBot } from 'koishi-plugin-adapter-onebot'

export async function handleMsg(ctx: Context, meta: Session): Promise<Content> {
  const bot = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.selfId)
  const user = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.userId)
  if (process.env.NODE_ENV === 'development') {
    // ctx.logger.info('bot info: ' + inspect(bot, { depth: null, colors: true }))
    // ctx.logger.info('user info: ' + inspect(user, { depth: null, colors: true }))
    // ctx.logger.info('bot: ' + inspect(meta.selfId, { depth: null, colors: true }))
    ctx.logger.info('elements: ' + inspect(meta.elements, { depth: null, colors: true }))
    // ctx.logger.info('content: ' + inspect(meta.content, { depth: null, colors: true }))
    await writeFile(resolve(__dirname, `../temp/${ctx.name}-${meta.selfId}.json`), JSON.stringify(meta, null, 2))
  }

  const elements = meta.elements
  const msgs = []
  for (const e of elements) {
    switch (e.type) {
      case 'at': {
        const target = await meta.onebot.getGroupMemberInfo(meta.guildId, e.attrs.id)
        // ctx.logger.info('target info: ' + inspect(target, { depth: null, colors: true }))
        msgs.push(`@${target.card.length > 0 ? target.card : target.nickname}`)
        break
      }
      case 'img': {
        msgs.push(e.attrs?.fileUnique || e.attrs.file)
        break
      }
      case 'face': {
        msgs.push(e.attrs.id)
        break
      }
      case 'mface': {
        msgs.push(e.attrs.emojiId)
        break
      }
      case 'forward': {
        msgs.push(e.attrs.id)
        break
      }
      case 'json': {
        const data = JSON.parse(e.attrs.data)
        msgs.push(JSON.stringify(data))
        break
      }
      case 'text':
      default: {
        msgs.push(e.attrs.content)
        break
      }
    }
  }

  if (process.env.NODE_ENV === 'development') {
    ctx.logger.info('message: ' + inspect(msgs, { depth: null, colors: true }))
  }
  return {
    bot,
    user,
    message: msgs.join(''),
  }
}

export interface Content {
  bot: OneBot.GroupMemberInfo
  user: OneBot.GroupMemberInfo
  message: string
}
