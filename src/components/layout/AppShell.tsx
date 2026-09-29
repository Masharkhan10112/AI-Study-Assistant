import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BookOpen,
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  Layers,
  ListChecks,
  LogOut,
  type LucideIcon,
  Menu,
  MessagesSquare,
  Settings,
  X,
} from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/hooks/useProfile";
import { useDocumentStatusStream } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/tutor", label: "Tutor", icon: MessagesSquare },
  { to: "/review", label: "Review", icon: Layers },
  { to: "/quizzes", label: "Quizzes", icon: ListChecks },
  { to: "/plan", label: "Plan", icon: CalendarCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  useDocumentStatusStream(user?.id);

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="flex h-full bg-slate-50">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform",
          "lg:static lg:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4">
          <span className="flex items-center gap-2 font-semibold text-slate-900">
            <GraduationCap className="h-6 w-6 text-brand-600" aria-hidden />
            Study Assistant
          </span>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {(profile?.full_name || profile?.email || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{profile?.full_name || "Student"}</p>
              <p className="truncate text-xs text-slate-500">{profile?.email ?? user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-2 font-semibold text-slate-900">
            <GraduationCap className="h-5 w-5 text-brand-600" aria-hidden />
            Study Assistant
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">{children}</div>;
}
