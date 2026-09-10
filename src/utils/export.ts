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
  const headers = ['Control #', 'Customer', 'Date', 'Description', 'Amount', 'Tag'];
  const rows = allMines.map(item => {
    const num = item.controlNum ? item.controlNum : item.controlCode;
    return [
      num,
      `"${item.buyer}"`,
      `"${item.date || sessionDate} ${item.time || ''}"`,
      `"${item.description || 'Decor'}"`,
      item.price.toFixed(2),
      `"${item.tag}"`
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
  const headers = ['Control Code', 'Tag', 'Description', 'Price', 'Buyer', 'Date', 'Time'];
  const rows = allMines.map(m => [
    `"${m.controlCode}"`,
    `"${m.tag}"`,
    `"${m.description || ''}"`,
    m.price,
    `"${m.buyer}"`,
    `"${m.date || ''}"`,
    `"${m.time || ''}"`
  ]);
  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Live_POS_Mines_${sessionDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
