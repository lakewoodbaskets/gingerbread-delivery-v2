export async function sendDeliveredSMS(order) {
  console.log('SMS would be sent', {
    customer_name: order?.customer_name || '',
    phone: order?.phone || '',
    order_no: order?.order_no || '',
    driver: order?.driver || '',
    delivered_time: order?.delivered_time || '',
  })
}
