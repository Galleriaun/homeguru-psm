import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PropertiesListPage } from '@/pages/properties/PropertiesListPage';
import { PropertyDetailPage } from '@/pages/properties/PropertyDetailPage';
import { PropertyFormPage } from '@/pages/properties/PropertyFormPage';
import { UnitFormPage } from '@/pages/properties/UnitFormPage';
import { GuestsListPage } from '@/pages/guests/GuestsListPage';
import { GuestDetailPage } from '@/pages/guests/GuestDetailPage';
import { GuestFormPage } from '@/pages/guests/GuestFormPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Properties */}
          <Route path="/properties" element={<PropertiesListPage />} />
          <Route
            path="/properties/new"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                <PropertyFormPage />
              </ProtectedRoute>
            }
          />
          <Route path="/properties/:id" element={<PropertyDetailPage />} />
          <Route
            path="/properties/:id/edit"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                <PropertyFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/properties/:id/units/new"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PROPERTY_MANAGER']}>
                <UnitFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/properties/:id/units/:unitId/edit"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PROPERTY_MANAGER']}>
                <UnitFormPage />
              </ProtectedRoute>
            }
          />

          {/* Guests */}
          <Route path="/guests" element={<GuestsListPage />} />
          <Route
            path="/guests/new"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION']}>
                <GuestFormPage />
              </ProtectedRoute>
            }
          />
          <Route path="/guests/:id" element={<GuestDetailPage />} />
          <Route
            path="/guests/:id/edit"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION']}>
                <GuestFormPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
