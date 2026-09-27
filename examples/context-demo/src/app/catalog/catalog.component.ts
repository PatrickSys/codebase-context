import { CurrencyPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { CartStore } from '../cart/cart.store';

@Component({
  selector: 'app-catalog',
  imports: [CurrencyPipe],
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.css',
})
export class CatalogComponent {
  readonly store = inject(CartStore);
}
