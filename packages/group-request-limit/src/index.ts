import { Argv, Context, Schema, Session, h } from 'koishi'

export const name = 'group-request-limit'

declare module 'koishi' {
  interface Tables {
    blacklist: Blacklist
  }
}

interface Blacklist {
  banned: string
  operator: string
  group: string
  kick: boolean
  time: Date
}

export async function apply(ctx: Context, config: Config) {
  ctx.model.extend(
    'blacklist',
    {
      banned: { type: 'string', length: 25, nullable: false },
      operator: { type: 'string', length: 25, nullable: false },
      group: { type: 'string', length: 25, nullable: false },
      kick: 'boolean',
      time: 'timestamp',
    },
    {
      primary: 'banned',
    },
  )

  ctx.inject(['datebase'], async (ctx) => {
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
  })

  ctx.command('ban <banned:text>')
    .option('kick', '-k')
    .option('permanent', '-p')
    .option('remove', '-r')
    .action(async (meta, ban) => {
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
              kick: options?.kick,
              time: new Date(),
            },
          )
          msg.push(`已添加「${_res.banned}」到黑名单。`)
        }
      }
      if (options?.kick) {
        await kick(session, banned, options?.permanent, msg)
      }
      return msg.join('\n')
    })

  ctx.command('kick <ban:text>')
    .option('permanent', '-p')
    .action(async (meta, ban) => {
      const handled = await handle(ctx, config, meta, ban)
      if (!handled) {
        return
      }
      const { session, options, banned } = handled
      const msg = []
      await kick(session, banned, options?.permanent, msg)
      return msg[0]
    })

  ctx.guild(...config.groups).on('guild-member-request', async (meta) => {
    if (process.env.NODE_ENV === 'development') {
      ctx.logger.info(meta)
    }
    const res = await ctx.model.get('blacklist', { banned: meta.userId })
    if (res.length > 0) {
      await meta.bot.handleGuildMemberRequest(meta.messageId, false, '黑名单自动拒绝。')
    }
  })
}

async function handle(ctx: Context, config: Config, meta: Argv, banned: string): Promise<
  false |
  { session: Session; options: { kick?: boolean; permanent?: boolean; remove?: boolean }; banned: string }
> {
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
  return { session, options, banned }
}

async function kick(session: Session, banned: string, permanent: boolean, msg: string[]) {
  try {
    await session.bot.getGuildMember(session.guildId, banned)
    await session.bot.kickGuildMember(session.guildId, banned, permanent)
    msg.push(`已将「${banned}」${permanent ? '永久' : ''}踢出群。`)
  } catch (error) {
    msg.push(`踢出失败。`)
  }
}

export interface Config {
  list: string[]
  groups: string[]
}

export const Config: Schema<Config> = Schema.object({
  groups: Schema.array(Schema.string()).description('群组生效白名单'),
  list: Schema.array(Schema.string()).description('黑名单列表'),
})
