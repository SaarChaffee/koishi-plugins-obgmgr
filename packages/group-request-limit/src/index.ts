import { Argv, Context, Schema, Session, Time, h } from 'koishi'

import type {} from '@koishijs/cache'

import * as Group from './types'

export const name = 'group-request-limit'

declare module 'koishi' {
  interface Tables {
    blacklist: Group.Blacklist
  }
}

declare module '@koishijs/cache' {
  interface Tables {
    GMR: string
  }
}

export const inject = ['database', 'cache']

export async function apply(ctx: Context, config: Group.Config) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ctx.i18n.define('zh', require('./locales/zh-CN'))

  ctx.model.extend(
    'blacklist',
    {
      banned: { type: 'string', length: 25, nullable: false },
      operator: { type: 'string', length: 25, nullable: false },
      group: { type: 'string', length: 25, nullable: false },
      reason: { type: 'string', length: 25 },
      kick: 'boolean',
      time: 'timestamp',
    },
    {
      primary: 'banned',
    },
  )

  if (config.list.length > 0) {
    while (config.list.length > 0) {
      const banned = config.list.pop()
      const res = await ctx.model.get('blacklist', { banned })
      if (res.length > 0) {
        continue
      }
      const _res = await ctx.model.create(
        'blacklist',
        {
          banned,
          operator: ctx.bots.filter(bot => bot.platform === 'onebot').map(bot => bot.selfId)[0],
          group: config.groups[0],
          kick: false,
        },
      )
      ctx.logger.info(`已自动添加「${_res.banned}」到数据库黑名单。`)
    }
    ctx.scope.update(config, false)
  }

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
          msg.push(_res.removed > 0 ? `已将「${banned}」移出黑名单。` : `移出失败。`)
        } else {
          const _res = res[0]
          msg.push(`黑名单中「${_res.banned}」已存在。`)
          msg.push(`由「${_res.operator}」在群「${_res.group}」添加。`)
          if (_res.reason) {
            msg.push(`原因：${_res.reason}`)
          }
        }
      } else {
        if (options?.remove) {
          msg.push(`黑名单中「${banned}」不存在。`)
        } else {
          const _res = await ctx.model.create(
            'blacklist',
            {
              banned,
              operator,
              group: session.guildId,
              reason: reason || '',
              kick: options?.kick,
              time: new Date(),
            },
          )
          msg.push(`已添加「${_res.banned}」到黑名单。`)
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
      const msg = []
      await kick(ctx, session, config, banned, options?.permanent, options?.all, msg)
      return msg[0]
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
}

async function handle(ctx: Context, config: Group.Config, meta: Argv, banned: string): Promise<false | Group.Handle> {
  const { session, options } = meta
  if (process.env.NODE_ENV === 'development') {
    ctx.logger.info(JSON.stringify(meta))
  }
  if (!config.groups.includes(session.guildId)) {
    return false
  }

  const role = session.event.member.roles[0]
  if (role !== 'owner' && role !== 'admin') {
    return false
  }

  if (session?.quote) {
    banned = session.quote.user.id
  } else {
    if (!banned || banned.trim().length === 0) {
      return false
    }
    switch (h.parse(banned)[0].type) {
      case 'at': {
        banned = h.parse(banned)[0].attrs.id
        break
      }
      case 'text': {
        banned = h.parse(banned)[0].attrs.content
        break
      }
      default: {
        return false
      }
    }
  }
  if (!isNumeric(banned)) {
    return false
  }
  return { session, options, banned }
}

async function kick(
  context: Context,
  session: Session,
  config: Group.Config,
  banned: string,
  permanent: boolean,
  all: boolean,
  msg: string[],
) {
  try {
    await session.bot.getGuildMember(session.guildId, banned)
    await session.bot.kickGuildMember(session.guildId, banned, permanent)
    msg.push(`已将「${banned}」${permanent ? '永久' : ''}踢出本群。`)
  } catch (error) {
    context.logger.warn(`Failed to kick ${banned} from ${session.guildId}`)
  }
  if (all) {
    for (const group of config.groups) {
      if (group === session.guildId) {
        continue
      }
      try {
        await session.bot.getGuildMember(group, banned)
        await session.bot.kickGuildMember(group, banned, permanent)
        msg.push(`${permanent ? '永久' : ''}踢出群「${group}」成功。`)
      } catch (error) {
        context.logger.warn(`Failed to kick ${banned} from ${group}`)
      }
    }
  }
}

function isNumeric(str: string): boolean {
  return !isNaN(parseFloat(str)) && isFinite(str as never)
}

export const Config: Schema<Group.Config> = Schema.object({
  groups: Schema.array(Schema.string()).description('群组生效白名单'),
  list: Schema.array(Schema.string()).description('黑名单列表'),
})
