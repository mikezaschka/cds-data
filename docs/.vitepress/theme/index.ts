import DefaultTheme from 'vitepress/theme'
import ArchitectureDiagram from './components/ArchitectureDiagram.vue'
import PackageOverview from './components/PackageOverview.vue'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchitectureDiagram', ArchitectureDiagram)
    app.component('PackageOverview', PackageOverview)
  },
} satisfies Theme
