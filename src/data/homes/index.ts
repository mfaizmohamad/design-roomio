// Registry of multi-storey homes. Add a home = add its file + one line here.
import type { MultiLevelHome } from './types'
import { SKY_DUPLEX } from './skyDuplex'
import { CANARY_ELYSIUM } from './canaryElysium'
import { EMBERCREST } from './embercrest'
import { PANDAUL } from './pandaul'

export type { MultiLevelHome, HomeLevelSpec } from './types'

export const HOMES: MultiLevelHome[] = [SKY_DUPLEX, CANARY_ELYSIUM, EMBERCREST, PANDAUL]

export const HOME_MAP: Record<string, MultiLevelHome> = Object.fromEntries(HOMES.map((h) => [h.id, h]))
