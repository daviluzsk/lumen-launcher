import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, type LucideIcon, Search, X } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Instance } from '@shared/types'
import { cx } from '../lib/format'
import { builtinFor } from '../lib/icons'

export const spring = { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 } as const
export const softSpring = { type: 'spring', stiffness: 300, damping: 30 } as const

// ---------- Segmented control with a sliding glass thumb ----------

export interface SegOption<T extends string> {
  value: T
  label?: string
  icon?: LucideIcon
  tip?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'lg'
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth })
  }, [])

  useLayoutEffect(measure, [value, options.length, measure])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div className={cx('segmented', size)} ref={ref} role="tablist">
      {thumb && <motion.div className="thumb" initial={false} animate={{ x: thumb.x - 3, width: thumb.w }} transition={spring} style={{ left: 3 }} />}
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)} data-tip={o.tip}>
          {o.icon && <o.icon />}
          {o.label && <span className="lbl">{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------- Switch ----------

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      style={disabled ? { opacity: 0.4 } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="knob" />
    </button>
  )
}

// ---------- Slider ----------

export function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }): React.JSX.Element {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

// ---------- Search ----------

export function SearchField({ value, onChange, placeholder = 'Buscar', width = 220, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number; autoFocus?: boolean }): React.JSX.Element {
  return (
    <div className="search" style={{ width }}>
      <Search />
      <input className="field" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onChange('')} />
      {value && (
        <button className="clear" onClick={() => onChange('')}>
          <X />
        </button>
      )}
    </div>
  )
}

// ---------- Popover / Menu ----------

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onClick?: () => void
  danger?: boolean
  checked?: boolean
  disabled?: boolean
}

export type MenuEntry = MenuItem | 'sep' | { section: string }

export function Popover({ anchor, onClose, children, align = 'left', width }: { anchor: DOMRect | { x: number; y: number }; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; width?: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const isRect = 'width' in anchor
    let left = isRect ? (align === 'right' ? anchor.right - r.width : anchor.left) : anchor.x
    let top = isRect ? anchor.bottom + 6 : anchor.y
    left = Math.min(Math.max(8, left), window.innerWidth - r.width - 8)
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, (isRect ? anchor.top - 6 : anchor.y) - r.height)
    setPos({ left, top })
  }, [anchor, align])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <motion.div
      ref={ref}
      className="popover glass"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>,
    document.body
  )
}

export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  return (
    <>
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" />
        if ('section' in it) return <div key={i} className="menu-label">{it.section}</div>
        return (
          <button
            key={i}
            className={cx('menu-item', it.danger && 'danger')}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.4 } : undefined}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            {it.icon && <it.icon />}
            <span className="truncate">{it.label}</span>
            {it.checked && <Check className="check" />}
          </button>
        )
      })}
    </>
  )
}

/** Hook that turns any element into a menu trigger (click) or context-menu target. */
export function useMenu(): {
  open: (e: React.MouseEvent, items: MenuEntry[], align?: 'left' | 'right') => void
  element: React.JSX.Element | null
} {
  const [state, setState] = useState<{ anchor: DOMRect | { x: number; y: number }; items: MenuEntry[]; align: 'left' | 'right' } | null>(null)
  const close = useCallback(() => setState(null), [])
  const open = useCallback((e: React.MouseEvent, items: MenuEntry[], align: 'left' | 'right' = 'left') => {
    e.preventDefault()
    e.stopPropagation()
    const anchor = e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setState({ anchor, items, align })
  }, [])
  return {
    open,
    element: state ? (
      <Popover anchor={state.anchor} onClose={close} align={state.align}>
        <MenuList items={state.items} onClose={close} />
      </Popover>
    ) : null
  }
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Selecionar',
  width,
  disabled
}: {
  value: T | null
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  placeholder?: string
  width?: number
  disabled?: boolean
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button className="select-btn" style={{ width, opacity: disabled ? 0.5 : 1 }} disabled={disabled} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}>
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={Math.max(width ?? 0, anchor.width)}>
          {options.map((o) => (
            <button
              key={o.value}
              className="menu-item"
              data-active={o.value === value}
              onClick={() => {
                onChange(o.value)
                setAnchor(null)
              }}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="tertiary" style={{ marginLeft: 'auto', fontSize: 11 }}>{o.hint}</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}

// ---------- Sheet ----------

/** Lets the sheet host keep a closing sheet mounted long enough to play its exit animation. */
export const SheetOpen = createContext(true)

export function Sheet({ open: openProp, onClose, children, width, className }: { open?: boolean; onClose: () => void; children: ReactNode; width?: number; className?: string }): React.JSX.Element {
  const ctxOpen = useContext(SheetOpen)
  const open = openProp ?? ctxOpen
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={cx('sheet glass lens panel', className)}
            style={{ width: width ? `min(${width}px, 100%)` : undefined }}
            initial={{ opacity: 0, y: 40, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={softSpring}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

// ---------- Icons ----------

export function InstanceIcon({ inst, size = 64 }: { inst: Pick<Instance, 'iconKey' | 'iconUrl'>; size?: number }): React.JSX.Element {
  if (inst.iconUrl) {
    return (
      <div className="app-icon" style={{ width: size, height: size }}>
        <img src={inst.iconUrl} alt="" className={size > 40 ? undefined : 'pixel'} draggable={false} />
      </div>
    )
  }
  const b = builtinFor(inst.iconKey)
  return (
    <div className="app-icon" style={{ width: size, height: size, background: `linear-gradient(150deg, ${b.from}, ${b.to})` }}>
      <b.Icon />
    </div>
  )
}

export function GlyphTile({ icon: Icon, from, to, size = 30, radius }: { icon: LucideIcon; from: string; to: string; size?: number; radius?: number }): React.JSX.Element {
  return (
    <div className="row-icon" style={{ width: size, height: size, borderRadius: radius ?? size * 0.27, background: `linear-gradient(150deg, ${from}, ${to})` }}>
      <Icon />
    </div>
  )
}

/** Minecraft face from a skin texture (8×8 face + hat overlay), drawn with CSS only. */
export function SkinHead({ url, size = 32, name }: { url: string | null; size?: number; name?: string }): React.JSX.Element {
  if (!url) {
    const hue = [...(name ?? 'Steve')].reduce((h, c) => h + c.charCodeAt(0), 0) % 360
    return (
      <div className="skin-head" style={{ width: size, height: size, display: 'grid', placeItems: 'center', background: `linear-gradient(150deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 65% 42%))`, color: '#fff', fontWeight: 750, fontSize: size * 0.44 }}>
        {(name ?? '?').slice(0, 1).toUpperCase()}
      </div>
    )
  }
  const scale = size / 8
  const layer = (x: number): React.CSSProperties => ({
    backgroundImage: `url(${url})`,
    backgroundSize: `${64 * scale}px auto`,
    backgroundPosition: `${-x * scale}px ${-8 * scale}px`
  })
  return (
    <div className="skin-head" style={{ width: size, height: size }}>
      <div style={layer(8)} />
      <div style={layer(40)} />
    </div>
  )
}

export function ProgressRing({ value, size = 22, stroke = 3, color = 'var(--accent)' }: { value: number | null; size?: number; stroke?: number; color?: string }): React.JSX.Element {
  if (value === null) return <div className="spinner" style={{ width: size, height: size, color }} />
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} />
    </svg>
  )
}

export function Empty({ icon: Icon, title, body, action, tint = 'var(--accent)' }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode; tint?: string }): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon glass" style={{ color: tint, ['--r' as string]: '22px' }}>
        <Icon />
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  )
}

export function FormRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="group-row">
      <div className="label">
        <div>{label}</div>
        {hint && <div className="caption">{hint}</div>}
      </div>
      {children}
    </div>
  )
}
