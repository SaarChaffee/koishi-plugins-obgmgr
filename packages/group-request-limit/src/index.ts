import { Context, Schema } from 'koishi'

import * as Command from './command'
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
    GMRFuck: string
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
      reason: { type: 'text' },
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

  ctx.plugin(Command, config)
}

export const Config: Schema<Group.Config> = Schema.intersect([
  Schema.object({
    groups: Schema.array(Schema.string()).description('群组生效白名单'),
    list: Schema.array(Schema.string()).description('黑名单列表'),
    useCron: Schema.boolean().default(false)
      .description('是否启用定时扫描黑名单列表清除漏网之鱼<br/>需要 cron 服务'),
    fuck: Schema.boolean().default(false).description('是否禁止短时间内进群退群'),
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
  Schema.union([
    Schema.object({
      fuck: Schema.const(true).required(),
      fuckDuration: Schema.natural().role('m').description('时长 (分钟)').default(30),
      fuckReason: Schema.string().description('原因').default('日群'),
    }),
    Schema.object({}),
  ]),
]) as Schema<Group.Config>
