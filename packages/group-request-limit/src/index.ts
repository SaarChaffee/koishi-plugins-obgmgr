import { Context, Schema } from 'koishi'

export const name = 'group-request-limit'

export interface Config {
  list: string[]
  groups: string[]
}

export const Config: Schema<Config> = Schema.object({
  groups: Schema.array(Schema.string()).description('群组生效白名单'),
  list: Schema.array(Schema.string()).description('黑名单列表'),
})

export function apply(ctx: Context, config: Config) {
  if (config.list.length > 0 && config.list.length > 0) {
    ctx.guild(...config.groups).on('guild-member-request', async (meta) => {
      if (process.env.NODE_ENV === 'development') {
        ctx.logger.info(meta)
      }
      if (config.list.includes(meta.userId)) {
        await meta.bot.handleGuildMemberRequest(meta.messageId, false, '黑名单自动拒绝。')
      }
    })
  }
}
