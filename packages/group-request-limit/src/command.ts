import { type Context } from 'koishi'

import * as Group from './types'
import { handle, kick } from './utils'
import type {} from '@koishijs/cache'

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
      const msg: Group.Msg[] = []
      await kick(ctx, session, config, banned, options?.permanent, options?.all, msg)
      return msg.join('\n')
    })

  ctx.command('get <ban:string>')
    .action(async (meta, ban) => {
      const handled = await handle(ctx, config, meta, ban)
      if (!handled) {
        return
      }
      const { session, banned } = handled
      const msg = []
      const res = await ctx.model.get('blacklist', { banned })
      if (!res.length) {
        msg.push(session.text('.not-exist', { banned }))
      } else {
        const _res = res[0]
        msg.push(session.text('.exist', {
          operator: _res.operator,
          group: _res.group,
          banned: _res.banned,
          reason: _res.reason,
        }))
      }
      return msg.join('\n')
    })
}
