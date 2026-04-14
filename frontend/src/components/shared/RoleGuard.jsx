import { Navigate } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import { canAccessSection } from '../../lib/permissions';

/**
 * Component que protegeix una ruta segons el rol de l'usuari.
 * Si l'usuari no té permís per veure la secció, el redirigeix al dashboard.
 */
export default function RoleGuard({ section, children }) {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  if (!canAccessSection(user.role, section)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
