export interface Wallpaper {
  id: string
  name: string
  base: string
  blobs: [string, string, string, string]
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'sequoia', name: 'Sequoia', base: '#0b0f2e', blobs: ['#4a33ff', '#ff4fa3', '#ff9a3c', '#1fb6ff'] },
  { id: 'prisma', name: 'Lumen', base: '#0d0b1a', blobs: ['#ff3d81', '#ffb000', '#00d6a0', '#4d6bff'] },
  { id: 'aurora', name: 'Aurora', base: '#03141a', blobs: ['#00c98f', '#1b5dff', '#8a2bff', '#00e6c3'] },
  { id: 'sunset', name: 'Pôr do sol', base: '#24091a', blobs: ['#ff6a3d', '#ff2d75', '#ffbf47', '#7a2dff'] },
  { id: 'ocean', name: 'Oceano', base: '#02152a', blobs: ['#0067ff', '#00b8ff', '#2ee6c4', '#3a2dff'] },
  { id: 'meadow', name: 'Campina', base: '#0a1a0d', blobs: ['#3fae4a', '#a5d84a', '#1f7a4a', '#6fd0ff'] },
  { id: 'nether', name: 'Nether', base: '#170405', blobs: ['#ff3b1f', '#a3120c', '#ff8a00', '#6b0c3a'] },
  { id: 'end', name: 'The End', base: '#07050f', blobs: ['#6b2cff', '#c08bff', '#2b1550', '#d9cc6a'] },
  { id: 'lavender', name: 'Lavanda', base: '#cbc3f5', blobs: ['#a28cff', '#ffb3df', '#8fdcff', '#ffd2a0'] },
  { id: 'graphite', name: 'Grafite', base: '#111114', blobs: ['#3c3c4a', '#5b5b6e', '#24242c', '#4a4a5e'] }
]

export const ACCENTS: { id: string; color: string; name: string }[] = [
  { id: 'blue', color: '#0a84ff', name: 'Azul' },
  { id: 'indigo', color: '#5e5ce6', name: 'Índigo' },
  { id: 'purple', color: '#bf5af2', name: 'Roxo' },
  { id: 'pink', color: '#ff375f', name: 'Rosa' },
  { id: 'red', color: '#ff453a', name: 'Vermelho' },
  { id: 'orange', color: '#ff9f0a', name: 'Laranja' },
  { id: 'yellow', color: '#ffcc00', name: 'Amarelo' },
  { id: 'green', color: '#30d158', name: 'Verde' },
  { id: 'mint', color: '#63e6e2', name: 'Menta' },
  { id: 'graphite', color: '#98989d', name: 'Grafite' }
]

export function wallpaperPreview(w: Wallpaper): string {
  const [a, b, c, d] = w.blobs
  return [
    `radial-gradient(60% 70% at 10% 0%, ${a} 0%, transparent 70%)`,
    `radial-gradient(60% 70% at 100% 10%, ${b} 0%, transparent 70%)`,
    `radial-gradient(70% 70% at 30% 100%, ${c} 0%, transparent 70%)`,
    `radial-gradient(50% 60% at 90% 100%, ${d} 0%, transparent 70%)`,
    w.base
  ].join(', ')
}
