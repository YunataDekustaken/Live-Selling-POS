import type { AppSettings } from '../types';

export const defaultSettings: AppSettings = {
  autoPrint: true,
  soundEnabled: true,
  storeName: 'Leaf & Layer',
  paymentDetails: 'GCash: 0917-123-4567 (LiveStyle PH)\nMaya: 0918-987-6543\nBDO: 0012-3456-7890',
  miningFieldsOrder: ['customer', 'description', 'price'],
  syncInterval: '30s',
  printerPaperWidth: '58mm',
  escPosDirectPrint: true
};
