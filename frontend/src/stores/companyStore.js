import { create } from 'zustand';
import api from '../lib/api';

const useCompanyStore = create((set, get) => ({
  name: 'Admin',
  legalName: '',
  appName: 'Admin',
  loaded: false,

  fetchCompany: async () => {
    if (get().loaded) return;
    try {
      const { data } = await api.get('/config/company');
      set({
        name: data.name || 'Admin',
        legalName: data.legalName || '',
        appName: data.appName || 'Admin',
        loaded: true,
      });
    } catch {
      // Fallback — no bloquegem l'app
      set({ loaded: true });
    }
  },
}));

export default useCompanyStore;
