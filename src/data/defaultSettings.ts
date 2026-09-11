import type { AppSettings, LabelLayoutSettings, ReceiptLayoutSettings, VisualLabelElement, VisualReceiptSection } from '../types';

export const defaultLabelElements: VisualLabelElement[] = [
  { id: 'controlCode', name: 'Control Code', visible: true, x: 8, y: 6, fontSize: 24, fontWeight: 'black', align: 'left', fontFamily: 'sans' },
  { id: 'time', name: 'Time', visible: true, x: 232, y: 10, fontSize: 14, fontWeight: 'normal', align: 'right', fontFamily: 'sans' },
  { id: 'buyer', name: 'Customer Name', visible: true, x: 8, y: 44, fontSize: 15, fontWeight: 'bold', align: 'left', fontFamily: 'sans' },
  { id: 'tag', name: 'Item / Tag', visible: true, x: 8, y: 78, fontSize: 15, fontWeight: 'bold', align: 'left', fontFamily: 'sans' },
  { id: 'price', name: 'Price', visible: true, x: 8, y: 114, fontSize: 18, fontWeight: 'black', align: 'left', prefix: 'P', fontFamily: 'sans' },
  { id: 'qrCode', name: '2D QR Code', visible: true, x: 144, y: 42, width: 88, height: 88, fontSize: 12, fontWeight: 'normal', align: 'center' },
  { id: 'storeName', name: 'Store Name', visible: false, x: 8, y: 4, fontSize: 10, fontWeight: 'bold', align: 'left', fontFamily: 'sans' },
  { id: 'sessionDate', name: 'Session Date', visible: false, x: 232, y: 30, fontSize: 12, fontWeight: 'normal', align: 'right', prefix: '#', fontFamily: 'sans' },
  { id: 'footerText', name: 'Footer Note', visible: false, x: 120, y: 144, fontSize: 10, fontWeight: 'normal', align: 'center', fontFamily: 'sans' },
  { id: 'divider', name: 'Divider Line', visible: false, x: 8, y: 36, width: 224, height: 1, fontSize: 10, fontWeight: 'normal', align: 'left' },
  { id: 'barcode', name: '1D Barcode', visible: false, x: 20, y: 92, width: 200, height: 38, fontSize: 10, fontWeight: 'normal', align: 'center' }
];

export const defaultReceiptSections: VisualReceiptSection[] = [
  { id: 'storeName', name: 'Store Name / Header', visible: true, order: 1, fontSize: 18, fontWeight: 'bold', align: 'center', showDividerBelow: false, paddingY: 4 },
  { id: 'title', name: 'Slip Title (Packing Slip)', visible: true, order: 2, fontSize: 14, fontWeight: 'bold', align: 'center', showDividerBelow: false, paddingY: 2 },
  { id: 'sessionDate', name: 'Session & Date / Time', visible: true, order: 3, fontSize: 11, fontWeight: 'normal', align: 'center', showDividerBelow: true, paddingY: 2 },
  { id: 'buyer', name: 'Customer Handle Banner', visible: true, order: 4, fontSize: 22, fontWeight: 'black', align: 'center', showDividerBelow: false, paddingY: 6 },
  { id: 'status', name: 'Payment Status Badge', visible: true, order: 5, fontSize: 12, fontWeight: 'bold', align: 'center', showDividerBelow: true, paddingY: 2 },
  { id: 'itemsTable', name: 'Items List Table', visible: true, order: 6, fontSize: 12, fontWeight: 'normal', align: 'left', showDividerBelow: true, paddingY: 4 },
  { id: 'totals', name: 'Totals & Balance Due', visible: true, order: 7, fontSize: 15, fontWeight: 'bold', align: 'left', showDividerBelow: true, paddingY: 4 },
  { id: 'qcCheckbox', name: 'QC Verification Checkbox', visible: true, order: 8, fontSize: 11, fontWeight: 'normal', align: 'center', showDividerBelow: false, paddingY: 4 },
  { id: 'paymentDetails', name: 'Payment Accounts / GCash Details', visible: true, order: 9, fontSize: 10, fontWeight: 'normal', align: 'left', showDividerBelow: false, paddingY: 4 },
  { id: 'footer', name: 'Thank You Note & Handle', visible: true, order: 10, fontSize: 11, fontWeight: 'normal', align: 'center', showDividerBelow: false, paddingY: 6 }
];

export const defaultLabelLayout: LabelLayoutSettings = {
  labelSize: '30x20mm',
  protocol: 'escpos', // Standard ESC/POS for PT-265 & 58mm label printers
  renderMode: 'canvas_bitmap', // Pixel-perfect 1-sticker Canvas Graphics (zero wide error, guaranteed 1 sticker)
  paperGuidePosition: 'right', // PT-265 guide pushes roll to right side
  horizontalOffsetMm: 18, // 18mm (~144 dots) right-side offset on 58mm printhead
  verticalOffsetMm: 0,
  gapHeightMm: 2, // Standard 2mm gap between stickers
  printSpeed: 3,
  printDensity: 10,
  showStoreName: false,
  storeNameSize: 'xs',
  showSessionDate: false,
  showTime: true, // Display time on top right (e.g. 13:02) as in reference image
  showControlCode: true,
  codeSize: 'xl', // Bold prominent code on top left (e.g. L0911-002)
  showTag: true, // Item/Tag on line 2 (e.g. Pumice)
  showDescription: false,
  showPrice: true, // Price on line 3 (e.g. P500)
  priceSize: 'lg',
  showBuyer: true, // Buyer name on line 1 (e.g. Screamcheese)
  buyerSize: 'lg',
  showBarcode: false,
  showQrCode: true, // Replace barcode with 2D QR Code on the side
  qrPosition: 'right', // QR on right side, info (name, item, price) on the left side
  qrSize: 'md',
  customFooterText: '',
  footerText: '',
  gapFeedMode: 'gs_ff', // GS FF (0x1D 0x0C) advances PT-265 to the die-cut gap
  extraFeedLines: 0,
  compactSpacing: true,
  customElements: defaultLabelElements
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
  feedLines: 3,
  customSections: defaultReceiptSections
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

