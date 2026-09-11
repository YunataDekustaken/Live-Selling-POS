export interface Profile {
  id: string;
  name: string;
  category: string;
  currency: string;
  codePrefix?: string;
  color: string;
  quickPrefixes: string[];
  defaultCategories: string[];
  paymentDetails: string;
}

export interface MinedItem {
  id: string;
  controlCode: string;
  controlNum?: number;
  tag: string;
  description: string;
  price: number;
  buyer: string;
  photo?: string;
  date?: string;
  time?: string;
  timestamp?: number;
}

export interface PaymentRecord {
  id: string;
  buyer: string;
  amount: number;
  method: string;
  ref?: string;
  date?: string;
  time?: string;
  timestamp?: number;
}

export interface BuyerBasket {
  handle: string;
  displayName: string;
  items: MinedItem[];
  payments: PaymentRecord[];
  totalAmount: number;
  totalPaid: number;
  balance: number;
  status: 'Paid' | 'Unpaid' | 'Partial' | 'Credit';
  dateIssued?: string;
  paymentDate?: string;
  isExpanded?: boolean;
}

export interface LabelLayoutSettings {
  labelSize: '30x20mm' | '40x30mm' | '50x30mm' | '58mm_roll' | string;
  protocol: 'escpos' | 'tspl' | string;
  renderMode?: 'tspl_vector' | 'canvas_bitmap' | 'escpos_compact' | string;
  paperGuidePosition?: 'right' | 'center' | 'left' | 'custom' | string;
  horizontalOffsetMm?: number; // Offset in mm (e.g. 18mm for right-side guide on 58mm printer)
  verticalOffsetMm?: number; // Offset in mm (-2 to +5)
  gapHeightMm?: number; // Gap in mm (typically 2mm or 3mm)
  printSpeed?: number; // 2, 3, 4, 5
  printDensity?: number; // 8 to 15
  showStoreName?: boolean;
  storeNameSize?: 'xs' | 'sm' | string;
  showSessionDate?: boolean;
  showTime?: boolean;
  showControlCode?: boolean;
  codeSize?: 'md' | 'lg' | 'xl' | 'normal' | 'large' | 'extra_large' | string;
  showTag?: boolean;
  showDescription?: boolean;
  showPrice?: boolean;
  priceSize?: 'md' | 'lg' | 'normal' | 'large' | string;
  showBuyer?: boolean;
  buyerSize?: 'md' | 'lg' | 'normal' | 'large' | string;
  showBarcode?: boolean;
  showQrCode?: boolean;
  qrPosition?: 'right' | 'left';
  qrSize?: 'sm' | 'md' | 'lg';
  customFooterText?: string;
  footerText?: string;
  gapFeedMode?: 'gs_ff' | 'form_feed' | 'feed_lines' | 'none' | string;
  extraFeedLines?: number; // 0, 1, 2, 3
  compactSpacing?: boolean;
}

export interface ReceiptLayoutSettings {
  paperWidth: '58mm' | '80mm';
  showStoreName: boolean;
  showTitle: boolean;
  showSessionDate: boolean;
  showDateTime: boolean;
  showBuyerName: boolean;
  showPaymentStatus: boolean;
  showItemNumber: boolean;
  showItemTag: boolean;
  showItemDescription: boolean;
  showDividers: boolean;
  showItemCount: boolean;
  showSubtotal: boolean;
  showTotalPaid: boolean;
  showBalanceDue: boolean;
  showPaymentAccounts: boolean;
  showQcCheckbox: boolean;
  customFooterNote: string;
  feedLines: number;
}

export interface AppSettings {
  autoPrint: boolean;
  soundEnabled: boolean;
  storeName: string;
  paymentDetails: string;
  miningFieldsOrder: string[];
  syncInterval: string;
  printerPaperWidth?: '58mm' | '80mm';
  escPosDirectPrint?: boolean;
  photoRetention?: '1_month' | '3_months' | '6_months' | '1_year' | 'never';
  autoCleanOldPhotos?: boolean;
  labelLayout?: LabelLayoutSettings;
  receiptLayout?: ReceiptLayoutSettings;
  receiptPrinterName?: string;
  labelPrinterName?: string;
  activePrinterType?: 'receipt_pt210' | 'label_pt265' | 'auto';
}

export interface ActiveStoreForm {
  id: string;
  name: string;
  category: string;
  currency: string;
  codePrefix: string;
  color: string;
  quickPrefixesText: string;
  defaultCategoriesText: string;
  paymentDetails: string;
}

export interface LiveMiningForm {
  tag: string;
  description: string;
  price: string | number;
  buyer: string;
  photo: string;
}
