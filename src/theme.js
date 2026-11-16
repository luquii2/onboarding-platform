export const DEFAULT_THEME = Object.freeze({ primaryColor: '#4F46E5', textColor: '#0F172A', backgroundColor: '#FFFFFF', fontFamily: 'Inter', borderRadius: 8, defaultPlacement: 'bottom', cardStyle: 'light', showProgress: true, showSkip: true })

export function normalizeTheme(value) {
  const theme = { ...DEFAULT_THEME }
  for (const key of ['primaryColor', 'textColor', 'backgroundColor']) if (/^#[0-9a-f]{6}$/i.test(value?.[key])) theme[key] = value[key]
  if (typeof value?.fontFamily === 'string' && value.fontFamily.length <= 100 && /^[\p{L}\p{N} ,"'_-]+$/u.test(value.fontFamily)) theme.fontFamily = value.fontFamily
  if (Number.isInteger(value?.borderRadius) && value.borderRadius >= 0 && value.borderRadius <= 32) theme.borderRadius = value.borderRadius
  if (['top', 'bottom', 'left', 'right'].includes(value?.defaultPlacement)) theme.defaultPlacement = value.defaultPlacement
  if (['light', 'colored'].includes(value?.cardStyle)) theme.cardStyle = value.cardStyle
  for (const key of ['showProgress', 'showSkip']) if (typeof value?.[key] === 'boolean') theme[key] = value[key]
  return theme
}
