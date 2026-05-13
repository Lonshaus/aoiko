import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { seedIfEmpty } from './db'
import { getSetting, setSetting } from './lib/settings'
// 初回起動時に勘定科目をシードし、currentYear が未設定なら 2026 を入れる
await seedIfEmpty()
if ((await getSetting('currentYear')) === undefined) {
  await setSetting('currentYear', 2026)
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app