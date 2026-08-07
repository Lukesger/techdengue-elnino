import { useEffect, useState } from 'react';

const DEMO_TOKEN = 'elnino-demo-token-local';

/**
 * Auth stub do monorepo: injeta JWT demo no localStorage para o proxy.
 */
export function useAuth() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const existing = localStorage.getItem('techdengue_token');
    if (!existing || existing === 'undefined' || existing === 'null') {
      localStorage.setItem('techdengue_token', DEMO_TOKEN);
    }
    setReady(true);
  }, []);

  return {
    isAuthenticated: ready,
    isHydrated: ready,
    isLoading: !ready,
    user: {
      id: 1,
      email: 'elnino-demo@local',
      nome: 'El Niño Demo',
      isGlobal: true,
    },
    logout: () => {
      localStorage.removeItem('techdengue_token');
    },
  };
}
