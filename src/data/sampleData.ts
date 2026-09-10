import type { MinedItem, PaymentRecord } from '../types';

export const samplePhotos = {
  decor1: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23f43f5e"/><stop offset="100%" stop-color="%23881337"/></linearGradient></defs><rect width="400" height="400" fill="url(%23g1)"/><circle cx="200" cy="180" r="80" fill="%23fff" fill-opacity="0.15"/><polygon points="200,90 280,180 200,270 120,180" fill="%23fff" fill-opacity="0.9"/><text x="200" y="320" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">Rose Crystal Decor</text><text x="200" y="350" font-family="monospace" font-size="14" fill="%23fecdd3" text-anchor="middle">Tag: B02 • %E2%82%B120</text></svg>',
  decor2: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2306b6d4"/><stop offset="100%" stop-color="%230e7490"/></linearGradient></defs><rect width="400" height="400" fill="url(%23g2)"/><polygon points="200,80 300,160 250,280 150,280 100,160" fill="%23fff" fill-opacity="0.9"/><text x="200" y="320" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">Amethyst Figurine</text><text x="200" y="350" font-family="monospace" font-size="14" fill="%23cffafe" text-anchor="middle">Tag: A15 • %E2%82%B120</text></svg>',
  dress: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="gd" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%239333ea"/><stop offset="100%" stop-color="%234c1d95"/></linearGradient></defs><rect width="400" height="400" fill="url(%23gd)"/><path d="M160,80 L240,80 L270,160 L230,170 L280,300 L120,300 L170,170 L130,160 Z" fill="%23ffffff" fill-opacity="0.95"/><text x="200" y="335" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">Satin Evening Dress</text><text x="200" y="365" font-family="monospace" font-size="14" fill="%23e9d5ff" text-anchor="middle">Tag: D01 • %E2%82%B1350</text></svg>',
  top: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="gt" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%233b82f6"/><stop offset="100%" stop-color="%231e3a8a"/></linearGradient></defs><rect width="400" height="400" fill="url(%23gt)"/><path d="M130,100 L170,70 L230,70 L270,100 L300,160 L260,180 L250,150 L250,290 L150,290 L150,150 L140,180 L100,160 Z" fill="%23ffffff" fill-opacity="0.95"/><text x="200" y="335" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">Cropped Cotton Top</text><text x="200" y="365" font-family="monospace" font-size="14" fill="%23dbeafe" text-anchor="middle">Tag: T04 • %E2%82%B1150</text></svg>',
  pants: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="gp" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2310b981"/><stop offset="100%" stop-color="%23064e3b"/></linearGradient></defs><rect width="400" height="400" fill="url(%23gp)"/><path d="M140,80 L260,80 L270,290 L215,290 L200,180 L185,290 L130,290 Z" fill="%23ffffff" fill-opacity="0.95"/><text x="200" y="335" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">High-Waist Trousers</text><text x="200" y="365" font-family="monospace" font-size="14" fill="%23d1fae5" text-anchor="middle">Tag: P08 • %E2%82%B1250</text></svg>',
  bag: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="gb" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23f59e0b"/><stop offset="100%" stop-color="%2378350f"/></linearGradient></defs><rect width="400" height="400" fill="url(%23gb)"/><rect x="130" y="140" width="140" height="130" rx="20" fill="%23ffffff" fill-opacity="0.95"/><path d="M160,140 C160,95 240,95 240,140" fill="none" stroke="%23ffffff" stroke-width="12" stroke-linecap="round"/><text x="200" y="335" font-family="sans-serif" font-size="22" font-weight="bold" fill="%23ffffff" text-anchor="middle">Leather Shoulder Bag</text><text x="200" y="365" font-family="monospace" font-size="14" fill="%23fef3c7" text-anchor="middle">Tag: B09 • %E2%82%B1400</text></svg>'
};

export function getSampleMines(sessionDate: string): MinedItem[] {
  const d = sessionDate || '0907';
  return [
    { id: 'm1', controlCode: `L${d}-001`, controlNum: 1, tag: 'L0907-001', description: 'Decor', price: 20, buyer: 'Edna T', photo: samplePhotos.decor1, date: 'September 7, 2026', time: '19:42', timestamp: Date.now() - 3600000 },
    { id: 'm2', controlCode: `L${d}-002`, controlNum: 2, tag: 'L0907-002', description: 'Decor', price: 20, buyer: 'Belinda Re V', photo: samplePhotos.decor2, date: 'September 7, 2026', time: '19:45', timestamp: Date.now() - 3400000 },
    { id: 'm3', controlCode: `L${d}-003`, controlNum: 3, tag: 'L0907-003', description: 'Dress', price: 350, buyer: 'Maria Cruz', photo: samplePhotos.dress, date: 'September 7, 2026', time: '19:50', timestamp: Date.now() - 3100000 },
    { id: 'm4', controlCode: `L${d}-004`, controlNum: 4, tag: 'L0907-004', description: 'Top', price: 150, buyer: 'Edna T', photo: samplePhotos.top, date: 'September 7, 2026', time: '19:55', timestamp: Date.now() - 2800000 },
    { id: 'm5', controlCode: `L${d}-005`, controlNum: 5, tag: 'L0907-005', description: 'Pants', price: 250, buyer: 'Belinda Re V', photo: samplePhotos.pants, date: 'September 7, 2026', time: '20:02', timestamp: Date.now() - 2400000 },
    { id: 'm6', controlCode: `L${d}-006`, controlNum: 6, tag: 'L0907-006', description: 'Bag', price: 400, buyer: 'Jenny K', photo: samplePhotos.bag, date: 'September 7, 2026', time: '20:10', timestamp: Date.now() - 1900000 },
    { id: 'm7', controlCode: `L${d}-007`, controlNum: 7, tag: 'L0907-007', description: 'Decor', price: 20, buyer: 'Jenny K', photo: samplePhotos.decor1, date: 'September 7, 2026', time: '20:15', timestamp: Date.now() - 1200000 }
  ];
}

export function getSamplePayments(): PaymentRecord[] {
  return [
    { id: 'p1', buyer: 'Edna T', amount: 170, method: 'GCash', ref: 'Ref 8820491', date: 'August 4, 2026', time: '20:20', timestamp: Date.now() - 900000 },
    { id: 'p2', buyer: 'Belinda Re V', amount: 100, method: 'GCash', ref: 'Ref 993182', date: 'August 4, 2026', time: '20:25', timestamp: Date.now() - 600000 }
  ];
}

export const sampleCustomerNotes: Record<string, string> = {
  'Edna T': 'Paid in full via GCash. Ship tomorrow via J&T.',
  'Belinda Re V': 'Partial payment ₱100. Remaining balance ₱170 pending.',
  'Maria Cruz': 'Mined satin evening dress. Sent checkout invoice link with photo.',
  'Jenny K': 'Mined 2 items. Sent Messenger invoice; waiting for payment screenshot.'
};
