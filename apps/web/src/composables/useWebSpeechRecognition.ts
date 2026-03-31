import { onUnmounted, reactive, ref, shallowRef } from 'vue'

type RecInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onend: (() => void) | null
}

/** 浏览器语音识别（Web Speech API），中文优先 */
export function useWebSpeechRecognition() {
  const supported = ref(false)
  const listening = ref(false)
  const interim = ref('')
  const error = ref<string | null>(null)

  const RecClass = shallowRef<{ new (): RecInstance } | null>(null)
  let rec: RecInstance | null = null

  if (typeof window !== 'undefined') {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (typeof Ctor === 'function') {
      RecClass.value = Ctor as { new (): RecInstance }
      supported.value = true
    }
  }

  function stop() {
    try {
      rec?.stop()
    } catch {
      /* ignore */
    }
    rec = null
    listening.value = false
  }

  function start(onFinal: (text: string) => void) {
    error.value = null
    interim.value = ''
    if (!RecClass.value) {
      error.value = '当前浏览器不支持语音识别'
      return
    }
    stop()
    const r = new RecClass.value()
    rec = r
    r.lang = 'zh-CN'
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1

    r.onresult = (ev: any) => {
      let interimPiece = ''
      let finalPiece = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) finalPiece += t
        else interimPiece += t
      }
      interim.value = interimPiece.trim()
      if (finalPiece.trim()) onFinal(finalPiece.trim())
    }

    r.onerror = (ev: any) => {
      if (ev.error === 'aborted' || ev.error === 'no-speech') return
      error.value = ev.message || ev.error || '语音识别出错'
      listening.value = false
    }

    r.onend = () => {
      listening.value = false
      interim.value = ''
    }

    try {
      r.start()
      listening.value = true
    } catch (e: any) {
      error.value = e?.message || '无法启动麦克风'
      listening.value = false
    }
  }

  function toggle(onFinal: (text: string) => void) {
    if (listening.value) stop()
    else start(onFinal)
  }

  onUnmounted(() => stop())

  return reactive({ supported, listening, interim, error, start, stop, toggle })
}
