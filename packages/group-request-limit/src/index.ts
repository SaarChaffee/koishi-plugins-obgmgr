import { Argv, Context, Schema, Session, Time, h } from 'koishi'

import type {} from '@koishijs/cache'
import type {} from 'koishi-plugin-cron'
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

export const inject = {
  required: ['database', 'cache'],
  optional: ['cron'],
}

export async function apply(ctx: Context, config: Group.Config) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ctx.i18n.define('zh', require('./locales/zh-CN'))

  ctx.model.extend(
    'blacklist',
    {
      banned: { type: 'string', length: 25, nullable: false },
      operator: { type: 'string', length: 25, nullable: false },
      group: { type: 'string', length: 25, nullable: false },
      kick: { type: 'integer', length: 1, nullable: false },
      reason: { type: 'string', length: 25 },
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
          kick: 0,
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
        if (banned.kick !== 0) {
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
      }
    })
  }
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
  msg: (string | Element)[],
) {
  try {
    await session.bot.getGuildMember(session.guildId, banned)
    await session.bot.kickGuildMember(session.guildId, banned, permanent)
    msg.push(session.text('.kick.self', { permanent, banned }))
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
        msg.push(session.text('.kick.other', { permanent, banned, group }))
      } catch (error) {
        context.logger.warn(`Failed to kick ${banned} from ${group}`)
      }
    }
  }
}

function isNumeric(str: string): boolean {
  return !isNaN(parseFloat(str)) && isFinite(str as never)
}

export const Config: Schema<Group.Config> = Schema.intersect([
  Schema.object({
    groups: Schema.array(Schema.string()).description('群组生效白名单'),
    list: Schema.array(Schema.string()).description('黑名单列表'),
    useCron: Schema.boolean().default(false)
      .description('是否启用定时扫描黑名单列表清除漏网之鱼<br/>需要 cron 服务'),
  }),
  Schema.union([
    Schema.object({
      useCron: Schema.const(true).required(),
      cron: Schema.string().default('0 1 * * *')
        .description(`定时任务表达式<br/>
          具体语法可以参考 [GNU Crontab](https://www.gnu.org/software/mcron/manual/html_node/Crontab-file.html)`),
    }),
    Schema.object({}),
  ]),
]) as Schema<Group.Config>
