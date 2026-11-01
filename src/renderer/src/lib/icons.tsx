import {
  Anchor,
  Atom,
  Axe,
  Bird,
  Bomb,
  Bone,
  Box,
  Castle,
  Cherry,
  Clover,
  Compass,
  Crown,
  Diamond,
  Dices,
  Feather,
  Fish,
  FlaskConical,
  Flame,
  Flower2,
  Gamepad2,
  Gem,
  Ghost,
  Hammer,
  Heart,
  Leaf,
  type LucideIcon,
  Map,
  Moon,
  Mountain,
  Orbit,
  Package,
  Pickaxe,
  Rocket,
  Shield,
  Skull,
  Snowflake,
  Sprout,
  Star,
  Sun,
  Sword,
  Swords,
  Tent,
  TreePine,
  Turtle,
  WandSparkles,
  Wheat,
  Zap
} from 'lucide-react'

export interface BuiltinIcon {
  key: string
  Icon: LucideIcon
  from: string
  to: string
}

const I = (key: string, Icon: LucideIcon, from: string, to: string): BuiltinIcon => ({ key: `glass:${key}`, Icon, from, to })

export const BUILTIN_ICONS: BuiltinIcon[] = [
  I('grass', Sprout, '#7ee26b', '#2f8f3a'),
  I('pickaxe', Pickaxe, '#8fd3ff', '#2f6fd6'),
  I('sword', Sword, '#ff9a8a', '#d93a4a'),
  I('swords', Swords, '#ffcf6b', '#e0702a'),
  I('gem', Gem, '#7ff3e6', '#1aa6a0'),
  I('diamond', Diamond, '#a6f0ff', '#3aa8e8'),
  I('flame', Flame, '#ffb347', '#ff3d2e'),
  I('box', Package, '#e8c08a', '#a8692e'),
  I('castle', Castle, '#c2b8ff', '#5e4ad6'),
  I('tree', TreePine, '#9be38a', '#1f7a4a'),
  I('mountain', Mountain, '#b6c8e8', '#4a5f8a'),
  I('zap', Zap, '#fff27a', '#f0a800'),
  I('heart', Heart, '#ff9ec4', '#ef3a7a'),
  I('star', Star, '#ffe17a', '#f08a1a'),
  I('rocket', Rocket, '#b7a6ff', '#6a3dff'),
  I('skull', Skull, '#d8d8e0', '#5a5a6a'),
  I('shield', Shield, '#8fb8ff', '#2a4fb0'),
  I('wand', WandSparkles, '#f0a6ff', '#9a2ad6'),
  I('leaf', Leaf, '#c8f27a', '#5aa82a'),
  I('snow', Snowflake, '#d6f3ff', '#5ab0e8'),
  I('moon', Moon, '#9aa6ff', '#2a2f7a'),
  I('sun', Sun, '#ffe27a', '#ff8a1a'),
  I('ghost', Ghost, '#e6e0ff', '#7a6ab0'),
  I('fish', Fish, '#7ad8ff', '#1a6ad6'),
  I('bird', Bird, '#ffd08a', '#e06a2a'),
  I('compass', Compass, '#ffd6a6', '#b0602a'),
  I('map', Map, '#e6d6a6', '#8a7a3a'),
  I('crown', Crown, '#ffe88a', '#d6a01a'),
  I('axe', Axe, '#d6b48a', '#7a4a2a'),
  I('flask', FlaskConical, '#c6a6ff', '#e03aa8'),
  I('gamepad', Gamepad2, '#8af0c8', '#2a8ad6'),
  I('bone', Bone, '#f2ecdf', '#a89e88'),
  I('anchor', Anchor, '#8ac8ff', '#1a3a7a'),
  I('turtle', Turtle, '#a8f08a', '#2a8a5a'),
  I('wheat', Wheat, '#ffe0a0', '#d0901a'),
  I('cherry', Cherry, '#ffb0c8', '#d02a4a'),
  I('hammer', Hammer, '#c8d0e0', '#5a6a8a'),
  I('tent', Tent, '#ffc89a', '#d65a2a'),
  I('bomb', Bomb, '#ff8a7a', '#5a1a2a'),
  I('orbit', Orbit, '#b0a0ff', '#1a1a5a'),
  I('atom', Atom, '#8af6ff', '#5a2ad6'),
  I('dice', Dices, '#ffffff', '#9aa0b8'),
  I('feather', Feather, '#e6f2ff', '#8aa6d6'),
  I('flower', Flower2, '#ffb6f0', '#c83ad6'),
  I('clover', Clover, '#b6ff9a', '#2aa84a'),
  I('cube', Box, '#a6e6ff', '#6a5aff')
]

// Prism Launcher's built-in icon keys, mapped to the closest glass icon.
const PRISM_KEYS: Record<string, string> = {
  default: 'glass:grass',
  grass: 'glass:grass',
  dirt: 'glass:grass',
  planks: 'glass:box',
  brick: 'glass:castle',
  stone: 'glass:mountain',
  diamond: 'glass:diamond',
  gold: 'glass:crown',
  iron: 'glass:pickaxe',
  flame: 'glass:flame',
  netherstar: 'glass:star',
  creeper: 'glass:bomb',
  squarecreeper: 'glass:bomb',
  tnt: 'glass:bomb',
  skeleton: 'glass:skull',
  herobrine: 'glass:ghost',
  enderman: 'glass:moon',
  enderpearl: 'glass:orbit',
  chicken: 'glass:bird',
  meat: 'glass:wheat',
  steve: 'glass:gamepad',
  infinity: 'glass:atom',
  magitech: 'glass:wand',
  ftb_logo: 'glass:cube',
  ftb_glow: 'glass:cube',
  bee: 'glass:flower',
  fox: 'glass:feather',
  modrinth: 'glass:gem'
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function builtinFor(key: string): BuiltinIcon {
  const k = PRISM_KEYS[key] ?? key
  return BUILTIN_ICONS.find((i) => i.key === k) ?? BUILTIN_ICONS[hash(key) % BUILTIN_ICONS.length]
}
