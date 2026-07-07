import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { sendDeliveredSMS } from './smsService'

const initialOrders = [
  {
    id: 'GBD-1048',
    customer: 'Maya Chen',
    phone: '(312) 555-0188',
    address: '1840 W Armitage Ave, Chicago, IL',
    driver: 'Andre Lewis',
    status: 'New',
    notes: 'Ring bell twice. Leave with front desk if unavailable.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
  },
  {
    id: 'GBD-1047',
    customer: 'Owen Patel',
    phone: '(773) 555-0142',
    address: '500 N Michigan Ave, Chicago, IL',
    driver: 'Sofia Rivera',
    status: 'Out for Delivery',
    notes: 'Customer requested a call on arrival.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
  },
  {
    id: 'GBD-1046',
    customer: 'Elena Brooks',
    phone: '(847) 555-0191',
    address: '222 Merchandise Mart Plaza, Chicago, IL',
    driver: 'Marcus Bell',
    status: 'Delivered',
    notes: 'Delivered to reception desk.',
    receiver: 'Janet Moore',
    failureReason: '',
    proofPhoto: '',
  },
  {
    id: 'GBD-1045',
    customer: 'Noah Williams',
    phone: '(708) 555-0165',
    address: '1452 N Wells St, Chicago, IL',
    driver: 'Priya Shah',
    status: 'Failed',
    notes: 'No answer. Gate code did not work.',
    receiver: '',
    failureReason: 'No answer at delivery address',
    proofPhoto: '',
  },
  {
    id: 'GBD-1044',
    customer: 'Ari Kim',
    phone: '(312) 555-0177',
    address: '909 W Randolph St, Chicago, IL',
    driver: 'Andre Lewis',
    status: 'Delivered',
    notes: 'Customer met driver outside.',
    receiver: 'Ari Kim',
    failureReason: '',
    proofPhoto: '',
  },
  {
    id: 'GBD-1043',
    customer: 'Camila Torres',
    phone: '(773) 555-0109',
    address: '320 S Canal St, Chicago, IL',
    driver: 'Sofia Rivera',
    status: 'New',
    notes: 'Fragile package. Keep upright.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
  },
]

const initialDrivers = [
  { name: 'Andre Lewis', pin: 'PIN ****', status: 'Active', route: 'North Loop' },
  { name: 'Sofia Rivera', pin: 'PIN ****', status: 'Active', route: 'Downtown' },
  { name: 'Marcus Bell', pin: 'PIN ****', status: 'Active', route: 'West Side' },
  { name: 'Priya Shah', pin: 'PIN ****', status: 'Inactive', route: 'On call' },
]

const navItems = [
  { id: 'orders', label: 'All Orders', mobile: 'Orders' },
  { id: 'add', label: 'Add Order', mobile: 'Add' },
  { id: 'quick', label: 'Quick Entry' },
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'drivers', label: 'Drivers', mobile: 'Drivers' },
  { id: 'history', label: 'History', mobile: 'History' },
  { id: 'settings', label: 'Settings' },
]

const statusOptions = ['All', 'New', 'Out for Delivery', 'Delivered', 'Failed']
const editableStatusOptions = statusOptions.filter((option) => option !== 'All')
const sortOptions = ['Newest First', 'Oldest First', 'Customer A-Z', 'Customer Z-A']
const dateFilterOptions = ['Today', 'Tomorrow', 'Future', 'All']

const defaultSettings = {
  companyName: 'Gingerbread Delivery',
  officePin: '7933',
  companyLogoName: '',
  archiveDeliveredAfterDays: 7,
  deleteArchivedAfterDays: 30,
}

const statusClass = {
  New: 'new',
  'Out for Delivery': 'out',
  Delivered: 'delivered',
  Failed: 'failed',
}

function getDriverName(driverValue) {
  if (typeof driverValue === 'string') return driverValue
  if (driverValue && typeof driverValue === 'object') return driverValue?.name || driverValue?.driver_name || ''
  return ''
}

const deliveryTimeZone = 'America/New_York'
const localDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: deliveryTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function padDatePart(value) {
  return String(value).padStart(2, '0')
}

function formatDateParts(year, month, day) {
  return year + '-' + padDatePart(month) + '-' + padDatePart(day)
}

function getLocalDateParts(date = new Date()) {
  const parts = localDateFormatter.formatToParts(date)
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  }
}

function getTodayDate() {
  const { year, month, day } = getLocalDateParts()
  return formatDateParts(year, month, day)
}

function getOffsetDate(days) {
  const { year, month, day } = getLocalDateParts()
  const offsetDate = new Date(Date.UTC(year, month - 1, day + days))
  return formatDateParts(offsetDate.getUTCFullYear(), offsetDate.getUTCMonth() + 1, offsetDate.getUTCDate())
}

function normalizeLocalDateString(value) {
  if (!value) return ''
  if (value instanceof Date) {
    const { year, month, day } = getLocalDateParts(value)
    return formatDateParts(year, month, day)
  }

  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  return match[1] + '-' + match[2] + '-' + match[3]
}

function getDeliveryDate(order) {
  return normalizeLocalDateString(order?.deliveryDate || order?.delivery_date) || getTodayDate()
}

function matchesDateFilter(order, filter) {
  const deliveryDate = getDeliveryDate(order)
  const today = getTodayDate()
  const tomorrow = getOffsetDate(1)
  if (filter === 'Today') return deliveryDate === today
  if (filter === 'Tomorrow') return deliveryDate === tomorrow
  if (filter === 'Future') return deliveryDate > tomorrow
  return true
}

function getDateGroupKey(order) {
  return getDeliveryDate(order)
}

function getDateGroupLabel(dateValue) {
  const normalizedDate = normalizeLocalDateString(dateValue)
  if (normalizedDate === getTodayDate()) return 'TODAY'
  if (normalizedDate === getOffsetDate(1)) return 'TOMORROW'

  const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return dateValue || 'UNSCHEDULED'

  const weekdayDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(weekdayDate).toUpperCase()
}

function getCompletedAt(order) {
  return order?.status === 'Delivered' ? order?.completedAt || order?.completed_at || new Date().toISOString() : null
}

function logSupabaseError(action, error) {
  console.error(action)
  console.error("Supabase error:", JSON.stringify(error, null, 2))
  console.error(error)
  console.error("error.message", error?.message)
  console.error("error.details", error?.details)
  console.error("error.hint", error?.hint)
  console.error("error.code", error?.code)
  console.error("error.status", error?.status)
}

function mapDeliveryFromRow(row = {}) {
  return {
    dbId: row.id,
    id: row.order_no || row.id || '',
    customer: row.customer_name || '',
    phone: row.phone || '',
    address: row.address || '',
    driver: getDriverName(row.driver),
    deliveryDate: normalizeLocalDateString(row.delivery_date) || '',
    status: row.status || 'New',
    notes: row.notes || '',
    receiver: row.receiver_name || '',
    failureReason: row.failed_reason || '',
    proofPhoto: row.proof_photo_url || '',
    completedAt: row.completed_at || '',
    archivedAt: row.archived_at || '',
  }
}

function mapDeliveryToRow(order = {}) {
  return {
    delivery_date: getDeliveryDate(order),
    order_no: order.id || order.order_no || '',
    customer_name: order.customer || order.customer_name || '',
    phone: order.phone || '',
    address: order.address || '',
    driver: getDriverName(order.driver),
    status: order.status || 'New',
    notes: order.notes || '',
    receiver_name: order.status === 'Delivered' ? order.receiver || '' : '',
    proof_photo_url: order.status === 'Delivered' ? order.proofPhoto || '' : '',
    failed_reason: order.status === 'Failed' ? order.failureReason || '' : '',
    completed_at: getCompletedAt(order),
    archived_at: order.archivedAt || order.archived_at || null,
  }
}

function mapDriverFromRow(row = {}) {
  return {
    dbId: row.id,
    name: row.name || '',
    pin: row.pin || '',
    status: row.active === false ? 'Inactive' : 'Active',
    active: row.active !== false,
    route: 'Available',
  }
}

function mapDriverToRow(driver = {}) {
  return {
    name: driver.name || '',
    pin: driver.pin || '',
    active: (driver.status || 'Active') === 'Active',
  }
}


function mapSettingsFromRow(row = {}) {
  return {
    id: row.id || null,
    companyName: row.company_name || defaultSettings.companyName,
    officePin: row.office_pin || defaultSettings.officePin,
    companyLogoName: row.logo_url || defaultSettings.companyLogoName,
    archiveDeliveredAfterDays: row.archive_after_days ?? defaultSettings.archiveDeliveredAfterDays,
    deleteArchivedAfterDays: row.delete_after_days ?? defaultSettings.deleteArchivedAfterDays,
  }
}

function mapSettingsToRow(settings) {
  return {
    id: settings.id || 1,
    company_name: settings.companyName || defaultSettings.companyName,
    office_pin: String(settings.officePin || defaultSettings.officePin),
    archive_after_days: Number(settings.archiveDeliveredAfterDays) || defaultSettings.archiveDeliveredAfterDays,
    delete_after_days: Number(settings.deleteArchivedAfterDays) || defaultSettings.deleteArchivedAfterDays,
    logo_url: settings.companyLogoName || '',
    updated_at: new Date().toISOString(),
  }
}

async function loadSettings() {
  if (!supabase) throw new Error('Missing Supabase environment variables')
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return mapSettingsFromRow(data || { id: 1 })
}

async function saveSettings(settings) {
  if (!supabase) throw new Error('Missing Supabase environment variables')
  const { data, error } = await supabase
    .from('settings')
    .upsert(mapSettingsToRow(settings), { onConflict: 'id' })
    .select('*')
    .single()

  if (error) throw error
  return mapSettingsFromRow(data)
}

async function loadDeliveries() {
  if (!supabase) throw new Error('Missing Supabase environment variables')
  const { data, error } = await supabase
    .from('deliveries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(mapDeliveryFromRow)
}

async function loadDrivers() {
  if (!supabase) throw new Error('Missing Supabase environment variables')
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return (data || []).map(mapDriverFromRow)
}

function App() {
  const [orders, setOrders] = useState([])
  const [drivers, setDrivers] = useState([])
  const [activeView, setActiveView] = useState('orders')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState('Newest First')
  const [dateFilter, setDateFilter] = useState('Today')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [session, setSession] = useState(null)
  const [settings, setSettings] = useState(defaultSettings)
  const [toast, setToast] = useState(null)
  const toastTimeoutRef = useRef(null)

  function showToast(message, type = 'success') {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current)
    setToast({ message, type })
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 2600)
  }

  function handlePrintSlips(ordersToPrint) {
    const printableOrders = (Array.isArray(ordersToPrint) ? ordersToPrint : [ordersToPrint]).filter(Boolean)
    if (!printableOrders.length) return

    const printWindow = window.open('', 'gingerbread-labels', 'width=420,height=520')
    if (!printWindow) {
      showToast('Allow popups to print labels', 'error')
      return
    }

    printWindow.document.open()
    printWindow.document.write(buildLabelPrintDocument(printableOrders))
    printWindow.document.close()
    printWindow.focus()

    let printStarted = false
    const closePrintWindow = () => {
      printWindow.setTimeout(() => {
        if (!printWindow.closed) printWindow.close()
      }, 250)
    }

    printWindow.onafterprint = closePrintWindow
    printWindow.addEventListener('afterprint', closePrintWindow)
    printWindow.addEventListener('focus', () => {
      if (printStarted) closePrintWindow()
    })

    printWindow.setTimeout(() => {
      printStarted = true
      printWindow.print()
      closePrintWindow()
    }, 150)
  }

  const safeDrivers = Array.isArray(drivers) ? drivers.filter(Boolean) : []

  useEffect(() => {
    async function loadData() {
      if (!supabase) {
        console.error('Missing Supabase environment variables')
        return
      }

      try {
        const settingsRows = await loadSettings().catch((error) => {
          logSupabaseError('Failed to load settings', error)
          return defaultSettings
        })
        const deliveryRows = await loadDeliveries().catch((error) => {
          logSupabaseError('Failed to load deliveries', error)
          return []
        })
        const driverRows = await loadDrivers().catch((error) => {
          logSupabaseError('Failed to load drivers', error)
          return []
        })
        setSettings(settingsRows)
        setOrders(deliveryRows)
        setDrivers(driverRows)
      } catch (error) {
        logSupabaseError('Failed to load Supabase data', error)
      }
    }

    loadData()
  }, [])


  async function handleSaveSettings(nextSettings) {
    try {
      const savedSettings = await saveSettings(nextSettings)
      setSettings(savedSettings)
      showToast('Settings saved')
      return savedSettings
    } catch (error) {
      logSupabaseError('Failed to save settings', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleAddOrder(order) {
    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      const { data, error } = await supabase
        .from('deliveries')
        .insert(mapDeliveryToRow(order))
        .select('*')
        .single()

      if (error) throw error
      setOrders((currentOrders) => [mapDeliveryFromRow(data), ...currentOrders])
      setStatus('All')
      setSelectedOrder(null)
      setActiveView('orders')
      showToast('Order added')
    } catch (error) {
      logSupabaseError('Failed to add order', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleAddOrders(previewOrders, options = {}) {
    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      const { data, error } = await supabase
        .from('deliveries')
        .insert(previewOrders.map(mapDeliveryToRow))
        .select('*')

      if (error) throw error
      setOrders((currentOrders) => [...(data || []).map(mapDeliveryFromRow), ...currentOrders])
      setStatus('All')
      if (!options.stayOnPage) setActiveView('orders')
      showToast('Order added')
    } catch (error) {
      logSupabaseError('Failed to import orders', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleSaveOrder(updatedOrder) {
    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      let query = supabase.from('deliveries').update(mapDeliveryToRow(updatedOrder))
      query = selectedOrder.dbId ? query.eq('id', selectedOrder.dbId) : query.eq('order_no', selectedOrder.id)
      const { data, error } = await query.select('*').single()

      if (error) throw error
      const savedOrder = mapDeliveryFromRow(data)
      const becameDelivered = selectedOrder.status !== 'Delivered' && savedOrder.status === 'Delivered'
      const driverCompletedDelivery = isDriverSession && becameDelivered

      setSelectedOrder(savedOrder)

      if (becameDelivered) {
        await sendDeliveredSMS({
          customer_name: savedOrder.customer,
          phone: savedOrder.phone,
          order_no: savedOrder.id,
          driver: getDriverName(savedOrder.driver),
          delivered_time: savedOrder.completedAt || new Date().toISOString(),
        })
      }

      if (driverCompletedDelivery) {
        showToast('✅ Delivery Completed')
        window.setTimeout(async () => {
          setSelectedOrder(null)
          try {
            const refreshedDeliveries = await loadDeliveries()
            setOrders(refreshedDeliveries)
          } catch (refreshError) {
            logSupabaseError('Failed to refresh deliveries after completion', refreshError)
            setOrders((currentOrders) => currentOrders.map((order) => order.dbId === savedOrder.dbId || order.id === selectedOrder.id ? savedOrder : order))
          }
        }, 2000)
        return { driverCompletedDelivery: true }
      }

      setOrders((currentOrders) => currentOrders.map((order) => order.dbId === savedOrder.dbId || order.id === selectedOrder.id ? savedOrder : order))
      showToast('Order saved')
      return { driverCompletedDelivery: false }
    } catch (error) {
      logSupabaseError('Failed to update order', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleDeleteOrder() {
    if (!window.confirm('Delete this order?')) return

    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      let query = supabase.from('deliveries').delete()
      query = selectedOrder.dbId ? query.eq('id', selectedOrder.dbId) : query.eq('order_no', selectedOrder.id)
      const { error } = await query

      if (error) throw error
      setOrders((currentOrders) => currentOrders.filter((order) => order.dbId !== selectedOrder.dbId && order.id !== selectedOrder.id))
      setSelectedOrder(null)
      showToast('Order deleted')
    } catch (error) {
      logSupabaseError('Failed to delete order', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleAddDriver(driver) {
    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      const { data, error } = await supabase
        .from('drivers')
        .insert(mapDriverToRow(driver))
        .select('*')
        .single()

      if (error) throw error
      setDrivers((currentDrivers) => [...currentDrivers, mapDriverFromRow(data)])
      showToast('Driver saved')
    } catch (error) {
      logSupabaseError('Failed to add driver', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleUpdateDriver(originalName, updatedDriver) {
    if (!supabase) {
      logSupabaseError('Failed to update driver', new Error('Missing Supabase environment variables'))
      showToast('Save failed', 'error')
      return
    }
    const existingDriver = safeDrivers.find((driver) => (driver?.name || '') === originalName)

    try {
      let query = supabase.from('drivers').update(mapDriverToRow(updatedDriver))
      query = existingDriver?.dbId ? query.eq('id', existingDriver.dbId) : query.eq('name', originalName)
      const { data, error } = await query.select('*').single()

      if (error) throw error
      const savedDriver = mapDriverFromRow(data)
      setDrivers((currentDrivers) => currentDrivers.map((driver) => driver?.dbId === savedDriver?.dbId || (driver?.name || '') === originalName ? savedDriver : driver))
      setOrders((currentOrders) => currentOrders.map((order) => getDriverName(order.driver) === originalName ? { ...order, driver: getDriverName(savedDriver) } : order))
      showToast('Driver saved')
    } catch (error) {
      logSupabaseError('Failed to update driver', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleDeleteDriver(driverName) {
    if (!window.confirm('Delete this driver?')) return
    if (!supabase) {
      logSupabaseError('Failed to delete driver', new Error('Missing Supabase environment variables'))
      showToast('Save failed', 'error')
      return
    }
    const existingDriver = safeDrivers.find((driver) => (driver?.name || '') === driverName)

    try {
      let query = supabase.from('drivers').delete()
      query = existingDriver?.dbId ? query.eq('id', existingDriver.dbId) : query.eq('name', driverName)
      const { error } = await query

      if (error) throw error
      setDrivers((currentDrivers) => currentDrivers.filter((driver) => driver?.dbId !== existingDriver?.dbId && (driver?.name || '') !== driverName))
      setOrders((currentOrders) => currentOrders.map((order) => getDriverName(order.driver) === driverName ? { ...order, driver: '' } : order))
      showToast('Driver deleted')
    } catch (error) {
      logSupabaseError('Failed to delete driver', error)
      showToast('Save failed', 'error')
      throw error
    }
  }

  async function handleToggleDriver(driverName) {
    const existingDriver = safeDrivers.find((driver) => (driver?.name || '') === driverName)
    if (!existingDriver) return

    await handleUpdateDriver(driverName, {
      ...existingDriver,
      status: existingDriver.status === 'Active' ? 'Inactive' : 'Active',
    })
  }

  async function handleDispatchOrders(orderIds, driverName) {
    const selectedIds = Array.isArray(orderIds) ? orderIds.filter(Boolean) : []
    const assignedDriver = getDriverName(driverName).trim()

    if (!selectedIds.length || !assignedDriver) {
      showToast('Select orders and a driver', 'error')
      return false
    }

    const selectedOrders = orders.filter((order) => selectedIds.includes(order.dbId || order.id) && order.status === 'New')
    if (!selectedOrders.length) {
      showToast('No New orders selected', 'error')
      return false
    }

    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      const savedOrders = await Promise.all(selectedOrders.map(async (order) => {
        const nextOrder = { ...order, driver: assignedDriver, status: 'Out for Delivery' }
        let query = supabase.from('deliveries').update(mapDeliveryToRow(nextOrder))
        query = order.dbId ? query.eq('id', order.dbId) : query.eq('order_no', order.id)
        const { data, error } = await query.select('*').single()
        if (error) throw error
        return mapDeliveryFromRow(data)
      }))

      setOrders((currentOrders) => currentOrders.map((order) => savedOrders.find((savedOrder) => savedOrder.dbId === order.dbId || savedOrder.id === order.id) || order))
      showToast('Orders sent out')
      if (window.confirm('Print delivery slips now?')) handlePrintSlips(savedOrders)
      return true
    } catch (error) {
      logSupabaseError('Failed to dispatch orders', error)
      showToast('Save failed', 'error')
      return false
    }
  }

  const sortedSearchOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return orders
      .filter((order) => {
        if (!normalized) return true
        return [order.customer, order.phone, order.address, getDriverName(order.driver), order.id].some((value) =>
          String(value || '').toLowerCase().includes(normalized),
        )
      })
      .sort((a, b) => {
        if (sort === 'Customer A-Z') return a.customer.localeCompare(b.customer)
        if (sort === 'Customer Z-A') return b.customer.localeCompare(a.customer)
        if (sort === 'Oldest First') return getDeliveryDate(a).localeCompare(getDeliveryDate(b)) || a.id.localeCompare(b.id)
        return getDeliveryDate(b).localeCompare(getDeliveryDate(a)) || b.id.localeCompare(a.id)
      })
  }, [orders, query, sort])

  const isDriverSession = session?.role === 'driver'
  const officeDateOrders = useMemo(() => {
    return sortedSearchOrders.filter((order) => matchesDateFilter(order, dateFilter))
  }, [dateFilter, sortedSearchOrders])

  const driverOrders = useMemo(() => {
    if (!isDriverSession) return []
    const driverName = getDriverName(session.driver)
    return sortedSearchOrders.filter((order) => order.status === 'Out for Delivery' && getDriverName(order.driver) === driverName)
  }, [isDriverSession, session, sortedSearchOrders])

  const dashboardBaseOrders = isDriverSession ? driverOrders : officeDateOrders
  const dashboardOrders = dashboardBaseOrders.filter((order) => status === 'All' || order.status === status)
  const dashboardCounts = useMemo(() => {
    return statusOptions.reduce((acc, option) => {
      acc[option] = option === 'All' ? dashboardBaseOrders.length : dashboardBaseOrders.filter((order) => order.status === option).length
      return acc
    }, {})
  }, [dashboardBaseOrders])
  const handleLogout = () => {
    setSession(null)
    setSelectedOrder(null)
    setActiveView('orders')
    setQuery('')
    setStatus('All')
    setDateFilter('Today')
  }

  const showDrawer = selectedOrder && (activeView === 'orders' || activeView === 'history')

  if (!session) {
    return <LoginScreen drivers={safeDrivers} officePin={settings.officePin} companyName={settings.companyName} onLogin={setSession} />
  }

  return (
    <div className={isDriverSession ? 'app-frame driver-app-frame' : 'app-frame'}>
      {!isDriverSession && <Sidebar activeView={activeView} setActiveView={setActiveView} onLogout={handleLogout} />}
      <main className="main-shell">
        <div className="driver-session-bar">
          <span>{isDriverSession ? getDriverName(session.driver) : 'Office'}</span>
          <button className="secondary-action" type="button" onClick={handleLogout}>Logout</button>
        </div>
        {activeView === 'orders' && (
          <OrdersDashboard
            query={query}
            setQuery={setQuery}
            status={status}
            setStatus={setStatus}
            sort={sort}
            setSort={setSort}
            dateFilter={dateFilter}
            setDateFilter={setDateFilter}
            showDateFilter={!isDriverSession}
            counts={dashboardCounts}
            visibleOrders={dashboardOrders}
            setSelectedOrder={setSelectedOrder}
            drivers={safeDrivers}
            isOffice={!isDriverSession}
            onDispatchOrders={handleDispatchOrders}
          />
        )}
        {!isDriverSession && activeView === 'add' && <AddOrder drivers={safeDrivers} onAddOrder={handleAddOrder} nextOrderNumber={getNextOrderNumber(orders)} />}
        {!isDriverSession && activeView === 'quick' && <QuickEntry orders={orders} onAddOrders={handleAddOrders} />}
        {!isDriverSession && activeView === 'dispatch' && <Dispatch orders={orders} drivers={safeDrivers} onDispatchOrders={handleDispatchOrders} />}
        {!isDriverSession && activeView === 'drivers' && (
          <Drivers
            drivers={safeDrivers}
            onAddDriver={handleAddDriver}
            onUpdateDriver={handleUpdateDriver}
            onDeleteDriver={handleDeleteDriver}
            onToggleDriver={handleToggleDriver}
          />
        )}
        {!isDriverSession && activeView === 'history' && <History orders={orders} setSelectedOrder={setSelectedOrder} />}
        {!isDriverSession && activeView === 'settings' && <Settings settings={settings} onSaveSettings={handleSaveSettings} />}
      </main>
      {showDrawer && (
        <div className="drawer-layer" aria-label="Order details panel">
          <button className="drawer-scrim" type="button" aria-label="Close details backdrop" onClick={() => setSelectedOrder(null)} />
          <OrderDrawer
            drivers={safeDrivers}
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            mode={isDriverSession ? 'driver' : 'office'}
            onSave={handleSaveOrder}
            onDelete={isDriverSession ? null : handleDeleteOrder}
            onToast={showToast}
            onPrintSlip={isDriverSession ? null : handlePrintSlips}
          />
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} />}
      {!isDriverSession && <MobileNav activeView={activeView} setActiveView={setActiveView} />}
    </div>
  )
}



function buildLabelPrintDocument(orders) {
  const labels = orders.map((order) => [
    '<section class="zebra-label">',
    '<span class="label-kicker">ORDER #</span>',
    '<strong class="label-order-number">' + escapeHtml(order?.id || '') + '</strong>',
    '<span class="label-customer">' + escapeHtml(order?.customer || '') + '</span>',
    '<p class="label-address">' + escapeHtml(order?.address || '') + '</p>',
    '</section>',
  ].join('')).join('')

  return '<!doctype html>' +
    '<html>' +
    '<head>' +
    '<meta charset="utf-8" />' +
    '<title>Gingerbread Delivery Labels</title>' +
    '<style>' +
    '@page { size: 2.25in 1.25in; margin: 0; }' +
    'html, body { width: 2.25in; min-width: 0; margin: 0; padding: 0; overflow: visible; background: #ffffff; }' +
    'body { color: #000000; font-family: Arial, Helvetica, sans-serif; }' +
    '.print-note { box-sizing: border-box; width: 2.25in; margin: 0 0 0.12in; padding: 0.06in; color: #000000; font-size: 10px; line-height: 1.25; }' +
    '.zebra-label { display: block; box-sizing: border-box; width: 2.25in; height: 1.25in; margin: 0; overflow: hidden; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; padding: 0.075in 0.08in 0.045in; background: #ffffff; color: #000000; }' +
    '.label-kicker, .label-order-number, .label-customer, .label-address { display: block; color: #000000; letter-spacing: 0; }' +
    '.label-kicker { font-size: 0.1in; font-weight: 900; line-height: 1; }' +
    '.label-order-number { margin-top: 0.006in; overflow: hidden; font-size: 0.3in; font-weight: 900; line-height: 0.9; text-overflow: ellipsis; white-space: nowrap; }' +
    '.label-customer { margin-top: 0.024in; overflow: hidden; font-size: 0.2in; font-weight: 850; line-height: 0.92; text-overflow: ellipsis; white-space: nowrap; }' +
    '.label-address { margin: 0.018in 0 0; overflow: visible; font-size: 0.158in; font-weight: 850; line-height: 0.94; white-space: normal; overflow-wrap: break-word; word-break: normal; }' +
    '.zebra-label:last-child { page-break-after: auto; break-after: auto; }' +
    '@media print { .print-note { display: none; } html, body { width: 2.25in !important; margin: 0 !important; padding: 0 !important; } .zebra-label { box-sizing: border-box !important; width: 2.25in !important; height: 1.25in !important; margin: 0 !important; overflow: hidden !important; } }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<p class="print-note">For Zebra labels, turn off browser print &quot;Headers and footers&quot;.</p>' +
    labels +
    '</body>' +
    '</html>'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function LoginScreen({ drivers, officePin, companyName, onLogin }) {
  const [loginMode, setLoginMode] = useState('office')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    setMessage('')

    if (loginMode === 'office') {
      if (pin === String(officePin || '7933')) {
        onLogin({ role: 'office' })
        return
      }

      setMessage('Invalid office PIN.')
      return
    }

    const matchedDriver = (Array.isArray(drivers) ? drivers : []).find((driver) => String(driver?.pin || '') === pin)
    if (matchedDriver) {
      onLogin({ role: 'driver', driver: matchedDriver })
      return
    }

    setMessage('Driver PIN not found.')
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="brand-block login-brand">
          <div className="brand-mark">GD</div>
          <div>
            <p>{companyName || 'Gingerbread Delivery'}</p>
            <span>Delivery V2</span>
          </div>
        </div>
        <div className="login-options">
          <button className={loginMode === 'office' ? 'counter-card active' : 'counter-card'} type="button" onClick={() => setLoginMode('office')}>
            <span>Office Login</span>
            <strong>Office</strong>
          </button>
          <button className={loginMode === 'driver' ? 'counter-card active' : 'counter-card'} type="button" onClick={() => setLoginMode('driver')}>
            <span>Driver Login</span>
            <strong>Driver</strong>
          </button>
        </div>
        <form className="form-card login-form" onSubmit={handleSubmit}>
          <label>{loginMode === 'office' ? 'Office PIN' : 'Driver PIN'}<input value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Enter PIN" autoFocus /></label>
          {message && <p className="drawer-message error-message">{message}</p>}
          <button className="primary-action" type="submit">Login</button>
        </form>
      </section>
    </main>
  )
}

function Sidebar({ activeView, setActiveView, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">GD</div>
        <div>
          <p>Gingerbread</p>
          <span>Delivery V2</span>
        </div>
      </div>
      <nav className="nav-stack" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? 'nav-link active' : 'nav-link'}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            <span className="nav-dot" />
            {item.label}
          </button>
        ))}
      </nav>
      <button className="secondary-action logout-button" type="button" onClick={onLogout}>Logout</button>
    </aside>
  )
}

function MobileNav({ activeView, setActiveView }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {navItems.filter((item) => item.mobile).map((item) => (
        <button
          key={item.id}
          className={activeView === item.id ? 'mobile-link active' : 'mobile-link'}
          onClick={() => setActiveView(item.id)}
          type="button"
        >
          <span />
          {item.mobile}
        </button>
      ))}
    </nav>
  )
}

function PageHeader({ eyebrow, title, subtitle }) {
  return (
    <header className="page-header">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{subtitle}</span>
    </header>
  )
}

function OrdersDashboard({ query, setQuery, status, setStatus, sort, setSort, dateFilter, setDateFilter, showDateFilter = true, counts, visibleOrders, setSelectedOrder, drivers = [], isOffice = false, onDispatchOrders }) {
  return (
    <section className="dashboard-view">
      <PageHeader eyebrow="Dispatch dashboard" title="Gingerbread Delivery" subtitle="Delivery management" />
      <div className="toolbar">
        <label className="search-field">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer, phone, address, driver"
          />
        </label>
        <label className="select-field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {statusOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label className="select-field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {sortOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        {showDateFilter && (
          <label className="select-field">
            <span>Delivery Date</span>
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              {dateFilterOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="counter-grid">
        {statusOptions.map((option) => (
          <button
            key={option}
            className={status === option ? 'counter-card active' : 'counter-card'}
            onClick={() => setStatus(option)}
            type="button"
          >
            <span>{option}</span>
            <strong>{counts[option]}</strong>
          </button>
        ))}
      </div>
      <div className="order-grid">
        {visibleOrders.map((order) => (
          <OrderCard key={order.id} order={order} onClick={() => setSelectedOrder(order)} drivers={drivers} canQuickDispatch={isOffice && order.status === 'New'} onDispatchOrders={onDispatchOrders} />
        ))}
      </div>
    </section>
  )
}

function OrderCard({ order, onClick, drivers = [], canQuickDispatch = false, onDispatchOrders }) {
  const tone = statusClass[order.status]
  const availableDrivers = Array.isArray(drivers) ? drivers.filter((driver) => (driver?.status || 'Active') === 'Active') : []
  const [dispatchDriver, setDispatchDriver] = useState(getDriverName(availableDrivers[0]))

  function handleQuickDispatch(event) {
    event.stopPropagation()
    onDispatchOrders?.([order.dbId || order.id], dispatchDriver)
  }

  return (
    <article className="order-card">
      <button className="order-card-open" onClick={onClick} type="button">
        <div className="order-card-top">
          <span>{order.id}</span>
          <span className={'status-pill ' + tone}>{order.status}</span>
        </div>
        <h2>{order.customer}</h2>
        <div className="order-meta">
          <p>{order.phone}</p>
          <p>{order.address}</p>
        </div>
        <div className="assignment-row">
          <span>{getDriverName(order.driver) || 'Unassigned'}</span>
          <strong>{getDeliveryDate(order)}</strong>
        </div>
      </button>
      {canQuickDispatch && (
        <div className="quick-dispatch">
          <select value={dispatchDriver} onChange={(event) => setDispatchDriver(event.target.value)} onClick={(event) => event.stopPropagation()}>
            <option value="">Choose driver</option>
            {availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index} value={getDriverName(driver)}>{getDriverName(driver)}</option>)}
          </select>
          <button className="secondary-action" type="button" disabled={!dispatchDriver} onClick={handleQuickDispatch}>Out for Delivery</button>
        </div>
      )}
      <div className={'status-strip ' + tone}>{order.status}</div>
    </article>
  )
}

function OrderDrawer({ drivers = [], order, mode = 'office', onClose, onSave, onDelete, onToast = () => {}, onPrintSlip = null }) {
  const [draft, setDraft] = useState(order)
  const availableDrivers = Array.isArray(drivers) ? drivers : []
  const [saveMessage, setSaveMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [isUploadingProof, setIsUploadingProof] = useState(false)
  const isDriverMode = mode === 'driver'
  const canDriverEdit = !isDriverMode || order?.status === 'Out for Delivery'
  const driverStatusOptions = ['Out for Delivery', 'Delivered', 'Failed']
  const statusChoices = isDriverMode ? driverStatusOptions : editableStatusOptions
  const showProofFields = draft.status === 'Delivered'
  const showReceiver = draft.status === 'Delivered'
  const showFailureReason = draft.status === 'Failed'

  function updateDraft(field, value) {
    if (isDriverMode && !canDriverEdit) return
    setValidationMessage('')
    setSaveMessage('')
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (isDriverMode && !canDriverEdit) {
      setValidationMessage('This delivery can no longer be changed.')
      return
    }

    if (isDriverMode && order?.status !== 'Out for Delivery') {
      setValidationMessage('Drivers can only update orders that are Out for Delivery.')
      return
    }

    if (isDriverMode && draft.status === 'Delivered' && (!draft.receiver.trim() || !draft.proofPhoto.trim())) {
      setValidationMessage('Receiver name and proof photo are required for delivered orders.')
      return
    }

    if (draft.status === 'Failed' && !draft.failureReason.trim()) {
      setValidationMessage('Failure reason is required for failed orders.')
      return
    }

    try {
      const saveResult = await onSave({
        ...draft,
        id: isDriverMode ? order.id : draft.id,
        customer: isDriverMode ? order.customer : draft.customer,
        phone: isDriverMode ? order.phone : draft.phone,
        address: isDriverMode ? order.address : draft.address,
        driver: isDriverMode ? order.driver : draft.driver,
        deliveryDate: isDriverMode ? order.deliveryDate : draft.deliveryDate || getTodayDate(),
        notes: isDriverMode ? order.notes : draft.notes,
        receiver: showReceiver ? draft.receiver : '',
        failureReason: showFailureReason ? draft.failureReason : '',
        proofPhoto: showProofFields ? draft.proofPhoto : '',
      })
      setSaveMessage(saveResult?.driverCompletedDelivery ? 'Delivery Completed' : 'Saved ✓')
      window.setTimeout(onClose, saveResult?.driverCompletedDelivery ? 2000 : 1000)
    } catch (error) {
      setValidationMessage(error?.message || 'Failed to save changes.')
    }
  }

  async function handleProofPhotoChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!supabase) {
      setValidationMessage('Supabase is not configured for proof photo upload.')
      onToast('Upload failed', 'error')
      return
    }

    setValidationMessage('')
    setSaveMessage('')
    setIsUploadingProof(true)

    try {
      const safeOrderNumber = String(draft.id || order?.id || 'delivery').replace(/[^a-zA-Z0-9-_]/g, '-')
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const filePath = safeOrderNumber + '/' + Date.now() + '-' + safeFileName
      const { error: uploadError } = await supabase.storage
        .from('delivery-proofs')
        .upload(filePath, file, { contentType: file.type, upsert: true })

      if (uploadError) throw uploadError

      const { data } = supabase.storage
        .from('delivery-proofs')
        .getPublicUrl(filePath)

      updateDraft('proofPhoto', data.publicUrl)
      onToast('Photo uploaded')
    } catch (error) {
      logSupabaseError('Failed to upload proof photo', error)
      setValidationMessage(error?.message || 'Failed to upload proof photo.')
      onToast('Upload failed', 'error')
    } finally {
      setIsUploadingProof(false)
    }
  }


  function handleOpenMaps() {
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(draft.address)
    window.open(mapsUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <aside className="detail-drawer" aria-label="Edit order">
      <div className="drawer-header">
        <button className="drawer-close" type="button" aria-label="Close order details" onClick={onClose}>X</button>
        <span>{isDriverMode ? 'Delivery update' : 'Edit order'}</span>
        <h2>{draft.id || 'New order'}</h2>
        <p>{draft.customer || 'Customer details'}</p>
      </div>
      <form className="drawer-form" onSubmit={handleSubmit}>
        <div className="detail-list edit-list">
          {!isDriverMode && <label>Order Number<input value={draft.id} onChange={(event) => updateDraft('id', event.target.value)} /></label>}
          {!isDriverMode && <label>Customer Name<input value={draft.customer} onChange={(event) => updateDraft('customer', event.target.value)} /></label>}
          {!isDriverMode && <label>Phone<input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} /></label>}
          {!isDriverMode && <label>Address<input value={draft.address} onChange={(event) => updateDraft('address', event.target.value)} /></label>}
          {!isDriverMode && <label>Driver<select value={getDriverName(draft.driver)} onChange={(event) => updateDraft('driver', event.target.value)}><option value="">Unassigned</option>{availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index}>{getDriverName(driver)}</option>)}</select></label>}
          {!isDriverMode && <label>Delivery Date<input type="date" value={draft.deliveryDate || getTodayDate()} onChange={(event) => updateDraft('deliveryDate', event.target.value)} /></label>}
          <label>Status<select disabled={isDriverMode && !canDriverEdit} value={draft.status} onChange={(event) => updateDraft('status', event.target.value)}>{statusChoices.map((option) => <option key={option}>{option}</option>)}</select></label>
          {!isDriverMode && <label>Notes<textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows="4" /></label>}
          {showReceiver && <label>Receiver Name<input disabled={isDriverMode && !canDriverEdit} required value={draft.receiver} onChange={(event) => updateDraft('receiver', event.target.value)} /></label>}
          {showProofFields && (
            <div className="delivery-proof-field">
              <span>Proof Photo</span>
              {draft.proofPhoto && <img className="proof-thumbnail" src={draft.proofPhoto} alt="Delivery proof" />}
              <label className="proof-upload-button">
                <input disabled={(isDriverMode && !canDriverEdit) || isUploadingProof} type="file" accept="image/*" capture="environment" onChange={handleProofPhotoChange} />
                {draft.proofPhoto ? 'Replace Photo' : '📷 Take / Upload Proof Photo'}
              </label>
              {isUploadingProof && <p>Uploading proof photo...</p>}
            </div>
          )}
          {showFailureReason && <label>Failure Reason<textarea disabled={isDriverMode && !canDriverEdit} required value={draft.failureReason} onChange={(event) => updateDraft('failureReason', event.target.value)} rows="3" /></label>}
        </div>
        {isDriverMode && !canDriverEdit && <p className="drawer-message error-message">This delivery is read-only for drivers.</p>}
        {validationMessage && <p className="drawer-message error-message">{validationMessage}</p>}
        {saveMessage && <p className="drawer-message saved-message">{saveMessage}</p>}
        <div className="drawer-actions">
          {canDriverEdit && <button className="primary-action" type="submit">Save Changes</button>}
          {!isDriverMode && onPrintSlip && <button className="secondary-action" type="button" onClick={() => onPrintSlip(order)}>Print Slip</button>}
          {!isDriverMode && onDelete && <button className="danger-action" type="button" onClick={onDelete}>Delete Order</button>}
          <button className="secondary-action" type="button" onClick={handleOpenMaps}>Open Maps</button>
          <button className="secondary-action" type="button" onClick={onClose}>Close</button>
        </div>
      </form>
    </aside>
  )
}

function Toast({ message, type }) {
  return (
    <div className={'toast-message ' + (type === 'error' ? 'error' : 'success')} role="status" aria-live="polite">
      {message}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  )
}

function AddOrder({ drivers = [], onAddOrder, nextOrderNumber }) {
  const availableDrivers = Array.isArray(drivers) ? drivers.filter(Boolean) : []
  const emptyOrder = {
    id: nextOrderNumber,
    customer: '',
    phone: '',
    address: '',
    driver: '',
    deliveryDate: getTodayDate(),
    status: 'New',
    notes: '',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
  }
  const [draft, setDraft] = useState(emptyOrder)
  const showReceiver = draft.status === 'Delivered'
  const showFailureReason = draft.status === 'Failed'

  function updateDraft(field, value) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await onAddOrder({
      ...draft,
      driver: getDriverName(draft.driver),
      deliveryDate: draft.deliveryDate || getTodayDate(),
      status: 'New',
      receiver: showReceiver ? draft.receiver : '',
      failureReason: showFailureReason ? draft.failureReason : '',
      proofPhoto: showReceiver ? draft.proofPhoto : '',
    })
    setDraft(emptyOrder)
  }

  return (
    <section className="single-view">
      <PageHeader eyebrow="Create" title="Add Order" subtitle="Enter delivery details for a new order" />
      <form className="form-card" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>Order Number<input value={draft.id} onChange={(event) => updateDraft('id', event.target.value)} /></label>
          <label>Customer name<input value={draft.customer} onChange={(event) => updateDraft('customer', event.target.value)} placeholder="Customer name" /></label>
          <label>Phone<input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} placeholder="Phone number" /></label>
          <label className="wide">Address<input value={draft.address} onChange={(event) => updateDraft('address', event.target.value)} placeholder="Street, city, state" /></label>
          <label>Driver<select value={getDriverName(draft.driver)} onChange={(event) => updateDraft('driver', event.target.value)}><option value="">Unassigned</option>{availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index}>{getDriverName(driver)}</option>)}</select></label>
          <label>Delivery Date<input type="date" value={draft.deliveryDate || getTodayDate()} onChange={(event) => updateDraft('deliveryDate', event.target.value)} /></label>
          <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} placeholder="Delivery instructions" rows="4" /></label>
          {showReceiver && <label>Receiver Name<input value={draft.receiver} onChange={(event) => updateDraft('receiver', event.target.value)} placeholder="Receiver name" /></label>}
          {showFailureReason && <label className="wide">Failure Reason<textarea value={draft.failureReason} onChange={(event) => updateDraft('failureReason', event.target.value)} placeholder="Reason delivery failed" rows="3" /></label>}
        </div>
        <div className="form-actions">
          <button className="secondary-action" type="button" onClick={() => setDraft(emptyOrder)}>Clear</button>
          <button className="primary-action" type="submit">Save Order</button>
        </div>
      </form>
    </section>
  )
}

function createQuickEntryRows(count) {
  return Array.from({ length: count }, () => ({ deliveryDate: '', orderNo: '', customer: '', phone: '', address: '', notes: '' }))
}

function isQuickRowEmpty(row) {
  return !['orderNo', 'customer', 'phone', 'address', 'notes'].some((field) => String(row?.[field] || '').trim())
}

function QuickEntry({ orders = [], onAddOrders }) {
  const columns = [
    { key: 'deliveryDate', label: 'Delivery Date' },
    { key: 'orderNo', label: 'Order #' },
    { key: 'customer', label: 'Customer Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
    { key: 'notes', label: 'Notes' },
  ]
  const requiredFields = ['orderNo', 'customer', 'phone', 'address']
  const [rows, setRows] = useState(() => createQuickEntryRows(20))
  const [summary, setSummary] = useState({ imported: 0, skipped: 0 })
  const [fileMessage, setFileMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const existingOrderNumbers = useMemo(() => new Set((Array.isArray(orders) ? orders : []).map((order) => String(order?.id || '').trim().toLowerCase()).filter(Boolean)), [orders])
  const duplicateOrderNumbers = useMemo(() => {
    const seen = new Set()
    const duplicates = new Set()

    rows.forEach((row) => {
      const orderNo = String(row.orderNo || '').trim().toLowerCase()
      if (!orderNo) return
      if (existingOrderNumbers.has(orderNo) || seen.has(orderNo)) duplicates.add(orderNo)
      seen.add(orderNo)
    })

    return duplicates
  }, [existingOrderNumbers, rows])

  function updateCell(rowIndex, field, value) {
    setRows((currentRows) => {
      const nextRows = currentRows.map((row, index) => index === rowIndex ? { ...row, [field]: value } : row)
      if (rowIndex >= nextRows.length - 3) nextRows.push(...createQuickEntryRows(10))
      return nextRows
    })
  }

  function focusCell(rowIndex, columnIndex) {
    window.requestAnimationFrame(() => {
      const input = document.querySelector('[data-quick-row="' + rowIndex + '"][data-quick-col="' + columnIndex + '"]')
      input?.focus()
    })
  }

  function handleKeyDown(event, rowIndex, columnIndex) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const nextRowIndex = rowIndex + 1
    if (nextRowIndex >= rows.length) {
      setRows((currentRows) => [...currentRows, ...createQuickEntryRows(10)])
    }
    focusCell(nextRowIndex, columnIndex)
  }

  function handlePaste(event, rowIndex, columnIndex) {
    const pastedText = event.clipboardData.getData('text')
    if (!pastedText || (!pastedText.includes('\t') && !pastedText.includes('\n') && !pastedText.includes('\r'))) return

    event.preventDefault()
    const pastedRows = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((line, index, allRows) => line || index < allRows.length - 1)
    const parsedRows = pastedRows.map((line) => line.split('\t'))

    setRows((currentRows) => {
      const neededRows = rowIndex + parsedRows.length
      const nextRows = [...currentRows]
      while (nextRows.length < neededRows) nextRows.push(...createQuickEntryRows(10))

      parsedRows.forEach((cells, pasteRowIndex) => {
        const targetRowIndex = rowIndex + pasteRowIndex
        const nextRow = { ...nextRows[targetRowIndex] }
        cells.forEach((cell, pasteColumnIndex) => {
          const targetColumn = columns[columnIndex + pasteColumnIndex]
          if (targetColumn) nextRow[targetColumn.key] = cell.trim()
        })
        nextRows[targetRowIndex] = nextRow
      })

      if (neededRows >= nextRows.length - 3) nextRows.push(...createQuickEntryRows(10))
      return nextRows
    })
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setFileMessage('')
      const importedRows = await readQuickEntryFile(file)
      const visibleRows = importedRows.length ? importedRows : []
      const emptyRowsNeeded = Math.max(20 - visibleRows.length, 10)
      setRows([...visibleRows, ...createQuickEntryRows(emptyRowsNeeded)])
      setSummary({ imported: 0, skipped: 0 })
      setFileMessage(visibleRows.length ? visibleRows.length + ' rows loaded for review.' : 'No rows found in that file.')
    } catch (error) {
      console.error(error)
      setFileMessage(error?.message || 'Could not import that file.')
    }
  }


  function getCellClass(row, field) {
    const orderNo = String(row.orderNo || '').trim().toLowerCase()
    if (field === 'orderNo' && orderNo && duplicateOrderNumbers.has(orderNo)) return 'quick-cell duplicate'
    if (!isQuickRowEmpty(row) && requiredFields.includes(field) && !String(row[field] || '').trim()) return 'quick-cell missing'
    return 'quick-cell'
  }

  async function handleSaveAll() {
    const ordersToImport = []
    let skipped = 0

    rows.forEach((row) => {
      if (isQuickRowEmpty(row)) return
      const orderNo = String(row.orderNo || '').trim()
      const normalizedOrderNo = orderNo.toLowerCase()
      const hasMissingRequired = requiredFields.some((field) => !String(row[field] || '').trim())
      const isDuplicate = normalizedOrderNo && duplicateOrderNumbers.has(normalizedOrderNo)

      if (hasMissingRequired || isDuplicate) {
        skipped += 1
        return
      }

      ordersToImport.push({
        id: orderNo,
        deliveryDate: normalizeLocalDateString(row.deliveryDate) || getTodayDate(),
        customer: String(row.customer || '').trim(),
        phone: String(row.phone || '').trim(),
        address: String(row.address || '').trim(),
        driver: '',
        status: 'New',
        notes: String(row.notes || '').trim(),
        receiver: '',
        failureReason: '',
        proofPhoto: '',
      })
    })

    setSummary({ imported: 0, skipped })
    if (!ordersToImport.length) return

    try {
      setSaving(true)
      await onAddOrders(ordersToImport, { stayOnPage: true })
      setSummary({ imported: ordersToImport.length, skipped })
      setRows(createQuickEntryRows(20))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="single-view quick-entry-view">
      <PageHeader eyebrow="Office" title="Quick Entry" subtitle="Paste or type orders in a spreadsheet-style grid" />
      <div className="quick-entry-panel">
        <div className="quick-entry-toolbar">
          <div>
            <strong>Imported: {summary.imported} orders</strong>
            <span>Skipped: {summary.skipped} rows</span>
            {fileMessage && <span>{fileMessage}</span>}
          </div>
          <div className="quick-entry-actions">
            <label className="file-upload-control quick-upload-control">
              <input type="file" accept=".csv,text/csv,.xlsx,.xls" onChange={handleFileUpload} />
              <span className="secondary-action">Upload File</span>
            </label>
            <button className="primary-action" type="button" disabled={saving} onClick={handleSaveAll}>{saving ? 'Saving...' : 'Save All'}</button>
          </div>
        </div>
        <div className="quick-grid-wrap">
          <div className="quick-grid" style={{ gridTemplateColumns: '130px 104px 190px 150px minmax(260px, 1fr) minmax(220px, 0.8fr)' }}>
            {columns.map((column) => <div className="quick-header" key={column.key}>{column.label}</div>)}
            {rows.map((row, rowIndex) => columns.map((column, columnIndex) => (
              <input
                className={getCellClass(row, column.key)}
                data-quick-row={rowIndex}
                data-quick-col={columnIndex}
                key={column.key + '-' + rowIndex}
                value={row[column.key]}
                onChange={(event) => updateCell(rowIndex, column.key, event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, rowIndex, columnIndex)}
                onPaste={(event) => handlePaste(event, rowIndex, columnIndex)}
                aria-label={column.label + ' row ' + (rowIndex + 1)}
              />
            )))}
          </div>
        </div>
      </div>
    </section>
  )
}



async function readQuickEntryFile(file) {
  const fileName = String(file?.name || '').toLowerCase()

  if (fileName.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text()
    return quickRowsFromTable(parseCsvRows(text))
  }

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    const xlsxUrl = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm'
    const XLSX = await import(/* @vite-ignore */ xlsxUrl)
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) return []
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: '' })
    return quickRowsFromTable(sheetRows)
  }

  throw new Error('Upload a CSV or Excel file.')
}

function quickRowsFromTable(tableRows) {
  const cleanRows = (Array.isArray(tableRows) ? tableRows : [])
    .map((row) => Array.isArray(row) ? row.map((cell) => String(cell || '').trim()) : [])
    .filter((row) => row.some(Boolean))

  if (!cleanRows.length) return []

  const headers = cleanRows[0].map(normalizeHeader)
  const headerMap = getQuickEntryHeaderMap(headers)
  const hasHeaderRow = Object.values(headerMap).filter((index) => index >= 0).length >= 2
  const dataRows = hasHeaderRow ? cleanRows.slice(1) : cleanRows

  return dataRows
    .map((row) => ({
      deliveryDate: hasHeaderRow ? cellValue(row, headerMap.deliveryDate) : cellValue(row, 0),
      orderNo: hasHeaderRow ? cellValue(row, headerMap.orderNo) : cellValue(row, 1),
      customer: hasHeaderRow ? cellValue(row, headerMap.customer) : cellValue(row, 2),
      phone: hasHeaderRow ? cellValue(row, headerMap.phone) : cellValue(row, 3),
      address: hasHeaderRow ? cellValue(row, headerMap.address) : cellValue(row, 4),
      notes: hasHeaderRow ? cellValue(row, headerMap.notes) : cellValue(row, 5),
    }))
    .filter((row) => !isQuickRowEmpty(row))
}

function getQuickEntryHeaderMap(headers) {
  return {
    deliveryDate: findHeaderIndex(headers, ['delivery_date', 'delivery date', 'date']),
    orderNo: findHeaderIndex(headers, ['order #', 'order#', 'order_no', 'order no', 'order number', 'order']),
    customer: findHeaderIndex(headers, ['customer name', 'customer_name', 'customer', 'name']),
    phone: findHeaderIndex(headers, ['phone', 'phone number', 'customer phone']),
    address: findHeaderIndex(headers, ['address', 'delivery address', 'customer address']),
    notes: findHeaderIndex(headers, ['notes', 'note', 'delivery notes', 'instructions']),
  }
}

function findHeaderIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header))
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function Dispatch({ orders = [], drivers = [], onDispatchOrders }) {
  const newOrders = (Array.isArray(orders) ? orders : [])
    .filter((order) => order.status === 'New')
    .sort((a, b) => getDeliveryDate(a).localeCompare(getDeliveryDate(b)) || a.id.localeCompare(b.id))
  const groupedOrders = newOrders.reduce((groups, order) => {
    const dateKey = getDateGroupKey(order)
    if (!groups[dateKey]) groups[dateKey] = []
    groups[dateKey].push(order)
    return groups
  }, {})
  const dateGroups = Object.keys(groupedOrders).sort().map((dateKey) => ({ dateKey, orders: groupedOrders[dateKey] }))
  const dispatchOrders = dateGroups.flatMap((group) => group.orders)
  const availableDrivers = (Array.isArray(drivers) ? drivers : []).filter((driver) => (driver?.status || 'Active') === 'Active')
  const [selectedIds, setSelectedIds] = useState([])
  const [selectedDriver, setSelectedDriver] = useState('')
  const [collapsedDates, setCollapsedDates] = useState(() => new Set())

  function isDateCollapsed(dateKey) {
    if (dateKey === getTodayDate()) return collapsedDates.has(dateKey)
    return !collapsedDates.has(dateKey)
  }

  function toggleDateGroup(dateKey) {
    setCollapsedDates((currentDates) => {
      const nextDates = new Set(currentDates)
      if (dateKey === getTodayDate()) {
        if (nextDates.has(dateKey)) nextDates.delete(dateKey)
        else nextDates.add(dateKey)
        return nextDates
      }

      if (nextDates.has(dateKey)) nextDates.delete(dateKey)
      else nextDates.add(dateKey)
      return nextDates
    })
  }

  const visibleDispatchOrders = dateGroups
    .filter((group) => !isDateCollapsed(group.dateKey))
    .flatMap((group) => group.orders)
  const visibleDispatchIds = visibleDispatchOrders.map((order) => order.dbId || order.id)
  const allVisibleSelected = visibleDispatchIds.length > 0 && visibleDispatchIds.every((orderId) => selectedIds.includes(orderId))

  function toggleOrder(orderId) {
    setSelectedIds((currentIds) => currentIds.includes(orderId) ? currentIds.filter((id) => id !== orderId) : [...currentIds, orderId])
  }

  function toggleAll() {
    setSelectedIds((currentIds) => {
      if (allVisibleSelected) return currentIds.filter((orderId) => !visibleDispatchIds.includes(orderId))
      return Array.from(new Set([...currentIds, ...visibleDispatchIds]))
    })
  }

  async function handleSendOut() {
    const dispatched = await onDispatchOrders(selectedIds, selectedDriver)
    if (dispatched) setSelectedIds([])
  }

  function renderDispatchRow(order) {
    const orderId = order.dbId || order.id
    return (
      <label className="dispatch-row" key={orderId}>
        <input type="checkbox" checked={selectedIds.includes(orderId)} onChange={() => toggleOrder(orderId)} />
        <div>
          <strong>{order.id}</strong>
          <span>{order.customer}</span>
        </div>
        <p>{order.address}</p>
      </label>
    )
  }

  return (
    <section className="single-view dispatch-view">
      <PageHeader eyebrow="Office" title="Dispatch" subtitle="Assign New orders and send them out for delivery" />
      <div className="dispatch-panel">
        <div className="dispatch-toolbar">
          <label className="dispatch-select-all"><input type="checkbox" checked={allVisibleSelected} disabled={!visibleDispatchIds.length} onChange={toggleAll} />Select all New orders</label>
          <label className="select-field"><span>Driver</span><select value={selectedDriver} onChange={(event) => setSelectedDriver(event.target.value)}><option value="">Choose driver</option>{availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index} value={getDriverName(driver)}>{getDriverName(driver)}</option>)}</select></label>
          <button className="primary-action" type="button" disabled={!selectedIds.length || !selectedDriver} onClick={handleSendOut}>Send Out for Delivery</button>
        </div>
        <div className="dispatch-list">
          {dateGroups.map((group) => {
            const collapsed = isDateCollapsed(group.dateKey)
            return (
              <div className="dispatch-date-group" key={group.dateKey}>
                <button className="dispatch-group-heading" type="button" onClick={() => toggleDateGroup(group.dateKey)}>
                  <span>{collapsed ? '>' : 'v'} {getDateGroupLabel(group.dateKey)}</span>
                  <strong>{group.orders.length}</strong>
                </button>
                {!collapsed && group.orders.map(renderDispatchRow)}
              </div>
            )
          })}
          {!dispatchOrders.length && <p className="empty-state">No New orders are waiting for dispatch.</p>}
        </div>
      </div>
    </section>
  )
}

function Drivers({ drivers = [], onAddDriver, onUpdateDriver, onDeleteDriver, onToggleDriver }) {
  const availableDrivers = Array.isArray(drivers) ? drivers.filter(Boolean) : []
  const emptyDriver = { name: '', pin: '', status: 'Active', route: 'Available' }
  const [draft, setDraft] = useState(emptyDriver)
  const [editingName, setEditingName] = useState('')

  function updateDraft(field, value) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  function resetForm() {
    setDraft(emptyDriver)
    setEditingName('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const driver = {
      name: (draft?.name || '').trim(),
      pin: (draft?.pin || '').trim(),
      status: draft?.status || 'Active',
      route: (draft?.route || '').trim() || 'Available',
    }

    if (!driver?.name || !driver?.pin) return

    if (editingName) await onUpdateDriver(editingName, driver)
    else await onAddDriver(driver)
    resetForm()
  }

  function handleEdit(driver) {
    const selectedDriver = driver || emptyDriver
    setDraft(selectedDriver)
    setEditingName(selectedDriver?.name || '')
  }

  return (
    <section className="single-view">
      <PageHeader eyebrow="Team" title="Drivers" subtitle="Driver cards and PIN placeholders" />
      <form className="form-card driver-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>Name<input value={draft?.name || ''} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Driver name" /></label>
          <label>PIN<input value={draft?.pin || ''} onChange={(event) => updateDraft('pin', event.target.value)} placeholder="Driver PIN" /></label>
          <label>Status<select value={draft.status} onChange={(event) => updateDraft('status', event.target.value)}><option>Active</option><option>Inactive</option></select></label>
          <label>Route<input value={draft?.route || ''} onChange={(event) => updateDraft('route', event.target.value)} placeholder="Route or area" /></label>
        </div>
        <div className="form-actions">
          <button className="secondary-action" type="button" onClick={resetForm}>Clear</button>
          <button className="primary-action" type="submit">{editingName ? 'Save Driver' : 'Add Driver'}</button>
        </div>
      </form>
      <div className="driver-grid">
        {availableDrivers.map((driver, index) => (
          <article className="driver-card" key={driver?.dbId || driver?.name || index}>
            <div className="driver-avatar">{getDriverInitials(driver)}</div>
            <div>
              <h2>{driver?.name || 'Unnamed Driver'}</h2>
              <p>{driver?.route || 'Available'}</p>
            </div>
            <div className="driver-footer">
              <span>{driver?.pin || 'No PIN'}</span>
              <strong className={(driver?.status || 'Active') === 'Active' ? 'active-status' : 'inactive-status'}>{driver?.status || 'Active'}</strong>
            </div>
            <div className="driver-actions">
              <button className="secondary-action" type="button" onClick={() => handleEdit(driver || emptyDriver)}>Edit</button>
              <button className="secondary-action" type="button" onClick={() => onToggleDriver(driver?.name || '')}>{(driver?.status || 'Active') === 'Active' ? 'Set Inactive' : 'Set Active'}</button>
              <button className="danger-action" type="button" onClick={() => onDeleteDriver(driver?.name || '')}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function History({ orders, setSelectedOrder }) {
  const historyOrders = orders.filter((order) => ['Delivered', 'Failed'].includes(order.status))
  return (
    <section className="single-view">
      <PageHeader eyebrow="Archive" title="History" subtitle="Completed and failed deliveries" />
      <div className="order-grid compact">
        {historyOrders.map((order) => <OrderCard key={order.id} order={order} onClick={() => setSelectedOrder(order)} />)}
      </div>
    </section>
  )
}

function Settings({ settings, onSaveSettings }) {
  const [draft, setDraft] = useState(settings || defaultSettings)
  const [message, setMessage] = useState('')

  function updateDraft(field, value) {
    setMessage('')
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const nextSettings = {
      id: draft.id || 1,
      companyName: draft.companyName || 'Gingerbread Delivery',
      officePin: String(draft.officePin || '').trim(),
      companyLogoName: draft.companyLogoName || '',
      archiveDeliveredAfterDays: Number(draft.archiveDeliveredAfterDays) || 7,
      deleteArchivedAfterDays: Number(draft.deleteArchivedAfterDays) || 30,
    }

    if (!nextSettings.officePin) {
      setMessage('Office PIN is required.')
      return
    }

    await onSaveSettings(nextSettings)
    setDraft(nextSettings)
    setMessage('Saved ✓')
  }

  function handleLogoChange(event) {
    const file = event.target.files?.[0]
    updateDraft('companyLogoName', file?.name || '')
  }

  return (
    <section className="single-view">
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="Office settings" />
      <form className="form-card settings-card" onSubmit={handleSubmit}>
        <label>Company Name<input value={draft.companyName || ''} onChange={(event) => updateDraft('companyName', event.target.value)} /></label>
        <label>Office PIN<input value={draft.officePin || ''} onChange={(event) => updateDraft('officePin', event.target.value)} /></label>
        <label>Company Logo upload<input type="file" accept="image/*" onChange={handleLogoChange} /></label>
        {draft.companyLogoName && <Detail label="Selected logo" value={draft.companyLogoName} />}
        <label>Automatically archive delivered orders after X days<input type="number" min="1" value={draft.archiveDeliveredAfterDays || 7} onChange={(event) => updateDraft('archiveDeliveredAfterDays', event.target.value)} /></label>
        <label>Permanently delete archived orders after X days<input type="number" min="1" value={draft.deleteArchivedAfterDays || 30} onChange={(event) => updateDraft('deleteArchivedAfterDays', event.target.value)} /></label>
        {message && <p className="drawer-message saved-message">{message}</p>}
        <button className="primary-action" type="submit">Save Settings</button>
      </form>
    </section>
  )
}

function getDriverInitials(driver) {
  const name = driver?.name || ''
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('') || 'DR'
}

function parseOrdersCsv(csvText, fallbackOrderNumber) {
  const rows = parseCsvRows(csvText).filter((row) => row.some((cell) => cell.trim()))

  if (rows.length < 2) {
    return { orders: [], message: 'Paste or upload CSV rows with a header row first.' }
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  const expectedHeaders = ['order_no', 'customer_name', 'phone', 'address']
  const missingHeaders = expectedHeaders.filter((header) => !headers.includes(header))

  if (missingHeaders.length) {
    return { orders: [], message: 'Missing columns: ' + missingHeaders.join(', ') }
  }

  const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]))
  const fallbackBase = Number(fallbackOrderNumber.replace(/\D/g, '')) || 1000
  const orders = rows.slice(1).map((row, index) => {
    const orderNumber = cellValue(row, headerIndex.order_no) || 'GBD-' + String(fallbackBase + index)
    return {
      id: orderNumber,
      deliveryDate: normalizeLocalDateString(cellValue(row, headerIndex.delivery_date)) || getTodayDate(),
      customer: cellValue(row, headerIndex.customer_name),
      phone: cellValue(row, headerIndex.phone),
      address: cellValue(row, headerIndex.address),
      driver: cellValue(row, headerIndex.driver),
      status: 'New',
      notes: cellValue(row, headerIndex.notes),
      receiver: '',
      failureReason: '',
      proofPhoto: '',
    }
  }).filter((order) => order.customer || order.phone || order.address)

  return {
    orders,
    message: orders.length ? '' : 'No valid order rows found.',
  }
}

function parseCsvRows(csvText) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index]
    const nextChar = csvText[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}

function cellValue(row, index) {
  return String(row[index] || '').trim()
}

function getNextOrderNumber(currentOrders) {
  const highest = currentOrders.reduce((currentHighest, order) => {
    const number = Number(order.id.replace(/\D/g, ''))
    return Number.isFinite(number) ? Math.max(currentHighest, number) : currentHighest
  }, 1000)
  return 'GBD-' + String(highest + 1)
}

export default App
