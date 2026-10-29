import * as React from "react"
import { createRoot } from "react-dom/client"
import { LiquidNavbar, type LiquidNavItem } from "@/components/ui/liquid-glass-navbar"

/* Entry for the plain-JS app: window.HMNav.mount(el, { items:[{label,key}], active, onChange }) */
const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const ICONS: Record<string, { icon: React.ReactNode; fx: LiquidNavItem["fx"] }> = {
  dashboard: { fx: "glow", icon: svg(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></>) },
  evaluations: { fx: "pop", icon: svg(<><rect x="5" y="4.5" width="14" height="16" rx="2.5" /><path d="M9 4.5h6V7H9z" /><path d="m8.8 13.2 2.2 2.2 4.2-4.4" /></>) },
  questions: { fx: "wave", icon: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.8" /><path d="M12 16.8v.1" /></>) },
  stores: { fx: "drop", icon: svg(<><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 12.5V20h13v-7.5" /><path d="M10 20v-4.5h4V20" /></>) },
  mine: { fx: "glow", icon: svg(<><rect x="5" y="4.5" width="14" height="16" rx="2.5" /><path d="M9 4.5h6V7H9z" /><path d="M8.5 12h7M8.5 15.5h4.5" /></>) },
  add: { fx: "spin", icon: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 8.2v7.6M8.2 12h7.6" /></>) },
}

type Opts = { items: { label: string; key: string }[]; active: number; onChange: (i: number) => void }

function mount(el: HTMLElement, opts: Opts) {
  const root = createRoot(el)
  let state = opts
  const render = () => {
    const items: LiquidNavItem[] = state.items.map((i) => ({ label: i.label, icon: ICONS[i.key]?.icon, fx: ICONS[i.key]?.fx ?? "pop" }))
    root.render(<LiquidNavbar items={items} active={state.active} onChange={(i) => state.onChange(i)} tone="light" />)
  }
  render()
  return {
    setActive(i: number) { if (i !== state.active) { state = { ...state, active: i }; render() } },
    setOptions(o: Opts) { state = o; render() },
  }
}

;(window as any).HMNav = { mount }
