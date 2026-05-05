import { Navigate } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import { canAccessSection } from '../../lib/permissions';

/**
 * Component que protegeix una ruta segons el rol de l'usuari.
 * Si l'usuari no té permís per veure la secció, el redirigeix al dashboard.
 *
 * Props:
 *   - section: string  → comprova canAccessSection(user, section)
 *   - adminOnly: bool  → exigeix role === 'ADMIN'
 *   (es poden combinar; calen totes les condicions especificades)
 */
export default function RoleGuard({ section, adminOnly, children }) {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  if (adminOnly && user.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  if (section && !canAccessSection(user, section)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
