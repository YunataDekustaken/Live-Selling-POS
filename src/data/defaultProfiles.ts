import type { Profile } from '../types';

export const defaultProfiles: Profile[] = [
  {
    id: 'prof_main',
    name: 'Leaf & Layer',
    category: 'Fashion & Apparel',
    currency: '₱',
    codePrefix: '#',
    color: 'emerald',
    quickPrefixes: ['A', 'B', 'C', 'D', 'VIP'],
    defaultCategories: ['Plant', 'Pot', 'Pumice'],
    paymentDetails: 'GCash: 0917-123-4567 (LiveStyle PH)\nMaya: 0918-987-6543\nBDO: 0012-3456-7890'
  },
  {
    id: 'prof_crystals',
    name: 'Aura Crystals & Stones',
    category: 'Crystals & Minerals',
    currency: '₱',
    codePrefix: 'CR',
    color: 'purple',
    quickPrefixes: ['CR', 'RAW', 'BR', 'TUM', 'SPEC'],
    defaultCategories: ['Raw Cluster', 'Tower/Point', 'Sphere', 'Bracelet', 'Pocket Stone'],
    paymentDetails: 'GCash: 0917-888-9999 (Aura Crystals)\nMaya: 0918-777-6666\nBPI: 1234-5678-90'
  },
  {
    id: 'prof_1788794471662',
    name: 'Joyful Surplus',
    category: 'General Retail',
    currency: '₱',
    codePrefix: '#',
    color: 'rose',
    quickPrefixes: ['A', 'B', 'C', 'D', 'VIP'],
    defaultCategories: ['Tops', 'Dresses', 'Bottoms', 'Jackets', 'Accessories'],
    paymentDetails: 'GCash: 09XX-XXX-XXXX\nMaya: 09XX-XXX-XXXX'
  },
  {
    id: 'prof_collectibles',
    name: 'Retro Treasures & Toys',
    category: 'Collectibles & Toys',
    currency: '₱',
    codePrefix: 'TOY',
    color: 'amber',
    quickPrefixes: ['TOY', 'FIG', 'PLUSH', 'CARD', 'RETRO'],
    defaultCategories: ['Action Figure', 'Plushie', 'Trading Cards', 'Vinyl Toy', 'Vintage'],
    paymentDetails: 'GCash: 0919-555-4321 (Retro Toys)\nUnionBank: 1098-7654-3210'
  }
];
