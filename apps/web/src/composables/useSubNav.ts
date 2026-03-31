import { computed } from 'vue'
import { useRoute } from 'vue-router'

/** 当前页内子区块导航：根据路由 hash 高亮，默认无 hash 时高亮带 defaultActive 的项 */
export function useSubNav() {
  const route = useRoute()
  const hash = computed(() => route.hash)

  function subNavClass(targetHash: string, defaultActive = false) {
    const h = hash.value
    const isOn = defaultActive ? !h || h === targetHash : h === targetHash
    return isOn
      ? 'pb-1 transition-all text-primary border-b-2 border-primary'
      : 'pb-1 transition-all text-slate-500 hover:text-primary'
  }

  return { subNavClass, hash }
}
