import { Context, Time } from 'koishi'

import * as Group from './types'
import { handle, kick } from './utils'
import type {} from '@koishijs/cache'
import type {} from 'koishi-plugin-cron'

export async function apply(ctx: Context, config: Group.Config) {
  ctx.command('ban <banned:string> [reason:string]')
    .option('kick', '-k')
    .option('permanent', '-p')
    .option('all', '-a')
    .option('remove', '-r')
    .action(async (meta, ban, reason) => {
      const handled = await handle(ctx, config, meta, ban)
      if (!handled) {
        return
      }
      const { session, options, banned } = handled
      const operator = session.userId
      const msg = []
      const res = await ctx.model.get('blacklist', { banned })
      if (res.length > 0) {
        if (options?.remove) {
          const _res = await ctx.model.remove('blacklist', { banned })
          msg.push(session.text('.remove', { removed: _res.removed, banned }))
        } else {
          const _res = res[0]
          msg.push(session.text('.exist', {
            operator: _res.operator,
            group: _res.group,
            banned: _res.banned,
            reason: _res.reason,
          }))
        }
      } else {
        if (options?.remove) {
          msg.push(session.text('.not-exist', { banned }))
        } else {
          const _res = await ctx.model.create(
            'blacklist',
            {
              banned,
              operator,
              group: session.guildId,
              kick: options?.permanent ? 2 : options?.kick ? 1 : 0,
              reason: reason || '',
              time: new Date(),
            },
          )
          msg.push(session.text('.add', { banned: _res.banned }))
          for await (const key of ctx.cache.keys('GMR')) {
            const match = key.match(/(?<messageId>.*):(?<bannedId>.*):(?<guildId>.*)/)
            if (match && match.groups.bannedId === ban) {
              try {
                await session.bot.handleGuildMemberRequest(match.groups.messageId, false, reason || '黑名单自动拒绝。')
                await ctx.cache.delete('GMR', key)
              } catch {
                ctx.logger.warn(`Failed to reject ${match.groups.bannedId} access to ${match.groups.guildId}`)
              }
            }
          }
        }
      }
      if ((options?.kick || options?.permanent || options?.all) && !options?.remove) {
        await kick(ctx, session, config, banned, options?.permanent, options?.all, msg)
      }
      return msg.join('\n')
    })

  ctx.command('kick <ban:string>')
    .option('permanent', '-p')
    .option('all', '-a')
    .action(async (meta, ban) => {
      const handled = await handle(ctx, config, meta, ban)
      if (!handled) {
        return
      }
      const { session, options, banned } = handled
      const msg: (string | Element)[] = []
      await kick(ctx, session, config, banned, options?.permanent, options?.all, msg)
      return msg.join('\n')
    })

  ctx.guild(...config.groups).on('guild-member-request', async (session) => {
    if (process.env.NODE_ENV === 'development') {
      ctx.logger.info(session)
    }
    const res = await ctx.model.get('blacklist', { banned: session.userId })
    if (res.length > 0) {
      await session.bot.handleGuildMemberRequest(session.messageId, false, res[0].reason || '黑名单自动拒绝。')
      ctx.logger.info(`Rejected ${session.userId} access to ${session.guildId}`)
    } else {
      await ctx.cache.set(
        'GMR',
        `${session.messageId}:${session.userId}:${session.guildId}`,
        '',
        Time.day * 7,
      )
      ctx.logger.info(`Received ${session.userId} access to ${session.guildId}`)
    }
  })

  ctx.guild(...config.groups).on('guild-member-added', async (session) => {
    for await (const key of ctx.cache.keys('GMR')) {
      const match = key.match(/(?<messageId>.*):(?<userId>.*):(?<guildId>.*)/)
      if (match && match.groups.userId === session.userId && match.groups.guildId === session.guildId) {
        await ctx.cache.delete('GMR', key)
        break
      }
    }
  })

  if (config.useCron && !!config.cron && ctx.cron) {
    ctx.cron(config.cron, async () => {
      const banneds = await ctx.model.get('blacklist', {})
      const bots = ctx.bots.filter(bot => bot.platform === 'onebot' && !!bot.user.name)
      const groups = []
      for (const group of config.groups) {
        if (bots.length === 1) {
          groups[group].bot = bots[0]
        } else {
          for (const bot of bots) {
            try {
              const _bot = await (bot as Group.Bot).internal.getGroupMemberInfo(group, bot.selfId)
              if (_bot.role === 'admin' || _bot.role === 'owner') {
                groups[group].bot = bot
                break
              }
            } catch (err) {
            }
          }
        }
        groups[group].locales = (await ctx.database.getChannel('ontbot', group, ['locales']))?.locales
      }
      for (const banned of banneds) {
        for (const group of config.groups) {
          try {
            await (groups[group].bot as Group.Bot).getGuildMember(group, banned.banned)
            await (groups[group].bot as Group.Bot).kickGuildMember(group, banned.banned, banned.kick === 2)
            await (groups[group].bot as Group.Bot)
              .sendMessage(group, ctx.i18n.render(
                groups[group].locales,
                ['commands.kick.messages.auto'],
                { kick: banned.kick, banned: banned.banned },
              ))
            ctx.logger.info(`Auto kicked ${banned.banned} from ${group}`)
          } catch (error) {
          }
        }
      }
    })
  }
}
