import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

/**
 * Hook per gestionar push notifications (PWA)
 * - Registra el service worker
 * - Demana permís de notificacions
 * - Envia la subscripció al backend
 */
export default function usePushNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);

    if (supported) {
      // Comprovar si ja tenim subscripció
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        }).catch(() => {});
      }).catch((err) => {
        console.warn('Service Worker no disponible:', err);
        setIsSupported(false);
      });
    }
  }, []);

  /**
   * Demanar permís i subscriure a push
   */
  const subscribe = useCallback(async () => {
    if (!isSupported) return false;
    setLoading(true);

    try {
      // 1. Demanar permís
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setLoading(false);
        return false;
      }

      // 2. Obtenir clau VAPID del backend
      const { data: vapidData } = await api.get('/push/vapid-key');
      const vapidPublicKey = vapidData.publicKey;

      // 3. Subscriure via Push API
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // 4. Enviar subscripció al backend
      await api.post('/push/subscribe', { subscription: subscription.toJSON() });

      setIsSubscribed(true);
      setLoading(false);
      return true;
    } catch (err) {
      console.error('Error subscrivint push:', err);
      setLoading(false);
      return false;
    }
  }, [isSupported]);

  /**
   * Dessubscriure
   */
  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await api.post('/push/unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('Error dessubscrivint push:', err);
    }
    setLoading(false);
  }, [isSupported]);

  /**
   * Enviar notificació de prova
   */
  const sendTest = useCallback(async () => {
    try {
      await api.post('/push/test');
    } catch (err) {
      console.error('Error enviant test push:', err);
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    subscribe,
    unsubscribe,
    sendTest,
  };
}

// =========================================
// Utils
// =========================================

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
