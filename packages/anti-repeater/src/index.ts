import { inspect } from 'util'

import { handleMsg } from '@saarchaffee/msg-handler'
import { diffChars } from 'diff'
import { Context, Logger, Schema } from 'koishi'
import type {} from 'koishi-plugin-adapter-onebot'

export const name = 'anti-repeater'
const logger = new Logger(name)

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

function getRatio(a: string, b: string): number {
  const diff = diffChars(a, b)
  logger.debug('diff: ' + inspect(diff, { depth: null, colors: true }))

  const count = diff.reduce((acc, cur) => {
    if (!cur.added && !cur.removed) {
      acc += cur.count
    }
    return acc
  }, 0)
  logger.debug('diff count: ' + count)

  const ratio = count * 2 / (a.length + b.length)
  logger.debug('diff ratio: ' + ratio)

  return ratio
}

export function apply(ctx: Context, config: Config) {
  if (config.groupList.length) {
    const groups: Groups = {}
    config.groupList.forEach(group => {
      groups[group] = { msgs: [], repeat: false, temp: null }
    })
    ctx.middleware(async (meta, next) => {
      if (meta.onebot && (
        !config.blackListMode && config.groupList.includes(meta.guildId) ||
        config.blackListMode && !config.groupList.includes(meta.guildId)
      )) {
        const { bot, user, message } = await handleMsg(ctx, meta)
        if (bot.role !== 'admin' && bot.role !== 'owner') {
          return next()
        }

        const msg = {
          msgId: meta.messageId,
          message,
          userRole: user.role,
        }
        if (!groups[meta.guildId].msgs.length) {
          groups[meta.guildId].msgs.push(msg)
        } else {
          const ratio = getRatio(msg.message, groups[meta.guildId].msgs[0].message)

          if (ratio !== 0 && ratio >= config.similarity) {
            groups[meta.guildId].msgs.push(msg)
            if (groups[meta.guildId].msgs.length >= config.count || groups[meta.guildId].repeat) {
              groups[meta.guildId].repeat = true
              // for (let i = groups[meta.guildId].msgs.length - 1; i > 0; i--) {
              //   if (bot.role === 'admin' && (
              //     groups[meta.guildId].msgs[i]?.userRole === 'admin' ||
              //     groups[meta.guildId].msgs[i]?.userRole === 'owner'
              //   )) {
              //     continue
              //   }
              //   await meta.onebot.deleteMsg(groups[meta.guildId].msgs[i].msgId)
              // }
              const deletePromises = []
              while (groups[meta.guildId].msgs.length > 1) {
                const msg = groups[meta.guildId].msgs.pop()
                if (bot.role === 'admin' && (
                  msg?.userRole === 'admin' ||
                  msg?.userRole === 'owner'
                )) {
                  continue
                }
                deletePromises.push(meta.onebot.deleteMsg(msg.msgId))
              }
              await Promise.all(deletePromises)
            }
          } else {
            if (groups[meta.guildId].msgs.length > 1 || groups[meta.guildId].repeat) {
              if (!groups[meta.guildId].temp) {
                groups[meta.guildId].temp = msg
              } else {
                const ratio = getRatio(msg.message, groups[meta.guildId].temp.message)
                if (ratio !== 0 && ratio >= config.similarity) {
                  if (config.count === 2) {
                    await meta.onebot.deleteMsg(groups[meta.guildId].temp.msgId)
                    await meta.onebot.deleteMsg(msg.msgId)
                  } else {
                    groups[meta.guildId].msgs = [groups[meta.guildId].temp, msg]
                  }
                } else {
                  groups[meta.guildId].msgs = [msg]
                }
                groups[meta.guildId].repeat = false
                groups[meta.guildId].temp = null
              }
            } else {
              groups[meta.guildId].msgs = [msg]
            }
          }
        }
      }
      return next()
    }, true)
  }
}

export interface Groups {
  [key: string]: Group
}

interface Group {
  msgs: Msg[]
  repeat: boolean
  temp: Msg
}

interface Msg {
  msgId: string
  message: string
  userRole: string
}
