import { CartStore } from './cart.store';

describe('CartStore', () => {
  it('removes a cart line without removing the catalog product', () => {
    const store = new CartStore();

    store.addToCart('canvas-tote');
    expect(store.total()).toBe(24);

    store.removeFromCart('canvas-tote');

    expect(store.cart()).toEqual([]);
    expect(store.total()).toBe(0);
    expect(store.products.some((product) => product.id === 'canvas-tote')).toBe(true);
  });
});
