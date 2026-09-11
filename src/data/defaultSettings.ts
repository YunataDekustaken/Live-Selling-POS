import type { AppSettings, LabelLayoutSettings, ReceiptLayoutSettings } from '../types';

export const defaultLabelLayout: LabelLayoutSettings = {
  labelSize: '30x20mm',
  protocol: 'escpos', // ESC/POS with gap advance for PT-265 & 58mm label printers
  renderMode: 'escpos_compact',
  paperGuidePosition: 'right', // PT-265 guide pushes roll to right side
  horizontalOffsetMm: 18, // 18mm (~144 dots) right-side offset on 58mm printhead
  verticalOffsetMm: 0,
  gapHeightMm: 2, // Standard 2mm gap between stickers
  printSpeed: 3,
  printDensity: 10,
  showStoreName: false, // 30x20mm compact sticker: omit store name so content fits in 20mm
  storeNameSize: 'xs',
  showSessionDate: false,
  showTime: false,
  showControlCode: true,
  codeSize: 'lg',
  showTag: false,
  showDescription: true,
  showPrice: true,
  priceSize: 'lg',
  showBuyer: true,
  buyerSize: 'lg',
  showBarcode: false,
  customFooterText: '',
  footerText: '',
  gapFeedMode: 'gs_ff', // GS FF (0x1D 0x0C) advances PT-265 to the die-cut gap
  extraFeedLines: 0,
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

