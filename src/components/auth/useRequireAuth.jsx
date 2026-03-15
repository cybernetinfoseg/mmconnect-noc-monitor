import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook that checks if the user is authenticated and optionally if they are admin.
 * Redirects to login if not authenticated.
 * Returns { user, loading }
 */
export function useRequireAuth({ adminOnly = false } = {}) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me()
      .then(u => {
        setUser(u);
        setLoading(false);
        if (!u) {
          base44.auth.redirectToLogin(window.location.href);
        } else if (adminOnly && u.role !== 'admin') {
          base44.auth.redirectToLogin(window.location.href);
        }
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
        base44.auth.redirectToLogin(window.location.href);
      });
  }, [adminOnly]);

  return { user, loading };
}