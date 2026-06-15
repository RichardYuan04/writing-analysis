// 主题：色系（family）× 明暗（mode）两维
// 色系名两字；昼/夜各一个四字名。swatch 用于设置页色卡预览。
export const FAMILIES = [
  {
    key: 'desk', name: '书桌',
    day: '明窗书案', night: '深夜书桌',
    swatch: { dark: ['#17110b', '#e89b50', '#f3c781'], light: ['#f4ebdd', '#c87a2e', '#b07d28'] },
  },
  {
    key: 'ocean', name: '海洋',
    day: '晴海白昼', night: '深海夜晚',
    swatch: { dark: ['#0a1622', '#3fa9d4', '#7fd6e8'], light: ['#eaf4fa', '#1f87b8', '#2a9fc8'] },
  },
  {
    key: 'summer', name: '盛夏',
    day: '正午苍翠', night: '夏夜林深',
    swatch: { dark: ['#0c1710', '#5fae5a', '#9fd07a'], light: ['#eef5e8', '#3f8a3a', '#5aa84a'] },
  },
  {
    key: 'sakura', name: '樱花',
    day: '粉樱晴日', night: '夜樱绯紫',
    swatch: { dark: ['#1a121a', '#e487ad', '#f6b8d2'], light: ['#fbeef3', '#d96a9a', '#e487ad'] },
  },
]

export const DEFAULT_FAMILY = 'desk'
export const DEFAULT_MODE = 'dark'

export const familyOf = (key) => FAMILIES.find((f) => f.key === key) || FAMILIES[0]
// 当前色系在某明暗下的四字名
export const themeName = (familyKey, mode) => {
  const f = familyOf(familyKey)
  return mode === 'light' ? f.day : f.night
}
