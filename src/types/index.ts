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
