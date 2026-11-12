// Optional browser checks use an existing Playwright installation, not a new dependency.
// RUN_UI_TESTS=1 PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/ui-layout.test.mjs
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const enabled = process.env.RUN_UI_TESTS === '1'
let server, browser, origin, artifacts
const root = fileURLToPath(new URL('..', import.meta.url))

before(async () => {
  if (!enabled) return
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
  artifacts = await mkdtemp(join(tmpdir(), 'gingerbread-ui-'))
  await mkdir(join(artifacts, 'pdfs'))
  const baseline = execFileSync('git', ['show', 'dcf8869:src/App.jsx'], { cwd: root, encoding: 'utf8' })
  const fixture = {
    name: 'ui-verification-only', enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/').split('?')[0] === resolve(root, 'src/App.jsx').replaceAll('\\', '/')) {
        return (id.includes('label-baseline') ? baseline : code) + '\nexport { Dispatch, buildLabelPrintDocument, getTodayDate };'
      }
    },
    configureServer(vite) {
      vite.middlewares.use('/ui-verification', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/ui-verification', `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {Dispatch,buildLabelPrintDocument,getTodayDate} from '/src/App.jsx';
          import {buildLabelPrintDocument as baselineLabels} from '/src/App.jsx?label-baseline';
          import '/src/index.css';
          window.makeLabels=buildLabelPrintDocument;window.baselineLabels=baselineLabels;
          window.dispatchCalls=[];window.dispatchSucceeds=true;
          const today=getTodayDate(), tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
          const fixtures=Array.from({length:5},(_,i)=>({dbId:'fixture-'+i,id:String(1012+i),customer:'Test Customer '+i,address:'100 Test Street',status:'New',deliveryDate:i<3?today:tomorrow,packageCount:1}));
          function Harness(){
            const [orders,setOrders]=React.useState(fixtures);
            window.removeFixture=id=>setOrders(current=>current.filter(order=>order.dbId!==id));
            return React.createElement(Dispatch,{orders,drivers:[{dbId:'test-driver',name:'Test Driver',status:'Active'}],onDispatchOrders:async(ids,driver,priority,packages)=>{
              window.dispatchCalls.push({ids,driver,priority,packages});
              if(!window.dispatchSucceeds)return false;
              setOrders(current=>current.map(order=>ids.includes(order.dbId)?{...order,status:'Out for Delivery',driver}:order));return true;
            }});
          }
          createRoot(document.getElementById('root')).render(React.createElement(Harness));
        </script>`))
      })
    },
  }
  server = await createServer({ root, configFile: false, envDir: false, plugins: [fixture, react()],
    define: { 'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined' },
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  origin = 'http://127.0.0.1:' + server.httpServer.address().port
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  console.log('UI verification artifacts: ' + artifacts)
})
after(async () => { await browser?.close(); await server?.close() })

test('Dispatch counter follows selection, visible Select All, stale rows, failure and success on desktop/mobile', { skip: !enabled }, async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    await page.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort())
    await page.goto(origin + '/ui-verification')
    const counter = async (text) => page.waitForFunction((expected) => document.querySelector('.dispatch-selection-count')?.textContent === expected, text)
    await counter('0 orders selected.')
    const checkbox = (index) => page.locator('.dispatch-row input[type="checkbox"]').nth(index)
    await checkbox(0).check(); await counter('1 order selected.')
    await checkbox(1).check(); await counter('2 orders selected.')
    await checkbox(0).uncheck(); await counter('1 order selected.')
    await page.locator('.dispatch-select-all input').check(); await counter('3 orders selected.')
    await page.locator('.dispatch-select-all input').uncheck(); await counter('0 orders selected.')
    await page.locator('.dispatch-group-heading').nth(1).click()
    await page.locator('.dispatch-select-all input').check(); await counter('5 orders selected.')
    await page.locator('.dispatch-group-heading').nth(1).click(); await counter('5 orders selected.')
    await page.locator('.dispatch-group-heading').nth(1).click()
    await page.locator('.dispatch-select-all input').uncheck(); await counter('0 orders selected.')
    await checkbox(0).check(); await checkbox(1).check(); await counter('2 orders selected.')
    const bounds = await page.locator('.dispatch-selection-count').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(artifacts, 'dispatch-' + viewport.width + '.png'), fullPage: true })
    await page.evaluate(() => window.dispatchSucceeds = false)
    await page.locator('.dispatch-toolbar select').selectOption('Test Driver')
    await page.getByRole('button', { name: 'Send Out for Delivery', exact: true }).click()
    await counter('2 orders selected.')
    await page.evaluate(() => window.removeFixture('fixture-0')); await counter('1 order selected.')
    await page.evaluate(() => window.dispatchSucceeds = true)
    await page.getByRole('button', { name: 'Send Out for Delivery', exact: true }).click()
    await counter('0 orders selected.')
    assert.equal(await page.getByRole('button', { name: 'Send Out for Delivery', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.dispatchCalls.at(-1).driver), 'Test Driver')
    assert.deepEqual(await page.evaluate(() => window.dispatchCalls.at(-1).packages), { 'fixture-0': 1, 'fixture-1': 1 })
    await page.close()
  }
})

test('actual-size print labels preserve normal text placement and fit long numbers inside the outline', { skip: !enabled }, async () => {
  const fixture = await browser.newPage()
  await fixture.goto(origin + '/ui-verification')
  await fixture.waitForFunction(() => Boolean(window.makeLabels && window.baselineLabels))
  const orders = [
    { id: '1012', customer: 'Test Customer', address: '100 Test Street', phone: '732-555-0100', deliveryDate: '2026-07-08', packageCount: 1 },
    { id: '123456789012345678901234', customer: 'Test Customer', address: '100 Test Street', phone: '732-555-0100', deliveryDate: '2026-07-08', packageCount: 3 },
    { id: '987654321098765432109876543210', customer: 'A Longer Test Customer Name', address: '12345 Long Test Avenue Apartment 123', phone: '732-555-0100', deliveryDate: '2026-07-08', packageCount: 1 },
  ]
  const html = await fixture.evaluate((data) => window.makeLabels(data), orders)
  const baseline = await fixture.evaluate((data) => window.baselineLabels(data), [orders[0]])
  async function printPage(content) {
    const page = await browser.newPage()
    await page.emulateMedia({ media: 'print' })
    await page.setContent(content)
    await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
    return page
  }
  const page = await printPage(html), original = await printPage(baseline)
  const metrics = (target) => target.locator('.zebra-label').first().evaluate((label) => {
    const result = {}
    for (const name of ['kicker', 'date', 'order-number', 'customer', 'address', 'phone']) {
      const element = label.querySelector('.label-' + name), range = document.createRange()
      range.selectNodeContents(element)
      const bounds = range.getBoundingClientRect()
      result[name] = { x: bounds.x, y: bounds.y, size: parseFloat(getComputedStyle(element).fontSize) }
    }
    return result
  })
  const before = await metrics(original), after = await metrics(page)
  for (const name of Object.keys(before)) for (const value of ['x', 'y', 'size']) {
    assert.ok(Math.abs(before[name][value] - after[name][value]) < 0.1, name + ' ' + value + ' changed')
  }
  assert.equal(await page.locator('.zebra-label').count(), 5)
  for (const label of await page.locator('.zebra-label').all()) {
    const result = await label.evaluate((element) => {
      const number = element.querySelector('.label-order-number'), block = element.querySelector('.label-order-block'), date = element.querySelector('.label-date')
      const bounds = element.getBoundingClientRect(), box = block.getBoundingClientRect(), dateBounds = date.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, fits: number.scrollWidth <= number.clientWidth + 1,
        noOverlap: box.right + 1 <= dateBounds.left, outline: getComputedStyle(block).outlineWidth,
        labelFits: element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth,
        customerBelowDate: element.querySelector('.label-customer').getBoundingClientRect().top >= dateBounds.bottom - 1 }
    })
    assert.deepEqual(result, { width: 216, height: 120, fits: true, noOverlap: true, outline: '1px', labelFits: true, customerBelowDate: true })
  }
  await page.pdf({ path: join(artifacts, 'pdfs/zebra-labels.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
  await page.screenshot({ path: join(artifacts, 'print-layout.png'), fullPage: true })
  await original.close(); await page.close(); await fixture.close()
})

test('deployed app shows both fixes using isolated mock orders with no production writes', { skip: !enabled || !process.env.UI_LIVE_URL }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const deliveries = Array.from({ length: 3 }, (_, index) => ({ id: 'live-fixture-' + index,
    order_no: String(1012 + index), customer_name: 'Test Customer ' + index, phone: '732-555-0100',
    address: '100 Test Street', status: 'New', delivery_date: today, package_count: 1,
    created_at: today + 'T12:00:00Z', driver: '', priority: 'Normal' }))
  let updates = 0
  await context.routeWebSocket('**', (socket) => socket.close())
  await context.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').at(-1)
    let data
    if (table === 'settings') data = { id: 'main', company_name: 'Gingerbread Delivery', office_pin: 'review-only', archive_after_days: 7, delete_after_days: 30 }
    else if (table === 'drivers') data = [{ id: 'driver-fixture', name: 'Test Driver', pin: 'test-driver', active: true }]
    else if (table === 'deliveries') {
      if (request.method() === 'PATCH') {
        const order = deliveries.find((item) => 'eq.' + item.id === url.searchParams.get('id'))
        assert.ok(order)
        Object.assign(order, request.postDataJSON()); updates++; data = order
      } else data = deliveries
    } else throw new Error('Unexpected Supabase request in isolated production UI test')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await context.addInitScript(() => {
    window.confirm = () => false
    window.print = () => {}
    window.close = () => {}
  })
  const page = await context.newPage()
  await page.goto(process.env.UI_LIVE_URL)
  await page.getByRole('button', { name: 'Login', exact: true }).waitFor()
  await page.getByRole('textbox', { name: /office pin/i }).fill('review-only')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.locator('.nav-stack').getByRole('button', { name: 'Dispatch', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dispatch-selection-count')?.textContent === '0 orders selected.')
  await page.locator('.dispatch-select-all input').check()
  await page.waitForFunction(() => document.querySelector('.dispatch-selection-count')?.textContent === '3 orders selected.')
  await page.locator('.dispatch-toolbar select').selectOption('Test Driver')
  await page.getByRole('button', { name: 'Send Out for Delivery', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dispatch-selection-count')?.textContent === '0 orders selected.')
  assert.equal(updates, 3)
  await page.locator('.nav-stack').getByRole('button', { name: 'All Orders', exact: true }).click()
  await page.locator('.order-card').first().click()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Print Slip', exact: true }).click()
  const popup = await popupPromise
  await popup.locator('.label-order-block').waitFor()
  assert.equal(await popup.locator('.zebra-label').count(), 1)
  assert.equal(await popup.locator('.label-order-block').evaluate((element) => getComputedStyle(element).outlineWidth), '1px')
  await popup.emulateMedia({ media: 'print' })
  await popup.pdf({ path: join(artifacts, 'pdfs/live-label.pdf'), preferCSSPageSize: true, displayHeaderFooter: false })
  await context.close()
})
