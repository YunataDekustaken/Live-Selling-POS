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
      timestamp: String(mine.timestamp || Date.now())
    };

    // Save item details to mined_items table
    const { error: upsertErr } = await client.from('mined_items').upsert([payload]);
    if (upsertErr) {
      console.warn('mined_items upsert notice:', upsertErr);
    }

    // Persist photo to customer_notes table (using __photo_{mineId} key for cross-device cloud sync)
    if (mine.photo && mine.photo.trim() !== '') {
      await pushSinglePhotoToSupabase(mine.id, mine.photo, activeProfileId);
    } else {
      await deleteSinglePhotoFromSupabase(mine.id, activeProfileId);
    }
  } catch (e) {
    console.warn('Supabase mine sync notice:', e);
  }
}

export async function pushSinglePhotoToSupabase(mineId: string, photo: string, activeProfileId: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !mineId || !activeProfileId) return;
  try {
    if (photo && photo.trim() !== '') {
      await client.from('customer_notes').upsert([{
        profile_id: activeProfileId,
        buyer: '__photo_' + mineId,
        notes: photo
      }]);
    } else {
      await deleteSinglePhotoFromSupabase(mineId, activeProfileId);
    }
  } catch (e) {
    console.warn('pushSinglePhotoToSupabase error:', e);
  }
}

export async function deleteSinglePhotoFromSupabase(mineId: string, activeProfileId?: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !mineId) return;
  try {
    let query = client.from('customer_notes').delete().eq('buyer', '__photo_' + mineId);
    if (activeProfileId) {
      query = query.eq('profile_id', activeProfileId);
    }
    await query;
  } catch (e) {
    console.warn('deleteSinglePhotoFromSupabase error:', e);
  }
}

export async function fetchCloudPhotosForProfile(profileId: string): Promise<Record<string, string>> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !profileId) return {};
  try {
    let query = client
      .from('customer_notes')
      .select('buyer, notes')
      .eq('profile_id', profileId);

    if (typeof query.like === 'function') {
      query = query.like('buyer', '__photo_%');
    }

    const { data, error } = await query;

    if (error) {
      console.warn('fetchCloudPhotosForProfile notice:', error);
      return {};
    }

    const photoMap: Record<string, string> = {};
    if (data && Array.isArray(data)) {
      for (const row of data) {
        if (row.buyer && row.buyer.startsWith('__photo_') && row.notes) {
          const mineId = row.buyer.substring('__photo_'.length);
          photoMap[mineId] = row.notes;
        }
      }
    }
    return photoMap;
  } catch (e) {
    console.warn('fetchCloudPhotosForProfile error:', e);
    return {};
  }
}

export async function batchPushPhotosToSupabase(photos: Array<{ mineId: string; photo: string }>, activeProfileId: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !photos.length || !activeProfileId) return;
  try {
    const valid = photos.filter(p => p.photo && p.photo.trim() !== '');
    // Process in batches of 5 to keep payloads lightweight and performant
    for (let i = 0; i < valid.length; i += 5) {
      const chunk = valid.slice(i, i + 5).map(p => ({
        profile_id: activeProfileId,
        buyer: '__photo_' + p.mineId,
        notes: p.photo
      }));
      await client.from('customer_notes').upsert(chunk);
    }
  } catch (e) {
    console.warn('batchPushPhotosToSupabase error:', e);
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

export async function syncLabelProfilesToSupabase(profilesJson: string) {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !profilesJson) return;
  try {
    await client.from('customer_notes').upsert([{
      profile_id: '_meta_',
      buyer: '__saved_label_profiles__',
      notes: profilesJson
    }]);
  } catch (e) {
    console.warn('Supabase label profiles sync notice:', e);
  }
}

export async function fetchLabelProfilesFromSupabase(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return null;
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__saved_label_profiles__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      return data[0].notes;
    }
  } catch (e) {
    console.warn('fetchLabelProfilesFromSupabase notice:', e);
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

export async function syncSecurityPinToSupabase(pin: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine || !pin) return false;
  try {
    const { error } = await client.from('customer_notes').upsert([{
      profile_id: '_meta_',
      buyer: '__security_pin__',
      notes: pin.trim()
    }]);
    if (error) {
      console.warn('Supabase security pin sync notice:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('Supabase security pin sync exception:', e);
    return false;
  }
}

export async function fetchSecurityPinFromSupabase(): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) return null;
  try {
    const { data, error } = await client
      .from('customer_notes')
      .select('notes')
      .eq('profile_id', '_meta_')
      .eq('buyer', '__security_pin__')
      .limit(1);
    if (!error && data && data.length > 0 && data[0].notes) {
      const pin = data[0].notes.trim();
      return pin || null;
    }
  } catch (e) {
    console.warn('fetchSecurityPinFromSupabase notice:', e);
  }
  return null;
}
