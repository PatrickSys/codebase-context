import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { CartStore } from '../cart/cart.store';

@Component({
  selector: 'app-checkout',
  imports: [CurrencyPipe],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.css',
})
export class CheckoutComponent {
  readonly store = inject(CartStore);
  readonly lines = computed(() => this.store.cart());
  readonly total = this.store.total;
}
