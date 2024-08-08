import type { Context, Session, Element } from 'koishi'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'

export interface Blacklist {
  banned: string
  operator: string
  group: string
  kick: 0 | 1 | 2
  reason: string
  time: Date
}

export interface Config {
  list: string[]
  groups: string[]
  useCron: boolean
  cron?: string
}

export interface Handle {
  session: Session
  options: Options
  banned: string
}

export interface Options {
  kick?: boolean
  permanent?: boolean
  all?: boolean
  remove?: boolean
}

export interface Group {
  locales: string[]
  bot: Bot
  output: Msg[]
}

export type Msg = string | Element

export type Bot = OneBotBot<Context, OneBotBot.Config>
