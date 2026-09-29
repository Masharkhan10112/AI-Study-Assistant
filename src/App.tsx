import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { SignInPage } from "@/pages/SignInPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { DocumentPage } from "@/pages/DocumentPage";
import { TutorPage } from "@/pages/TutorPage";
import { ReviewPage } from "@/pages/ReviewPage";
import { QuizzesPage } from "@/pages/QuizzesPage";
import { QuizRunPage } from "@/pages/QuizRunPage";
import { PlanPage } from "@/pages/PlanPage";
import { SettingsPage } from "@/pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:documentId" element={<DocumentPage />} />
          <Route path="tutor" element={<TutorPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="quizzes" element={<QuizzesPage />} />
          <Route path="quizzes/:quizId" element={<QuizRunPage />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
