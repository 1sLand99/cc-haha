const installElementMethod = (name: string) => {
  if (typeof Element === 'undefined') return
  if (name in Element.prototype) return
  Object.defineProperty(Element.prototype, name, {
    configurable: true,
    writable: true,
    value: () => {},
  })
}

installElementMethod('scrollIntoView')
installElementMethod('hasPointerCapture')
installElementMethod('setPointerCapture')
installElementMethod('releasePointerCapture')

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: function matchMedia(query: string): MediaQueryList {
      const listeners = new Set<(event: MediaQueryListEvent) => void>()
      let matches = false

      const mediaQueryList: MediaQueryList = {
        get matches() {
          return matches
        },
        media: query,
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'change') {
            listeners.add(listener as (event: MediaQueryListEvent) => void)
          }
        },
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'change') {
            listeners.delete(listener as (event: MediaQueryListEvent) => void)
          }
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener)
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener)
        },
        dispatchEvent: (event: Event) => {
          const changeEvent = event as MediaQueryListEvent
          matches = changeEvent.matches
          listeners.forEach((listener) => listener(changeEvent))
          return true
        },
        onchange: null,
      }

      return mediaQueryList
    },
  })
}
