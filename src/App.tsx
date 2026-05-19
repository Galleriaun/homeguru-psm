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
import { ReservationsListPage } from '@/pages/reservations/ReservationsListPage';
import { ReservationsCalendarPage } from '@/pages/reservations/ReservationsCalendarPage';
import { ReservationsAvailabilityPage } from '@/pages/reservations/ReservationsAvailabilityPage';
import { ReservationDetailPage } from '@/pages/reservations/ReservationDetailPage';
import { ReservationFormPage } from '@/pages/reservations/ReservationFormPage';
import { CashAccountsListPage } from '@/pages/finance/CashAccountsListPage';
import { CashAccountFormPage } from '@/pages/finance/CashAccountFormPage';
import { CashAccountDetailPage } from '@/pages/finance/CashAccountDetailPage';
import { ExpensesListPage } from '@/pages/finance/ExpensesListPage';
import { ExpenseFormPage } from '@/pages/finance/ExpenseFormPage';
import { PendingPaymentsPage } from '@/pages/finance/PendingPaymentsPage';
import { HousekeepingPage } from '@/pages/housekeeping/HousekeepingPage';
import { StaffListPage } from '@/pages/finance/StaffListPage';
import { StaffDetailPage } from '@/pages/finance/StaffDetailPage';
import { TemplatesPage } from '@/pages/settings/TemplatesPage';
import { TrashPage } from '@/pages/settings/TrashPage';
import { AuditLogPage } from '@/pages/settings/AuditLogPage';

const RESERVATION_WRITERS = ['SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION'] as const;
const GUEST_WRITERS = ['SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION'] as const;
const FINANCE_ACCESS = ['SUPER_ADMIN', 'PROPERTY_MANAGER'] as const;
const HOUSEKEEPING_ACCESS = ['SUPER_ADMIN', 'PROPERTY_MANAGER', 'HOUSEKEEPING'] as const;

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
              <ProtectedRoute allowedRoles={[...GUEST_WRITERS]}>
                <GuestFormPage />
              </ProtectedRoute>
            }
          />
          <Route path="/guests/:id" element={<GuestDetailPage />} />
          <Route
            path="/guests/:id/edit"
            element={
              <ProtectedRoute allowedRoles={[...GUEST_WRITERS]}>
                <GuestFormPage />
              </ProtectedRoute>
            }
          />

          {/* Reservations */}
          <Route path="/reservations" element={<ReservationsListPage />} />
          <Route path="/reservations/calendar" element={<ReservationsCalendarPage />} />
          <Route path="/reservations/availability" element={<ReservationsAvailabilityPage />} />
          <Route
            path="/reservations/new"
            element={
              <ProtectedRoute allowedRoles={[...RESERVATION_WRITERS]}>
                <ReservationFormPage />
              </ProtectedRoute>
            }
          />
          <Route path="/reservations/:id" element={<ReservationDetailPage />} />
          <Route
            path="/reservations/:id/edit"
            element={
              <ProtectedRoute allowedRoles={[...RESERVATION_WRITERS]}>
                <ReservationFormPage />
              </ProtectedRoute>
            }
          />

          {/* Finance — Cash accounts (Phase 2A). Reception/Housekeeping are RLS-blocked anyway. */}
          <Route
            path="/finance/cash"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <CashAccountsListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/cash/new"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <CashAccountFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/cash/:id"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <CashAccountDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/cash/:id/edit"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <CashAccountFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/expenses"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <ExpensesListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/expenses/new"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <ExpenseFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/expenses/:id/edit"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <ExpenseFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/staff"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <StaffListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/staff/:userId"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <StaffDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Payment approvals queue (Phase 3C-lite) — managers approve/dispute housekeeping-collected payments */}
          <Route
            path="/finance/pending"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <PendingPaymentsPage />
              </ProtectedRoute>
            }
          />

          {/* Housekeeping (Phase 3A) — visible to housekeeping role + managers + admins */}
          <Route
            path="/housekeeping"
            element={
              <ProtectedRoute allowedRoles={[...HOUSEKEEPING_ACCESS]}>
                <HousekeepingPage />
              </ProtectedRoute>
            }
          />

          {/* WhatsApp message templates (Phase 3D) — managers + admins manage; all roles can READ via RLS to use in modals */}
          <Route
            path="/settings/templates"
            element={
              <ProtectedRoute allowedRoles={[...FINANCE_ACCESS]}>
                <TemplatesPage />
              </ProtectedRoute>
            }
          />

          {/* Çöp Kutusu — recoverable deletes (SUPER_ADMIN only; RLS-gated server-side too) */}
          <Route
            path="/settings/trash"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                <TrashPage />
              </ProtectedRoute>
            }
          />

          {/* Denetim Kaydı — read-only audit log (SUPER_ADMIN only; RLS also allows PROPERTY_MANAGER but UI restricts further) */}
          <Route
            path="/settings/audit"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                <AuditLogPage />
              </ProtectedRoute>
            }
          />

        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
