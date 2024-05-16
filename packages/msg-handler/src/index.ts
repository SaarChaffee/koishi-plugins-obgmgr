import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import { inspect } from 'util'

import { Context, Session } from 'koishi'
import type { } from 'koishi-plugin-adapter-onebot'

export async function handleMsg(ctx: Context, meta: Session): Promise<string> {
  if (process.env.NODE_ENV === 'development') {
    ctx.logger.info('content: ' + inspect(meta.content, { depth: null, colors: true }))
    ctx.logger.info('elements: ' + inspect(meta.elements, { depth: null, colors: true }))
    await writeFile(resolve(__dirname, `../temp/${ctx.name}.json`), JSON.stringify(meta, null, 2))
    ctx.logger.info('guild id: ' + inspect(meta.guildId, { depth: null, colors: true }))
    ctx.logger.info('user id: ' + inspect(meta.userId, { depth: null, colors: true }))
  }

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
