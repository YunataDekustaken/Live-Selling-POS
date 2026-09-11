import type { AppSettings, LabelLayoutSettings, ReceiptLayoutSettings } from '../types';

export const defaultLabelLayout: LabelLayoutSettings = {
  labelSize: '30x20mm',
  protocol: 'escpos_gap',
  showStoreName: false, // 30x20mm compact sticker: disable store name by default to maximize item & buyer readability
  showSessionDate: false,
  showTime: false,
  showControlCode: true,
  codeSize: 'large',
  showTag: false,
  showDescription: true,
  showPrice: true,
  priceSize: 'large',
  showBuyer: true,
  buyerSize: 'large',
  showBarcode: false,
  customFooterText: '',
  gapFeedMode: 'gs_ff',
  feedLines: 0,
  compactSpacing: true
};

export const defaultReceiptLayout: ReceiptLayoutSettings = {
  paperWidth: '58mm',
  showStoreName: true,
  showTitle: true,
  showSessionDate: true,
  showDateTime: true,
  showBuyerName: true,
  showPaymentStatus: true,
  showItemNumber: true,
  showItemTag: true,
  showItemDescription: true,
  showDividers: true,
  showItemCount: true,
  showSubtotal: true,
  showTotalPaid: true,
  showBalanceDue: true,
  showPaymentAccounts: true,
  showQcCheckbox: true,
  customFooterNote: 'Thank you for mining with us!',
  feedLines: 3
};

export const defaultSettings: AppSettings = {
  autoPrint: true,
  soundEnabled: true,
  storeName: 'Leaf & Layer',
  paymentDetails: 'GCash: 0917-123-4567 (LiveStyle PH)\nMaya: 0918-987-6543\nBDO: 0012-3456-7890',
  miningFieldsOrder: ['customer', 'description', 'price'],
  syncInterval: '30s',
  printerPaperWidth: '58mm',
  escPosDirectPrint: true,
  photoRetention: '6_months',
  autoCleanOldPhotos: false,
  labelLayout: defaultLabelLayout,
  receiptLayout: defaultReceiptLayout,
  receiptPrinterName: 'PT-210',
  labelPrinterName: 'PT-265',
  activePrinterType: 'auto'
};

