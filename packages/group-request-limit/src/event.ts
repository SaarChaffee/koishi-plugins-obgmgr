import { Time, type Context } from 'koishi'

import * as Group from './types'
import type {} from '@koishijs/cache'
import type {} from 'koishi-plugin-cron'

export async function apply(ctx: Context, config: Group.Config) {
  ctx.guild(...config.groups).on('guild-member-request', async (session) => {
    if (process.env.NODE_ENV === 'development') {
      ctx.logger.info(session)
    }
    const res = await ctx.model.get('blacklist', { banned: session.userId })
    if (res.length > 0) {
      await session.bot.handleGuildMemberRequest(session.messageId, false, res[0].reason || '黑名单自动拒绝。')
      ctx.logger.info(`Rejected ${session.userId} access to ${session.guildId}`)
      return
    }
    if (config.levelLimit) {
      const qq = await session.bot.internal.getStrangerInfo(session.userId, true)
      if (qq.qqLevel < config.level) {
        const match = config.levelIgnores.some(ignore => {
          return (new RegExp(ignore, 'is')).test(session.content)
        })
        if (!match) {
          if (!qq.qqLevel && qq.isHideQQLevel) {
            await session.bot.handleGuildMemberRequest(session.messageId, false, config.levelHided)
            ctx.logger.info(`Rejected ${session.userId} access to ${session.guildId}`)
          } else {
            await session.bot.handleGuildMemberRequest(session.messageId, false, config.levelReason)
            ctx.logger.info(`Rejected ${session.userId} access to ${session.guildId}`)
          }
        }
        return
      }
    }
    await ctx.cache.set(
      'GMR',
      `${session.messageId}:${session.userId}:${session.guildId}`,
      '',
      Time.day * 7,
    )
    ctx.logger.info(`Received ${session.userId} access to ${session.guildId}`)
  })

  ctx.guild(...config.groups).on('guild-member-added', async (session) => {
    for await (const key of ctx.cache.keys('GMR')) {
      const match = key.match(/(?<messageId>.*):(?<userId>.*):(?<guildId>.*)/)
      if (match && match.groups.userId === session.userId && match.groups.guildId === session.guildId) {
        await ctx.cache.delete('GMR', key)
        break
      }
    }

    if (config.fuck) {
      await ctx.cache.set(
        'GMRFuck',
        `${session.userId}:${session.guildId}`,
        '',
        config.fuckDuration * 60 * 1000,
      )
    }
  })

  ctx.guild(...config.groups).on('guild-member-removed', async (session) => {
    if (session.subtype === 'passive' && config.fuck) {
      for await (const key of ctx.cache.keys('GMRFuck')) {
        const match = key.match(/(?<userId>.*):(?<guildId>.*)/)
        if (match && match.groups.userId === session.userId && match.groups.guildId === session.guildId) {
          await ctx.cache.delete('GMRFuck', key)
          await ctx.model.create(
            'blacklist',
            {
              banned: session.userId,
              operator: session.selfId,
              group: session.guildId,
              kick: 0,
              reason: config.fuckReason,
              time: new Date(),
            },
          )
          break
        }
      }
    }
  })

  if (config.useCron && !!config.cron && ctx.cron) {
    ctx.cron(config.cron, async () => {
      ctx.logger.info('Auto kick start')
      const banneds = await ctx.model.get('blacklist', {})
      const bots = ctx.bots.filter(
        bot => bot.platform === 'onebot' && bot.status === 1,
      ) as unknown as Group.Bot[]
      const groups = Object.fromEntries(
        config.groups.map(group => [group, { locales: [], bot: null, output: [] }]),
      ) as unknown as Group.Group[]
      for (const group of config.groups) {
        if (bots.length === 1) {
          groups[group].bot = bots[0]
        } else {
          for (const bot of bots) {
            try {
              const _bot = await bot.internal.getGroupMemberInfo(group, bot.selfId)
              if (_bot.role === 'admin' || _bot.role === 'owner') {
                groups[group].bot = bot
                break
              }
            } catch (err) {
            }
          }
        }
        groups[group].locales = (await ctx.database.getChannel('ontbot', group, ['locales']))?.locales
        groups[group].members = await (groups[group].bot as Group.Bot).internal.getGroupMemberList(group, true)
      }
      for (const banned of banneds) {
        for (const group of config.groups) {
          try {
            if (groups[group].members.some(m => m.user_id + '' === banned.banned)) {
              await (groups[group].bot as Group.Bot).internal.setGroupKick(group, banned.banned, banned.kick === 2)
              groups[group].output.push(ctx.i18n.render(
                groups[group].locales,
                ['commands.kick.messages.auto'],
                { kick: banned.kick, banned: banned.banned },
              ))
              ctx.logger.info(`Auto kicked ${banned.banned} from ${group}`)
            }
          } catch (error) {
          }
        }
      }
      for (const group of config.groups) {
        if (groups[group].output.length === 1) {
          await groups[group].bot
            .sendMessage(group, `${groups[group].output[0].join('')}`)
        } else if (groups[group].output.length > 1) {
          await groups[group].bot
            .sendMessage(group, `${groups[group].output.map(o => o.join('')).join('')}`)
        }
      }
    })
  }
}
