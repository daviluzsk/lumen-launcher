// Generates displacement maps for the "liquid glass" lens effect and the SVG filters
// that use them. Each map encodes, per pixel, how far to bend the backdrop: neutral
// (128,128) in the middle and a strong inward pull along a rounded-rect rim, which makes
// whatever is behind the control appear to refract around its edge. The three colour
// channels are displaced by slightly different amounts for a hint of dispersion.

import { Fragment, useMemo } from 'react'

function makeMap(w: number, h: number, radius: number, edge: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const hw = w / 2
  const hh = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw
      const py = y + 0.5 - hh
      const qx = Math.abs(px) - (hw - radius)
      const qy = Math.abs(py) - (hh - radius)
      // Signed distance to the rounded rectangle (negative inside).
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
      const inside = -sd
      let dx = 0
      let dy = 0
      if (inside >= 0 && inside < edge) {
        const t = 1 - inside / edge
        const strength = t * t * (3 - 2 * t)
        let nx: number
        let ny: number
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1
          nx = (Math.sign(px) * qx) / len
          ny = (Math.sign(py) * qy) / len
        } else if (qx > qy) {
          nx = Math.sign(px)
          ny = 0
        } else {
          nx = 0
          ny = Math.sign(py)
        }
        dx = -nx * strength
        dy = -ny * strength
      }
      const i = (y * w + x) * 4
      img.data[i] = 128 + dx * 127
      img.data[i + 1] = 128 + dy * 127
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

const CHANNELS = [
  { m: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', k: 1 },
  { m: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', k: 0.94 },
  { m: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', k: 0.88 }
]

function LensFilter({ id, map, scale }: { id: string; map: string; scale: number }): React.JSX.Element {
  return (
    <filter id={id} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
      <feImage href={map} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
      {CHANNELS.map((c, i) => (
        <Fragment key={i}>
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * c.k} xChannelSelector="R" yChannelSelector="G" result={`d${i}`} />
          <feColorMatrix in={`d${i}`} type="matrix" values={c.m} result={`c${i}`} />
        </Fragment>
      ))}
      <feBlend in="c0" in2="c1" mode="screen" result="rg" />
      <feBlend in="rg" in2="c2" mode="screen" />
    </filter>
  )
}

export function LensFilters(): React.JSX.Element {
  const maps = useMemo(
    () => ({
      pill: makeMap(320, 80, 40, 22),
      square: makeMap(160, 160, 40, 34),
      panel: makeMap(400, 260, 34, 26)
    }),
    []
  )
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <LensFilter id="lens-pill" map={maps.pill} scale={0.09} />
        <LensFilter id="lens-square" map={maps.square} scale={0.14} />
        <LensFilter id="lens-panel" map={maps.panel} scale={0.05} />
      </defs>
    </svg>
  )
}
