import { Component } from '@angular/core';
import { CatalogComponent } from './catalog/catalog.component';
import { CheckoutComponent } from './checkout/checkout.component';

@Component({
  selector: 'app-root',
  imports: [CatalogComponent, CheckoutComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
