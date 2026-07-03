import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

const initialOrders = [
  {
    id: 'GBD-1048',
    customer: 'Maya Chen',
    phone: '(312) 555-0188',
    address: '1840 W Armitage Ave, Chicago, IL',
    driver: 'Andre Lewis',
    time: 'Today, 9:30 AM',
    status: 'New',
    notes: 'Ring bell twice. Leave with front desk if unavailable.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
    signature: '',
  },
  {
    id: 'GBD-1047',
    customer: 'Owen Patel',
    phone: '(773) 555-0142',
    address: '500 N Michigan Ave, Chicago, IL',
    driver: 'Sofia Rivera',
    time: 'Today, 10:15 AM',
    status: 'Out for Delivery',
    notes: 'Customer requested a call on arrival.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
    signature: '',
  },
  {
    id: 'GBD-1046',
    customer: 'Elena Brooks',
    phone: '(847) 555-0191',
    address: '222 Merchandise Mart Plaza, Chicago, IL',
    driver: 'Marcus Bell',
    time: 'Today, 11:05 AM',
    status: 'Delivered',
    notes: 'Delivered to reception desk.',
    receiver: 'Janet Moore',
    failureReason: '',
    proofPhoto: '',
    signature: '',
  },
  {
    id: 'GBD-1045',
    customer: 'Noah Williams',
    phone: '(708) 555-0165',
    address: '1452 N Wells St, Chicago, IL',
    driver: 'Priya Shah',
    time: 'Yesterday, 4:40 PM',
    status: 'Failed',
    notes: 'No answer. Gate code did not work.',
    receiver: '',
    failureReason: 'No answer at delivery address',
    proofPhoto: '',
    signature: '',
  },
  {
    id: 'GBD-1044',
    customer: 'Ari Kim',
    phone: '(312) 555-0177',
    address: '909 W Randolph St, Chicago, IL',
    driver: 'Andre Lewis',
    time: 'Yesterday, 2:20 PM',
    status: 'Delivered',
    notes: 'Customer met driver outside.',
    receiver: 'Ari Kim',
    failureReason: '',
    proofPhoto: '',
    signature: '',
  },
  {
    id: 'GBD-1043',
    customer: 'Camila Torres',
    phone: '(773) 555-0109',
    address: '320 S Canal St, Chicago, IL',
    driver: 'Sofia Rivera',
    time: 'Tomorrow, 8:45 AM',
    status: 'New',
    notes: 'Fragile package. Keep upright.',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
    signature: '',
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
  { id: 'upload', label: 'Upload Orders', mobile: 'Upload' },
  { id: 'drivers', label: 'Drivers', mobile: 'Drivers' },
  { id: 'history', label: 'History', mobile: 'History' },
  { id: 'settings', label: 'Settings' },
]

const statusOptions = ['All', 'New', 'Out for Delivery', 'Delivered', 'Failed']
const editableStatusOptions = statusOptions.filter((option) => option !== 'All')
const sortOptions = ['Newest First', 'Oldest First', 'Customer A-Z', 'Customer Z-A']

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

function getDeliveryDate(order) {
  return order?.deliveryDate || order?.delivery_date || new Date().toISOString().slice(0, 10)
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
    time: row.delivery_date || 'Imported',
    deliveryDate: row.delivery_date || '',
    status: row.status || 'New',
    notes: row.notes || '',
    receiver: row.receiver_name || '',
    failureReason: row.failed_reason || '',
    proofPhoto: row.proof_photo_url || '',
    signature: row.signature_url || '',
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
    signature_url: order.status === 'Delivered' ? order.signature || '' : '',
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
  const [selectedOrder, setSelectedOrder] = useState(null)

  const safeDrivers = Array.isArray(drivers) ? drivers.filter(Boolean) : []

  useEffect(() => {
    async function loadData() {
      if (!supabase) {
        console.error('Missing Supabase environment variables')
        return
      }

      try {
        const deliveryRows = await loadDeliveries().catch((error) => {
          logSupabaseError('Failed to load deliveries', error)
          return []
        })
        const driverRows = await loadDrivers().catch((error) => {
          logSupabaseError('Failed to load drivers', error)
          return []
        })
        setOrders(deliveryRows)
        setDrivers(driverRows)
      } catch (error) {
        logSupabaseError('Failed to load Supabase data', error)
      }
    }

    loadData()
  }, [])

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
    } catch (error) {
      logSupabaseError('Failed to add order', error)
      throw error
    }
  }

  async function handleAddOrders(previewOrders) {
    try {
      if (!supabase) throw new Error('Missing Supabase environment variables')
      const { data, error } = await supabase
        .from('deliveries')
        .insert(previewOrders.map(mapDeliveryToRow))
        .select('*')

      if (error) throw error
      setOrders((currentOrders) => [...(data || []).map(mapDeliveryFromRow), ...currentOrders])
      setStatus('All')
      setActiveView('orders')
    } catch (error) {
      logSupabaseError('Failed to import orders', error)
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
      setOrders((currentOrders) => currentOrders.map((order) => order.dbId === savedOrder.dbId || order.id === selectedOrder.id ? savedOrder : order))
      setSelectedOrder(savedOrder)
    } catch (error) {
      logSupabaseError('Failed to update order', error)
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
    } catch (error) {
      logSupabaseError('Failed to delete order', error)
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
    } catch (error) {
      logSupabaseError('Failed to add driver', error)
      throw error
    }
  }

  async function handleUpdateDriver(originalName, updatedDriver) {
    if (!supabase) {
      logSupabaseError('Failed to update driver', new Error('Missing Supabase environment variables'))
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
    } catch (error) {
      logSupabaseError('Failed to update driver', error)
      throw error
    }
  }

  async function handleDeleteDriver(driverName) {
    if (!window.confirm('Delete this driver?')) return
    if (!supabase) {
      logSupabaseError('Failed to delete driver', new Error('Missing Supabase environment variables'))
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
    } catch (error) {
      logSupabaseError('Failed to delete driver', error)
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

  const counts = useMemo(() => {
    return statusOptions.reduce((acc, option) => {
      acc[option] = option === 'All' ? orders.length : orders.filter((order) => order.status === option).length
      return acc
    }, {})
  }, [orders])

  const visibleOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return orders
      .filter((order) => status === 'All' || order.status === status)
      .filter((order) => {
        if (!normalized) return true
        return [order.customer, order.phone, order.address, getDriverName(order.driver), order.id].some((value) =>
          value.toLowerCase().includes(normalized),
        )
      })
      .sort((a, b) => {
        if (sort === 'Customer A-Z') return a.customer.localeCompare(b.customer)
        if (sort === 'Customer Z-A') return b.customer.localeCompare(a.customer)
        if (sort === 'Oldest First') return a.id.localeCompare(b.id)
        return b.id.localeCompare(a.id)
      })
  }, [orders, query, status, sort])

  const showDrawer = selectedOrder && (activeView === 'orders' || activeView === 'history')

  return (
    <div className="app-frame">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="main-shell">
        {activeView === 'orders' && (
          <OrdersDashboard
            query={query}
            setQuery={setQuery}
            status={status}
            setStatus={setStatus}
            sort={sort}
            setSort={setSort}
            counts={counts}
            visibleOrders={visibleOrders}
            setSelectedOrder={setSelectedOrder}
          />
        )}
        {activeView === 'add' && <AddOrder drivers={safeDrivers} onAddOrder={handleAddOrder} nextOrderNumber={getNextOrderNumber(orders)} />}
        {activeView === 'upload' && <UploadOrders onAddOrders={handleAddOrders} nextOrderNumber={getNextOrderNumber(orders)} />}
        {activeView === 'drivers' && (
          <Drivers
            drivers={safeDrivers}
            onAddDriver={handleAddDriver}
            onUpdateDriver={handleUpdateDriver}
            onDeleteDriver={handleDeleteDriver}
            onToggleDriver={handleToggleDriver}
          />
        )}
        {activeView === 'history' && <History orders={orders} setSelectedOrder={setSelectedOrder} />}
        {activeView === 'settings' && <Settings />}
      </main>
      {showDrawer && (
        <div className="drawer-layer" aria-label="Order details panel">
          <button className="drawer-scrim" type="button" aria-label="Close details backdrop" onClick={() => setSelectedOrder(null)} />
          <OrderDrawer
            drivers={safeDrivers}
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            onSave={handleSaveOrder}
            onDelete={handleDeleteOrder}
          />
        </div>
      )}
      <MobileNav activeView={activeView} setActiveView={setActiveView} />
    </div>
  )
}

function Sidebar({ activeView, setActiveView }) {
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
      <div className="sidebar-card">
        <span>Today</span>
        <strong>18 stops</strong>
        <p>Routes are staged for dispatch review.</p>
      </div>
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

function OrdersDashboard({ query, setQuery, status, setStatus, sort, setSort, counts, visibleOrders, setSelectedOrder }) {
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
          <OrderCard key={order.id} order={order} onClick={() => setSelectedOrder(order)} />
        ))}
      </div>
    </section>
  )
}

function OrderCard({ order, onClick }) {
  const tone = statusClass[order.status]

  return (
    <button className="order-card" onClick={onClick} type="button">
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
        <span>{getDriverName(order.driver)}</span>
        <strong>{order.time}</strong>
      </div>
      <div className={'status-strip ' + tone}>{order.status}</div>
    </button>
  )
}

function OrderDrawer({ drivers = [], order, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(order)
  const availableDrivers = Array.isArray(drivers) ? drivers : []
  const [saveMessage, setSaveMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const showProofFields = draft.status === 'Delivered'
  const showReceiver = draft.status === 'Delivered'
  const showFailureReason = draft.status === 'Failed'

  function updateDraft(field, value) {
    setValidationMessage('')
    setSaveMessage('')
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (draft.status === 'Delivered' && (!draft.receiver.trim() || !draft.proofPhoto.trim() || !draft.signature.trim())) {
      setValidationMessage('Receiver name, proof photo, and signature are required for delivered orders.')
      return
    }

    if (draft.status === 'Failed' && !draft.failureReason.trim()) {
      setValidationMessage('Failure reason is required for failed orders.')
      return
    }

    await onSave({
      ...draft,
      receiver: showReceiver ? draft.receiver : '',
      failureReason: showFailureReason ? draft.failureReason : '',
      proofPhoto: showProofFields ? draft.proofPhoto : '',
      signature: showProofFields ? draft.signature : '',
    })
    setSaveMessage('Saved ✓')
    window.setTimeout(onClose, 1000)
  }

  function handleOpenMaps() {
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(draft.address)
    window.open(mapsUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <aside className="detail-drawer" aria-label="Edit order">
      <div className="drawer-header">
        <button className="drawer-close" type="button" aria-label="Close order details" onClick={onClose}>X</button>
        <span>Edit order</span>
        <h2>{draft.id || 'New order'}</h2>
        <p>{draft.customer || 'Customer details'}</p>
      </div>
      <form className="drawer-form" onSubmit={handleSubmit}>
        <div className="detail-list edit-list">
          <label>Order Number<input value={draft.id} onChange={(event) => updateDraft('id', event.target.value)} /></label>
          <label>Customer Name<input value={draft.customer} onChange={(event) => updateDraft('customer', event.target.value)} /></label>
          <label>Phone<input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} /></label>
          <label>Address<input value={draft.address} onChange={(event) => updateDraft('address', event.target.value)} /></label>
          <label>Driver<select value={getDriverName(draft.driver)} onChange={(event) => updateDraft('driver', event.target.value)}>{availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index}>{getDriverName(driver)}</option>)}</select></label>
          <label>Status<select value={draft?.status || 'Active'} onChange={(event) => updateDraft('status', event.target.value)}>{editableStatusOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label>Notes<textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows="4" /></label>
          {showReceiver && <label>Receiver Name<input required value={draft.receiver} onChange={(event) => updateDraft('receiver', event.target.value)} /></label>}
          {showProofFields && (
            <div className="delivery-proof-field">
              <span>Proof Photo</span>
              <button className="proof-upload-button" type="button" onClick={() => updateDraft('proofPhoto', 'Proof photo attached')}>
                📷 Take / Upload Proof Photo
              </button>
              {draft.proofPhoto && <p>{draft.proofPhoto}</p>}
            </div>
          )}
          {showProofFields && (
            <div className="signature-field">
              <span>Signature Pad</span>
              <button className="signature-pad" type="button" onClick={() => updateDraft('signature', 'Receiver signature captured')}>
                <strong>{draft.signature || 'Receiver signature'}</strong>
                <small>{draft.signature ? 'Signature captured' : 'Tap to capture signature'}</small>
              </button>
            </div>
          )}
          {showFailureReason && <label>Failure Reason<textarea required value={draft.failureReason} onChange={(event) => updateDraft('failureReason', event.target.value)} rows="3" /></label>}
        </div>
        {validationMessage && <p className="drawer-message error-message">{validationMessage}</p>}
        {saveMessage && <p className="drawer-message saved-message">{saveMessage}</p>}
        <div className="drawer-actions">
          <button className="primary-action" type="submit">Save Changes</button>
          <button className="danger-action" type="button" onClick={onDelete}>Delete Order</button>
          <button className="secondary-action" type="button" onClick={handleOpenMaps}>Open Maps</button>
          <button className="secondary-action" type="button" onClick={onClose}>Close</button>
        </div>
      </form>
    </aside>
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
    driver: getDriverName(availableDrivers[0]),
    time: 'Today, 2:00 PM',
    status: 'New',
    notes: '',
    receiver: '',
    failureReason: '',
    proofPhoto: '',
    signature: '',
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
      receiver: showReceiver ? draft.receiver : '',
      failureReason: showFailureReason ? draft.failureReason : '',
      proofPhoto: showReceiver ? draft.proofPhoto : '',
      signature: showReceiver ? draft.signature : '',
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
          <label>Driver<select value={getDriverName(draft.driver)} onChange={(event) => updateDraft('driver', event.target.value)}>{availableDrivers.map((driver, index) => <option key={driver?.dbId || driver?.name || index}>{getDriverName(driver)}</option>)}</select></label>
          <label>Delivery time<input value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} placeholder="Today, 2:00 PM" /></label>
          <label>Status<select value={draft.status} onChange={(event) => updateDraft('status', event.target.value)}>{editableStatusOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
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

function UploadOrders({ onAddOrders, nextOrderNumber }) {
  const sampleCsv = 'order_no,customer_name,phone,address,driver,notes\nGBD-2001,Maya Chen,(312) 555-0188,1840 W Armitage Ave,Andre Lewis,Call on arrival'
  const [csvText, setCsvText] = useState(sampleCsv)
  const [previewOrders, setPreviewOrders] = useState([])
  const [uploadMessage, setUploadMessage] = useState('')

  function buildPreview(text) {
    const result = parseOrdersCsv(text, nextOrderNumber)
    setPreviewOrders(result.orders)
    setUploadMessage(result.message)
  }

  function handleFileUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setCsvText(text)
      buildPreview(text)
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  async function handleAddPreviewedOrders() {
    if (!previewOrders.length) {
      setUploadMessage('Preview orders before adding them.')
      return
    }

    await onAddOrders(previewOrders)
    setPreviewOrders([])
    setUploadMessage('')
  }

  return (
    <section className="single-view">
      <PageHeader eyebrow="Bulk import" title="Upload Orders" subtitle="Drop a CSV or paste rows for review" />
      <div className="upload-layout">
        <div className="drop-card">
          <span>CSV</span>
          <h2>Upload order file</h2>
          <p>Expected columns: order_no, customer_name, phone, address, driver, notes.</p>
          <label className="file-upload-control">
            <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} />
            <span className="primary-action">Choose File</span>
          </label>
        </div>
        <div className="paste-card">
          <label>Paste CSV rows</label>
          <textarea rows="8" value={csvText} onChange={(event) => setCsvText(event.target.value)} />
          <button className="secondary-action" type="button" onClick={() => buildPreview(csvText)}>Preview Orders</button>
        </div>
      </div>
      <div className="preview-panel">
        <div className="section-heading"><h2>Preview</h2><span>{previewOrders.length} rows ready</span></div>
        {uploadMessage && <p className="upload-message">{uploadMessage}</p>}
        <div className="mini-card-grid">
          {previewOrders.map((order) => <OrderCard key={order.id} order={order} onClick={() => {}} />)}
        </div>
        <button className="primary-action add-preview-action" type="button" onClick={handleAddPreviewedOrders}>Add Previewed Orders</button>
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

function Settings() {
  return (
    <section className="single-view">
      <PageHeader eyebrow="Workspace" title="Settings" subtitle="Mock settings for the first UI version" />
      <div className="form-card settings-card">
        <Detail label="Brand" value="Gingerbread Delivery" />
        <Detail label="Default city" value="Chicago" />
        <Detail label="Notifications" value="Driver updates and failed delivery alerts" />
      </div>
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
  const expectedHeaders = ['order_no', 'customer_name', 'phone', 'address', 'driver', 'notes']
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
      customer: cellValue(row, headerIndex.customer_name),
      phone: cellValue(row, headerIndex.phone),
      address: cellValue(row, headerIndex.address),
      driver: cellValue(row, headerIndex.driver),
      time: 'Imported',
      status: 'New',
      notes: cellValue(row, headerIndex.notes),
      receiver: '',
      failureReason: '',
      proofPhoto: '',
      signature: '',
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
