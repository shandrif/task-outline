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
  trainers: { fx: "wave", icon: svg(<><circle cx="9" cy="8.5" r="3.3" /><path d="M3.6 19.5c.9-3.2 3.1-4.8 5.4-4.8s4.5 1.6 5.4 4.8" /><circle cx="17" cy="9.5" r="2.5" /><path d="M16 14.7c2.3-.2 4.1 1.1 4.8 3.8" /></>) },
  visits: { fx: "drop", icon: svg(<><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z" /><circle cx="12" cy="10" r="2.4" /></>) },
  onboarding: { fx: "pop", icon: svg(<><circle cx="10" cy="8.5" r="3.4" /><path d="M3.8 19.5c.9-3.4 3.3-5 6.2-5s5.3 1.6 6.2 5" /><path d="M18 7.5v6M15 10.5h6" /></>) },
  npd: { fx: "wave", icon: svg(<><path d="M9.5 4h5" /><path d="M10.5 4v5.3L5.7 17.6A2 2 0 0 0 7.4 20.6h9.2a2 2 0 0 0 1.7-3L13.5 9.3V4" /><path d="M8.5 15h7" /></>) },
  coaching: { fx: "glow", icon: svg(<><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h-.5A2.5 2.5 0 0 1 4 12.5" /><path d="M8.5 8.5h7M8.5 11.5h4.5" /></>) },
  growth: { fx: "pop", icon: svg(<><path d="M4 19h4.5v-4.5H13V10h4.5V5.5H20" /><path d="M4 19h16" /></>) },
  workshop: { fx: "wave", icon: svg(<><rect x="3.5" y="5" width="17" height="11" rx="2" /><path d="M8 20h8M12 16v4" /><path d="m7.5 12.5 3-3 2.5 2.5 3.5-4" /></>) },
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
