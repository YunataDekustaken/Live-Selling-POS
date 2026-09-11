import type { Profile, MinedItem, PaymentRecord } from '../types';

export const SUPABASE_URL = 'https://vvbsszhgduzqqcciroac.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_slqI77J9z1oz9HO_qBcI6Q_lmqtg8Cx';

let supabaseClient: any = null;

export function getSupabaseClient() {
  if (!supabaseClient && (window as any).supabase && typeof (window as any).supabase.createClient === 'function') {
    try {
      supabaseClient = (window as any).supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false }
      });
    } catch (err) {
      console.error('Supabase client init error:', err);
    }
  }
  return supabaseClient;
}

export async function pushProfileToSupabase(profile: Profile, sequence = 1, sessionDate = '') {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !profile) return;
  try {
    await client.from('business_profiles').upsert([{
      id: profile.id,
      name: profile.name,
      category: profile.category || 'Retail',
      currency: profile.currency || '₱',
      color: profile.color || 'emerald',
      quick_prefixes: profile.quickPrefixes || [],
      default_categories: profile.defaultCategories || [],
      payment_details: profile.paymentDetails || ''
    }]);

    await client.from('customer_notes').upsert([{
      profile_id: profile.id,
      buyer: '__store_meta__',
      notes: JSON.stringify({
        codePrefix: (profile.codePrefix !== undefined && profile.codePrefix !== null && profile.codePrefix !== '') ? profile.codePrefix : '#',
        sequence: sequence,
        sessionDate: sessionDate
      })
    }]);
  } catch (e) {
    console.warn('Supabase profile sync notice:', e);
  }
}

export async function pushActiveProfileToSupabase(id: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !id) return;
  try {
    await client.from('customer_notes').upsert([{
      profile_id: '_meta_',
      buyer: '__last_active_profile__',
      notes: id
    }]);
  } catch (e) {
    console.warn('Supabase active profile sync notice:', e);
  }
}

export async function fetchCloudDeletedProfiles(): Promise<string[]> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return [];
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__deleted_profiles__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      const parsed = JSON.parse(data[0].notes);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.warn('fetchCloudDeletedProfiles error:', e);
  }
  return [];
}

export async function removeDeletedProfileTombstone(id: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !id) return;
  try {
    const existing = await fetchCloudDeletedProfiles();
    if (existing.includes(id)) {
      const updated = existing.filter(item => item !== id);
      await client.from('customer_notes').upsert([{
        profile_id: '_meta_',
        buyer: '__deleted_profiles__',
        notes: JSON.stringify(updated)
      }]);
    }
  } catch (e) {
    console.warn('removeDeletedProfileTombstone error:', e);
  }
}

export async function deleteProfileFromSupabase(id: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !id) return;
  try {
    // 1. Delete all records belonging to this profile
    await client.from('business_profiles').delete().eq('id', id);
    await client.from('mined_items').delete().eq('profile_id', id);
    await client.from('customer_payments').delete().eq('profile_id', id);
    await client.from('customer_notes').delete().eq('profile_id', id);

    // 2. Add to cloud tombstone list so other devices immediately purge this profile too
    const existing = await fetchCloudDeletedProfiles();
    if (!existing.includes(id)) {
      existing.push(id);
      await client.from('customer_notes').upsert([{
        profile_id: '_meta_',
        buyer: '__deleted_profiles__',
        notes: JSON.stringify(existing)
      }]);
    }
  } catch (e) {
    console.warn('Supabase delete profile notice:', e);
  }
}

export async function pushSingleMineToSupabase(mine: MinedItem, activeProfileId: string, sessionDate: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return;
  try {
    const payload: any = {
      id: mine.id,
      profile_id: activeProfileId,
      session_date: mine.date || sessionDate,
      control_code: mine.controlCode,
      tag: mine.description || mine.tag || '',
      price: mine.price,
      buyer: mine.buyer,
      photo: mine.photo || '',
      timestamp: String(mine.timestamp || Date.now())
    };

    const { error: upsertErr } = await client.from('mined_items').upsert([payload]);
    if (upsertErr) {
      // If the mined_items table schema issue, retry without photo
      delete payload.photo;
      await client.from('mined_items').upsert([payload]);
    }
  } catch (e) {
    console.warn('Supabase mine sync notice:', e);
  }
}

export async function fetchCloudDeletedMines(): Promise<string[]> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return [];
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__deleted_mines__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      const parsed = JSON.parse(data[0].notes);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.warn('fetchCloudDeletedMines error:', e);
  }
  return [];
}

export async function deleteSingleMineFromSupabase(mineId: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !mineId) return;
  try {
    // 1. Delete from mined_items table in Supabase
    await client.from('mined_items').delete().eq('id', mineId);
    await client.from('customer_notes').delete().eq('buyer', '__photo_' + mineId);

    // 2. Append to cloud deleted mines tombstone so all other devices purge it on sync
    const existing = await fetchCloudDeletedMines();
    if (!existing.includes(mineId)) {
      const updated = [...existing.slice(-1000), mineId];
      await client.from('customer_notes').upsert([{
        profile_id: '_meta_',
        buyer: '__deleted_mines__',
        notes: JSON.stringify(updated)
      }]);
    }
  } catch (e) {
    console.warn('Supabase delete mine notice:', e);
  }
}

export async function syncR2ConfigToSupabase(configJson: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !configJson) return;
  try {
    await client.from('customer_notes').upsert([{
      profile_id: '_meta_',
      buyer: '__r2_config__',
      notes: configJson
    }]);
  } catch (e) {
    console.warn('Supabase R2 config sync notice:', e);
  }
}

export async function fetchR2ConfigFromSupabase(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return null;
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__r2_config__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      return data[0].notes;
    }
  } catch (e) {
    console.warn('fetchR2ConfigFromSupabase notice:', e);
  }
  return null;
}

export async function syncAppSettingsToSupabase(settingsJson: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !settingsJson) return;
  try {
    await client.from('customer_notes').upsert([{
      profile_id: '_meta_',
      buyer: '__app_settings__',
      notes: settingsJson
    }]);
  } catch (e) {
    console.warn('Supabase app settings sync notice:', e);
  }
}

export async function fetchAppSettingsFromSupabase(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return null;
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__app_settings__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      return data[0].notes;
    }
  } catch (e) {
    console.warn('fetchAppSettingsFromSupabase notice:', e);
  }
  return null;
}

export async function pushSinglePaymentToSupabase(payment: PaymentRecord, activeProfileId: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return;
  try {
    await client.from('customer_payments').upsert([{
      id: payment.id,
      profile_id: activeProfileId,
      buyer: payment.buyer,
      amount: payment.amount,
      method: payment.method,
      reference: payment.ref || '',
      timestamp: String(payment.timestamp || Date.now())
    }]);
  } catch (e) {
    console.warn('Supabase payment sync notice:', e);
  }
}

export async function pushCustomerNoteToSupabase(buyer: string, notes: string, activeProfileId: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return;
  try {
    await client.from('customer_notes').upsert([{
      profile_id: activeProfileId,
      buyer: buyer,
      notes: notes
    }]);
  } catch (e) {
    console.warn('Supabase note sync notice:', e);
  }
}
