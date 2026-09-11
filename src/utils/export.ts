import type { BuyerBasket, MinedItem } from '../types';

export function exportNotionCustomerBalancesCsv(
  buyerBasketsList: BuyerBasket[],
  customerNotes: Record<string, string>,
  sessionDate: string
): void {
  if (!buyerBasketsList || buyerBasketsList.length === 0) {
    return;
  }
  const headers = ['Customer', 'Date Issued', 'Total Amount', 'Payment Amount', 'Payment Date', 'Balance', 'Status', 'Comment'];
  const rows = buyerBasketsList.map(b => {
    const comment = customerNotes[b.handle] || '';
    return [
      `"${b.displayName || b.handle}"`,
      `"${b.dateIssued || ''}"`,
      b.totalAmount.toFixed(2),
      b.totalPaid.toFixed(2),
      `"${b.paymentDate || ''}"`,
      b.balance.toFixed(2),
      `"${b.status}"`,
      `"${comment.replace(/"/g, '""')}"`
    ];
  });
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Notion_Customer_Balances_${sessionDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportNotionMinedItemsCsv(
  allMines: MinedItem[],
  sessionDate: string
): void {
  if (!allMines || allMines.length === 0) {
    return;
  }
  const headers = ['Control #', 'Customer', 'Date', 'Item Name', 'Amount'];
  const rows = allMines.map(item => {
    const num = item.controlNum ? item.controlNum : item.controlCode;
    const itemName = (item.description && item.description !== item.controlCode && item.description !== 'Decor') ? item.description : '';
    return [
      num,
      `"${item.buyer}"`,
      `"${item.date || sessionDate} ${item.time || ''}"`,
      `"${itemName}"`,
      item.price.toFixed(2)
    ];
  });
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Notion_Invoices_Mined_Items_${sessionDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportRawMinesCsv(
  allMines: MinedItem[],
  sessionDate: string
): void {
  if (!allMines || allMines.length === 0) {
    return;
  }
  const headers = ['Control Number', 'Customer Name', 'Item Name', 'Price', 'Date', 'Time'];
  const rows = allMines.map(m => {
    const itemName = (m.description && m.description !== m.controlCode && m.description !== 'Decor') ? m.description : '';
    return [
      `"${m.controlCode}"`,
      `"${m.buyer}"`,
      `"${itemName}"`,
      m.price,
      `"${m.date || ''}"`,
      `"${m.time || ''}"`
    ];
  });
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Live_POS_Mines_${sessionDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
