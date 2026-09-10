export function formatCurrency(amount: number, symbol = '₱'): string {
  return `${symbol}${amount.toLocaleString()}`;
}

export function getStatusText(balance: number): string {
  if (balance > 0) return 'UNPAID / OWING';
  if (balance < 0) return 'OVERPAID / CREDIT';
  return 'FULLY SETTLED';
}

export function getStatusBadgeClass(balance: number): string {
  if (balance > 0) return 'bg-rose-50 text-rose-700 border-rose-200';
  if (balance < 0) return 'bg-purple-50 text-purple-700 border-purple-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

export function getBalanceColorClass(balance: number): string {
  if (balance > 0) return 'text-rose-600';
  if (balance < 0) return 'text-purple-600';
  return 'text-emerald-600';
}

export function getProfileDotClass(color: string): string {
  const map: Record<string, string> = {
    emerald: 'bg-emerald-500',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    indigo: 'bg-indigo-500',
    teal: 'bg-teal-500',
    zinc: 'bg-zinc-600'
  };
  return map[color] || 'bg-zinc-800';
}

export function getProfileBadgeClass(color: string): string {
  const map: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    purple: 'bg-purple-50 text-purple-800 border-purple-200',
    amber: 'bg-amber-50 text-amber-900 border-amber-200',
    rose: 'bg-rose-50 text-rose-800 border-rose-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    teal: 'bg-teal-50 text-teal-800 border-teal-200',
    zinc: 'bg-zinc-100 text-zinc-800 border-zinc-200'
  };
  return map[color] || 'bg-zinc-100 text-zinc-800 border-zinc-200';
}
