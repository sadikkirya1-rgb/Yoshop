export function resetActiveOrdersCart(activeOrders = {}, cartId = 'SHOP_CART') {
  if (!activeOrders || typeof activeOrders !== 'object' || Array.isArray(activeOrders)) {
    return {};
  }

  const nextState = {};
  Object.entries(activeOrders).forEach(([key, value]) => {
    if (key === cartId) return;
    nextState[key] = value;
  });

  return nextState;
}
