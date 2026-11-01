/** Loose version comparison good enough for maven/minecraft/loader versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-_+]/)
  const pb = b.split(/[.\-_+]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    if (x === y) continue
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : NaN
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : NaN
    if (!isNaN(nx) && !isNaN(ny)) return nx - ny
    if (x === '') return -1
    if (y === '') return 1
    return x < y ? -1 : 1
  }
  return 0
}
