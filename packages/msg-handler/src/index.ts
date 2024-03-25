import { Context, Session } from 'koishi'
import type { } from 'koishi-plugin-adapter-onebot'

export async function handleMsg(ctx: Context, meta: Session): Promise<string> {
  ctx.logger.debug('content: ' + meta.content)
  ctx.logger.debug('elements: ' + meta.elements)
  // await writeFile('meta.json', JSON.stringify(meta))

  ctx.logger.debug('guild id: ' + meta.guildId)
  ctx.logger.debug('user id: ' + meta.userId)

  const elements = meta.elements
  const msgs = []
  for (const e of elements) {
    switch (e.type) {
      case 'at': {
        const target = await meta.onebot.getGroupMemberInfo(meta.guildId, e.attrs.id)
        msgs.push(`@${target.card.length > 0 ? target.card : target.nickname}`)
        break
      }
      case 'img': {
        msgs.push(e.attrs.file)
        break
      }
      case 'face': {
        msgs.push(e.attrs.id)
        break
      }
      case 'json': {
        const data = JSON.parse(e.attrs.data)
        ctx.logger.debug(JSON.stringify(data))
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
  return msgs.join('')
}
