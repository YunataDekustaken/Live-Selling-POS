/**
 * Lightweight, Resilient Supabase REST Client
 * Tailored for offline-first Web POS with zero web worker or WebSocket failure modes.
 */
(function (global) {
  'use strict';

  function createClient(supabaseUrl, supabaseKey, options) {
    const cleanUrl = (supabaseUrl || '').replace(/\/+$/, '');
    const apiKey = supabaseKey || '';
    const defaultHeaders = {
      'apikey': apiKey,
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    };

    function safeFetch(endpoint, fetchOptions = {}) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return Promise.resolve({
          data: null,
          error: new Error('Network offline')
        });
      }

      const url = cleanUrl + '/rest/v1/' + endpoint;
      const headers = { ...defaultHeaders, ...(fetchOptions.headers || {}) };

      return fetch(url, { ...fetchOptions, headers })
        .then(async (res) => {
          let json = null;
          try {
            const text = await res.text();
            json = text ? JSON.parse(text) : null;
          } catch (e) {
            json = null;
          }

          if (!res.ok) {
            return {
              data: null,
              error: json || new Error(`Supabase HTTP ${res.status}: ${res.statusText}`)
            };
          }
          return { data: json, error: null };
        })
        .catch((err) => {
          return { data: null, error: err };
        });
    }

    class QueryBuilder {
      constructor(table) {
        this.table = table;
        this._method = 'GET';
        this._params = new URLSearchParams();
        this._headers = {};
        this._body = null;
      }

      select(cols = '*') {
        this._method = 'GET';
        this._params.set('select', cols);
        return this;
      }

      eq(col, val) {
        this._params.set(col, 'eq.' + String(val));
        return this;
      }

      neq(col, val) {
        this._params.set(col, 'neq.' + String(val));
        return this;
      }

      like(col, pattern) {
        this._params.set(col, 'like.' + String(pattern));
        return this;
      }

      ilike(col, pattern) {
        this._params.set(col, 'ilike.' + String(pattern));
        return this;
      }

      in(col, values) {
        const valStr = Array.isArray(values) ? values.map(v => `"${v}"`).join(',') : String(values);
        this._params.set(col, 'in.(' + valStr + ')');
        return this;
      }

      is(col, val) {
        this._params.set(col, 'is.' + String(val));
        return this;
      }

      order(col, { ascending = true } = {}) {
        this._params.set('order', col + '.' + (ascending ? 'asc' : 'desc'));
        return this;
      }

      limit(n) {
        this._params.set('limit', String(n));
        return this;
      }

      upsert(values, opts = {}) {
        this._method = 'POST';
        this._headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
        this._body = JSON.stringify(Array.isArray(values) ? values : [values]);
        return this;
      }

      insert(values) {
        this._method = 'POST';
        this._headers['Prefer'] = 'return=representation';
        this._body = JSON.stringify(Array.isArray(values) ? values : [values]);
        return this;
      }

      update(values) {
        this._method = 'PATCH';
        this._headers['Prefer'] = 'return=representation';
        this._body = JSON.stringify(values);
        return this;
      }

      delete() {
        this._method = 'DELETE';
        this._headers['Prefer'] = 'return=representation';
        return this;
      }

      then(onFulfilled, onRejected) {
        const queryString = this._params.toString();
        const endpoint = this.table + (queryString ? '?' + queryString : '');
        const fetchOptions = {
          method: this._method,
          headers: this._headers
        };
        if (this._body && this._method !== 'GET' && this._method !== 'HEAD') {
          fetchOptions.body = this._body;
        }

        return safeFetch(endpoint, fetchOptions).then(onFulfilled, onRejected);
      }
    }

    return {
      supabaseUrl: cleanUrl,
      supabaseKey: apiKey,
      from: function (table) {
        return new QueryBuilder(table);
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null })
      }
    };
  }

  const supabase = {
    createClient: createClient
  };

  global.supabase = supabase;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = supabase;
  }
})(typeof window !== 'undefined' ? window : globalThis);
