import { inspect } from 'util'

import { diffChars } from 'diff'
import { Context, Schema } from 'koishi'
import type { } from 'koishi-plugin-adapter-onebot'

export const name = 'anti-repeater'

export interface Config {
  blackListMode: boolean
  groupList: string[]
  similarity: number
  count: number
}

export const Config: Schema<Config> = Schema.object({
  blackListMode: Schema.boolean().default(false).description('切换黑白名单模式，默认为白名单模式，开启后为黑名单模式。'),
  groupList: Schema.array(Schema.string()).default([]).description('生效的群组列表，为空则不启用。'),
  similarity: Schema.percent().default(0.6).description('判断是否为复读的相似度阈值，范围为 0 到 1，默认为 0.6。'),
  count: Schema.number().default(3).description('触发反复读的复读次数。'),
})

export function apply(ctx: Context) {
  if (ctx.config.groupList.length) {
    const groups: Groups = {}
    ctx.config.groupList.forEach(group => {
      groups[group] = { msgs: [], repeat: false }
    })
    ctx.middleware(async (meta, next) => {
      if (meta.onebot && (
        !ctx.config.blackListMode && ctx.config.groupList.includes(meta.guildId) ||
        ctx.config.blackListMode && !ctx.config.groupList.includes(meta.guildId)
      )) {
        ctx.logger.debug('content: ' + meta.content)
        ctx.logger.debug('elements: ' + meta.elements)
        // await writeFile('meta.json', JSON.stringify(meta))

        ctx.logger.debug('guild id: ' + meta.guildId)
        ctx.logger.debug('user id: ' + meta.userId)

        const bot = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.selfId)
        if (bot.role !== 'admin' && bot.role !== 'owner') {
          return next()
        }
        ctx.logger.debug('bot info: ' + inspect(bot, { depth: null, colors: true }))

        const user = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.userId)
        ctx.logger.debug('user info: ' + inspect(user, { depth: null, colors: true }))

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
            case 'text':
            default: {
              msgs.push(e.attrs.content)
              break
            }
          }
        }

        const msg = msgs.join('')
        if (!groups[meta.guildId].msgs.length) {
          groups[meta.guildId].msgs.push({
            msgId: meta.messageId,
            message: msg,
            userRole: user.role,
          })
        } else {
          const diff = diffChars(msg, groups[meta.guildId].msgs[0].message)
          ctx.logger.debug('diff: ' + inspect(diff, { depth: null, colors: true }))

          const count = diff.reduce((acc, cur) => {
            if (!cur.added && !cur.removed) {
              acc += cur.count
            }
            return acc
          }, 0)
          ctx.logger.debug('diff count: ' + count)

          const ratio = count * 2 / (msg.length + groups[meta.guildId].msgs[0].message.length)
          ctx.logger.debug('diff ratio: ' + ratio)

          if (ratio !== 0 && ratio >= ctx.config.similarity) {
            groups[meta.guildId].msgs.push({
              msgId: meta.messageId,
              message: msg,
              userRole: user.role,
            })
            if (groups[meta.guildId].msgs.length >= ctx.config.count || groups[meta.guildId].repeat) {
              groups[meta.guildId].repeat = true
              for (let i = groups[meta.guildId].msgs.length - 1; i > 0; i--) {
                if (bot.role === 'admin' && (
                  groups[meta.guildId].msgs[i].userRole === 'admin' ||
                  groups[meta.guildId].msgs[i].userRole === 'owner'
                )) {
                  continue
                }
                await meta.bot.deleteMessage(meta.guildId, groups[meta.guildId].msgs[i].msgId)
              }
            }
          } else {
            groups[meta.guildId].msgs = [{
              msgId: meta.messageId,
              message: msg,
              userRole: user.role,
            }]
            groups[meta.guildId].repeat = false
          }
        }
      }
      return next()
    }, true)
  }
}

interface Groups {
  [key: string]: Group
}

interface Group {
  msgs: Msg[]
  repeat: boolean
}

interface Msg {
  msgId: string
  message: string
  userRole: string
}
