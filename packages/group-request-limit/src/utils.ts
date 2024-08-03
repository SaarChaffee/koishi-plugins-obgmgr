import { Argv, Context, Session, h } from 'koishi'

import * as Group from './types'

export async function handle(
  ctx: Context,
  config: Group.Config,
  meta: Argv,
  banned: string,
): Promise<false | Group.Handle> {
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

export async function kick(
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
    msg.push(session.text('commands.kick.messages.self', { permanent, banned }))
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
        msg.push(session.text('commands.kick.messages.other', { permanent, banned, group }))
      } catch (error) {
        context.logger.warn(`Failed to kick ${banned} from ${group}`)
      }
    }
  }
}

function isNumeric(str: string): boolean {
  return !isNaN(parseFloat(str)) && isFinite(str as never)
}
