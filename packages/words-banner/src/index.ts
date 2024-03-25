import { inspect } from 'util'

import { handleMsg } from '@saarchaffee/msg-handler'
import { Context, Dict, Schema, Time } from 'koishi'
import type { } from 'koishi-plugin-adapter-onebot'

export const name = 'words-banner'

export const Config: Schema<Config> = Schema.object({
  blockingRules: Schema.dict(Schema.object({
    enable: Schema.boolean().description('是否启用').default(true),
    blockingWords: Schema.dict(Schema.object({
      enable: Schema.boolean().description('是否启用').default(true),
      mute: Schema.boolean().description('是否禁言').default(false),
      muteDuration: Schema.natural().role('s').description('禁言时长 (秒)').default(10 * Time.minute / 1000),
      recall: Schema.boolean().description('是否撤回').default(false),
    }).description('违禁词')).description('违禁词列表 (可使用正则表达式)').role('table'),
  }).description('群号')).description('规则列表'),
}).description('违禁词检测设置')

export function apply(ctx: Context) {
  if (Object.keys(ctx.config.blockingRules).length > 0) {
    ctx.middleware(async (meta, next) => {
      if (meta.onebot &&
        ctx.config.blockingRules[meta.guildId] &&
        ctx.config.blockingRules[meta.guildId].enable
      ) {
        const bot = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.selfId)
        if (bot.role !== 'admin' && bot.role !== 'owner') {
          return next()
        }
        ctx.logger.debug('bot info: ' + inspect(bot, { depth: null, colors: true }))

        const user = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.userId)
        ctx.logger.debug('user info: ' + inspect(user, { depth: null, colors: true }))

        const msg = await handleMsg(ctx, meta)
        const words = ctx.config.blockingRules[meta.guildId].blockingWords
        Object.keys(words).forEach(async (word) => {
          if (words[word].enable) {
            const re = new RegExp(word, 'is')
            if (re.test(msg) &&
              !(bot.role === 'admin' && (
                user.role === 'admin' ||
                user.role === 'owner'
              ))) {
              if (words[word].mute) {
                await meta.onebot.setGroupBan(meta.guildId, meta.userId, words[word].muteDuration)
              }
              if (words[word].recall) {
                await meta.onebot.deleteMsg(meta.messageId)
              }
            }
          }
        })
      }
      return next()
    }, true)
  }
}

export interface Config {
  blockingRules: Dict<BlockingRule, string>
}

interface BlockingRule {
  enable: boolean
  blockingWords: Dict<BlockingWords, string>
}

interface BlockingWords {
  enable: boolean
  mute: boolean
  muteDuration: number
  recall: boolean
}
