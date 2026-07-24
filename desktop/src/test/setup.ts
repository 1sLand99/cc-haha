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
