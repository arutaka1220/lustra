export const common = {
  app: { name: 'Lustra' },
  frames: {
    none: 'None', black: 'Black', white: 'White', blur: 'Blur',
    softBlack: 'Soft Black', softWhite: 'Soft White',
    ambientGradient: 'Ambient Gradient', edgeStretch: 'Edge Stretch', custom: 'Custom',
  },
  formats: { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' },
  metadata: { exif: 'EXIF', xmp: 'XMP', iso: 'ISO', gps: 'GPS', icc: 'ICC' },
  color: { hex: 'HEX', rgb: 'RGB' },
  fonts: {
    inter: 'Inter', notoSansJP: 'Noto Sans JP', genInterfaceJP: 'Gen Interface JP',
  },
  languages: { english: 'English', japanese: '日本語' },
} as const
