import type { MinedItem, BuyerBasket } from '../types';

export function printThermalSticker(item: MinedItem): void {
  window.print();
}

export function printPackingSlip(basket: BuyerBasket): void {
  window.print();
}

export function printInvoice(basket: BuyerBasket): void {
  window.print();
}
