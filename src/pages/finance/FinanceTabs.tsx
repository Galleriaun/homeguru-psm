import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    // Soft tinted active state (matches ReservationsViewTabs) so it doesn't fight
    // with the primary indigo CTAs on the page.
    isActive
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
  );

function CashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="5"
        width="15"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 2.5h10v15l-2.5-1.5L10 17l-2.5-1L5 17.5v-15z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M7.5 7h5M7.5 10h5M7.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="14" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 17c0-2.2 1.5-4 4-4s2 0 2 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FinanceTabs() {
  return (
    <div className="flex gap-2">
      <NavLink to="/finance/staff" className={tabClass}>
        <PeopleIcon />
        Personel
      </NavLink>
      <NavLink to="/finance/expenses" className={tabClass}>
        <ReceiptIcon />
        Giderler
      </NavLink>
      <NavLink to="/finance/cash" className={tabClass}>
        <CashIcon />
        Kasalar
      </NavLink>
    </div>
  );
}
