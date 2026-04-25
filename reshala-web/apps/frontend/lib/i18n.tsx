'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Lang = 'ru' | 'en'

const ru = {
  // Navigation
  'nav.analytics': 'Аналитика',
  'nav.alerts': 'Алерты',
  'nav.bulkOps': 'Массовые ops',
  'nav.import': 'Импорт',
  'nav.logout': 'Выйти',

  // Fleet
  'fleet.title': 'Reshala Web',
  'fleet.search': 'Поиск серверов…',
  'fleet.addServer': '+ Добавить сервер',
  'fleet.online': 'онлайн',

  // Add server modal
  'add.title': 'Добавить сервер',
  'add.name': 'Имя',
  'add.ip': 'IP',
  'add.user': 'Пользователь',
  'add.port': 'Порт',
  'add.password': 'Root пароль',
  'add.submit': 'Добавить и развернуть ключ',
  'add.submitting': 'Добавление…',
  'add.cancel': 'Отмена',
  'add.success': 'Сервер успешно добавлен',

  // Server page
  'server.back': '← Флот',
  'server.cpu': 'CPU',
  'server.ram': 'RAM',
  'server.disk': 'Диск',
  'server.uptime': 'Аптайм',
  'server.speedDown': 'Speedtest ↓',
  'server.speedUp': 'Speedtest ↑',
  'server.metrics': 'Метрики (последние 30 мин)',
  'server.plugins': 'Плагины',
  'server.quickActions': 'Быстрые действия',
  'server.terminal': 'SSH Терминал',
  'server.docker': 'Docker',
  'server.security': 'Безопасность',
  'server.remnawave': 'Remnawave',
  'server.setupNode': 'Настроить ноду',
  'server.provision': 'Развернуть SSH ключ',
  'server.provisioning': 'Разворачивание…',
  'server.connectionInfo': 'Информация о подключении',
  'server.edit': 'Редактировать',

  // Edit modal
  'edit.title': 'Редактировать',
  'edit.ip': 'IP адрес',
  'edit.user': 'Пользователь',
  'edit.port': 'Порт',
  'edit.password': 'Пароль (для provision)',
  'edit.passwordHint': 'оставь пустым чтобы не менять',
  'edit.save': 'Сохранить',
  'edit.saving': 'Сохранение…',
  'edit.cancel': 'Отмена',
  'edit.saved': 'Сохранено',

  // Analytics
  'analytics.title': 'Аналитика флота',
  'analytics.updated': 'обновлено',
  'analytics.refresh': 'Обновить',
  'analytics.refreshing': 'Обновление…',
  'analytics.noData': 'Данные аналитики недоступны.',
  'analytics.total': 'Всего серверов',
  'analytics.avgCpu': 'Средний CPU',
  'analytics.avgRam': 'Средний RAM',
  'analytics.avgDisk': 'Средний Disk',
  'analytics.cpuCrit': 'CPU > 90%',
  'analytics.diskCrit': 'Disk > 90%',
  'analytics.needAttention': 'требуют внимания',
  'analytics.almostFull': 'почти полные',
  'analytics.allGood': 'всё нормально',
  'analytics.withMetrics': 'с метриками',
  'analytics.topCpu': 'Топ CPU нагрузка',
  'analytics.topRam': 'Топ RAM использование',
  'analytics.topDisk': 'Топ Disk использование',

  // Alerts
  'alerts.title': 'Алерты',
  'alerts.runCheck': 'Запустить проверку',
  'alerts.checking': 'Проверка…',
  'alerts.saveConfig': 'Сохранить конфиг',
  'alerts.saving': 'Сохранение…',
  'alerts.status': 'Статус',
  'alerts.enableAuto': 'Включить автоматические алерты',
  'alerts.checkEvery': 'Проверка каждые',
  'alerts.cooldown': 'мин, кулдаун',
  'alerts.min': 'мин на алерт',
  'alerts.thresholds': 'Пороги',
  'alerts.cpuAt': 'CPU алерт при (%)',
  'alerts.ramAt': 'RAM алерт при (%)',
  'alerts.diskAt': 'Disk алерт при (%)',
  'alerts.interval': 'Интервал проверки (минуты)',
  'alerts.cooldownMin': 'Кулдаун на алерт (минуты)',
  'alerts.offlineCheck': 'Алерт когда сервер офлайн (нет метрик)',
  'alerts.telegram': 'Telegram уведомления',
  'alerts.botToken': 'Bot Token',
  'alerts.chatId': 'Chat ID',
  'alerts.sendTest': 'Отправить тест',
  'alerts.sending': 'Отправка…',
  'alerts.telegramHint': 'Создай бота через @BotFather, добавь в группу/канал, узнай Chat ID через @userinfobot.',
  'alerts.history': 'История алертов',
  'alerts.historyCount': 'История алертов',
  'alerts.clear': 'Очистить',
  'alerts.noHistory': 'Алертов ещё не было.',
  'alerts.offline': 'офлайн',
  'alerts.checkDone': 'Проверка завершена',
  'alerts.serversChecked': 'серверов',
  'alerts.alertsFired': 'алертов',

  // Login
  'login.title': 'Reshala Web',
  'login.subtitle': 'Введите пароль администратора',
  'login.placeholder': 'Пароль',
  'login.submit': 'Войти',
  'login.submitting': 'Вход…',
  'login.error': 'Неверный пароль',

  // Common
  'common.saved': 'Сохранено',
  'common.error': 'Ошибка',
  'common.cancel': 'Отмена',
  'common.back': '← Назад',
}

const en: typeof ru = {
  'nav.analytics': 'Analytics',
  'nav.alerts': 'Alerts',
  'nav.bulkOps': 'Bulk Ops',
  'nav.import': 'Import',
  'nav.logout': 'Logout',

  'fleet.title': 'Reshala Web',
  'fleet.search': 'Search servers…',
  'fleet.addServer': '+ Add Server',
  'fleet.online': 'online',

  'add.title': 'Add Server',
  'add.name': 'Name',
  'add.ip': 'IP',
  'add.user': 'User',
  'add.port': 'Port',
  'add.password': 'Root Password',
  'add.submit': 'Add & Deploy Key',
  'add.submitting': 'Adding…',
  'add.cancel': 'Cancel',
  'add.success': 'Server added successfully',

  'server.back': '← Fleet',
  'server.cpu': 'CPU',
  'server.ram': 'RAM',
  'server.disk': 'Disk',
  'server.uptime': 'Uptime',
  'server.speedDown': 'Speedtest ↓',
  'server.speedUp': 'Speedtest ↑',
  'server.metrics': 'Metrics (last 30 min)',
  'server.plugins': 'Plugins',
  'server.quickActions': 'Quick actions',
  'server.terminal': 'SSH Terminal',
  'server.docker': 'Docker',
  'server.security': 'Security',
  'server.remnawave': 'Remnawave',
  'server.setupNode': 'Setup Node',
  'server.provision': 'Provision SSH Key',
  'server.provisioning': 'Provisioning…',
  'server.connectionInfo': 'Connection info',
  'server.edit': 'Edit',

  'edit.title': 'Edit',
  'edit.ip': 'IP Address',
  'edit.user': 'User',
  'edit.port': 'Port',
  'edit.password': 'Password (for provision)',
  'edit.passwordHint': 'leave empty to keep unchanged',
  'edit.save': 'Save',
  'edit.saving': 'Saving…',
  'edit.cancel': 'Cancel',
  'edit.saved': 'Saved',

  'analytics.title': 'Fleet Analytics',
  'analytics.updated': 'updated',
  'analytics.refresh': 'Refresh',
  'analytics.refreshing': 'Refreshing…',
  'analytics.noData': 'No analytics data available.',
  'analytics.total': 'Total servers',
  'analytics.avgCpu': 'Avg CPU',
  'analytics.avgRam': 'Avg RAM',
  'analytics.avgDisk': 'Avg Disk',
  'analytics.cpuCrit': 'CPU > 90%',
  'analytics.diskCrit': 'Disk > 90%',
  'analytics.needAttention': 'need attention',
  'analytics.almostFull': 'almost full',
  'analytics.allGood': 'all good',
  'analytics.withMetrics': 'with metrics',
  'analytics.topCpu': 'Top CPU Load',
  'analytics.topRam': 'Top RAM Usage',
  'analytics.topDisk': 'Top Disk Usage',

  'alerts.title': 'Alerts',
  'alerts.runCheck': 'Run Check Now',
  'alerts.checking': 'Checking…',
  'alerts.saveConfig': 'Save Config',
  'alerts.saving': 'Saving…',
  'alerts.status': 'Status',
  'alerts.enableAuto': 'Enable automatic alerts',
  'alerts.checkEvery': 'Checks every',
  'alerts.cooldown': 'min, cooldown',
  'alerts.min': 'min per alert',
  'alerts.thresholds': 'Thresholds',
  'alerts.cpuAt': 'CPU alert at (%)',
  'alerts.ramAt': 'RAM alert at (%)',
  'alerts.diskAt': 'Disk alert at (%)',
  'alerts.interval': 'Check interval (minutes)',
  'alerts.cooldownMin': 'Cooldown per alert (minutes)',
  'alerts.offlineCheck': 'Alert when server appears offline (no metrics)',
  'alerts.telegram': 'Telegram Notifications',
  'alerts.botToken': 'Bot Token',
  'alerts.chatId': 'Chat ID',
  'alerts.sendTest': 'Send Test Notification',
  'alerts.sending': 'Sending…',
  'alerts.telegramHint': 'Create a bot via @BotFather, add it to your group/channel, get the Chat ID via @userinfobot.',
  'alerts.history': 'Alert History',
  'alerts.historyCount': 'Alert History',
  'alerts.clear': 'Clear',
  'alerts.noHistory': 'No alerts fired yet.',
  'alerts.offline': 'offline',
  'alerts.checkDone': 'Check done',
  'alerts.serversChecked': 'servers',
  'alerts.alertsFired': 'alerts fired',

  'login.title': 'Reshala Web',
  'login.subtitle': 'Enter admin password to continue',
  'login.placeholder': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.error': 'Invalid password',

  'common.saved': 'Saved',
  'common.error': 'Error',
  'common.cancel': 'Cancel',
  'common.back': '← Back',
}

const translations: Record<Lang, typeof ru> = { ru, en }

interface LangContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: keyof typeof ru) => string
}

const LangContext = createContext<LangContextValue>({
  lang: 'ru',
  setLang: () => {},
  t: (k) => k,
})

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru')

  useEffect(() => {
    const saved = localStorage.getItem('lang') as Lang | null
    if (saved === 'ru' || saved === 'en') setLangState(saved)
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('lang', l)
  }

  const t = (key: keyof typeof ru): string => translations[lang][key] ?? key

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>
}

export function useT() {
  return useContext(LangContext)
}

export function LangToggle() {
  const { lang, setLang } = useT()
  return (
    <button
      onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
      className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors font-mono"
      title="Switch language"
    >
      {lang === 'ru' ? 'EN' : 'RU'}
    </button>
  )
}
