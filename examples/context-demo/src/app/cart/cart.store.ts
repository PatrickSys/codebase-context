import { computed, Injectable, signal } from '@angular/core';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
}

export interface CartLine extends Product {
  quantity: number;
}

@Injectable({ providedIn: 'root' })
export class CartStore {
  readonly products: readonly Product[] = [
    {
      id: 'canvas-tote',
      name: 'Canvas Tote',
      description: 'A sturdy carry-all for market mornings and everyday errands.',
      price: 24,
    },
    {
      id: 'stoneware-mug',
      name: 'Stoneware Mug',
      description: 'A hand-finished mug made for slow coffee and long reads.',
      price: 18,
    },
    {
      id: 'linen-napkins',
      name: 'Linen Napkins',
      description: 'Soft, washable linen for dinners that turn into evenings.',
      price: 32,
    },
  ];

  readonly cart = signal<CartLine[]>([]);
  readonly total = computed(() =>
    this.cart().reduce((sum, line) => sum + line.price * line.quantity, 0),
  );

  addToCart(productId: string): void {
    const product = this.products.find((item) => item.id === productId);
    if (!product) return;

    this.cart.update((lines) => {
      const existingLine = lines.find((line) => line.id === productId);
      if (existingLine) {
        return lines.map((line) =>
          line.id === productId ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }

      return [...lines, { ...product, quantity: 1 }];
    });
  }

  removeFromCart(productId: string): void {
    this.cart.update((lines) => lines.filter((line) => line.id !== productId));
  }
}
