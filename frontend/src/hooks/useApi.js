import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

/**
 * Hook genèric per fer crides a l'API amb estat de loading/error.
 *
 * Opcions:
 *   refetchOnFocus  → refetch quan la finestra recupera el focus (default false)
 *   refetchOnVisible → refetch quan la pestanya torna a ser visible (default false)
 */
export function useApiGet(url, params = {}, opts = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { refetchOnFocus = false, refetchOnVisible = false } = opts;

  const fetch = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: result } = await api.get(url, { params });
      setData(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Error de connexió');
    } finally {
      setLoading(false);
    }
  }, [url, JSON.stringify(params)]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!refetchOnFocus && !refetchOnVisible) return;
    const onFocus = () => fetch();
    const onVisible = () => { if (document.visibilityState === 'visible') fetch(); };
    if (refetchOnFocus) window.addEventListener('focus', onFocus);
    if (refetchOnVisible) document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (refetchOnFocus) window.removeEventListener('focus', onFocus);
      if (refetchOnVisible) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetch, refetchOnFocus, refetchOnVisible]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Hook per fer mutacions (POST, PUT, DELETE)
 */
export function useApiMutation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = async (method, url, body) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api[method](url, body);
      return data;
    } catch (err) {
      const msg = err.response?.data?.error || 'Error de connexió';
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}
