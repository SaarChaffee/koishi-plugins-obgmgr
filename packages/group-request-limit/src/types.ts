import type { Session } from 'koishi'

export interface Blacklist {
  banned: string
  operator: string
  group: string
  reason: string
  kick: boolean
  time: Date
}

export interface Config {
  list: string[]
  groups: string[]
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
