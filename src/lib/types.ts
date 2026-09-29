// Mirrors the enums and the columns the UI actually reads. Regenerate the full
// database types with `npm run gen:types` when the schema grows.

export type DocumentSource = "pdf" | "docx" | "pptx" | "txt" | "markdown" | "image" | "paste";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type SummaryStyle = "brief" | "detailed" | "outline";
export type CardState = "new" | "learning" | "review" | "relearning";
export type QuestionType = "mcq" | "true_false" | "short_answer";
export type PlanActivity = "read" | "review" | "quiz" | "practice";
export type ChatRole = "user" | "assistant" | "system";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  daily_review_target: number;
  daily_study_minutes_target: number;
  ai_daily_token_cap: number;
}

export interface Subject {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived_at: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  subject_id: string | null;
  title: string;
  source_type: DocumentSource;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number | null;
  page_count: number | null;
  status: DocumentStatus;
  error: string | null;
  ingested_at: string | null;
  created_at: string;
}

export interface Summary {
  id: string;
  document_id: string;
  style: SummaryStyle;
  content_md: string;
  model: string;
  created_at: string;
}

export interface Deck {
  id: string;
  subject_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
}

export interface DueCard {
  card_id: string;
  deck_id: string;
  deck_name: string;
  front: string;
  back: string;
  card_type: "basic" | "cloze";
  state: CardState;
  due_at: string;
  reps: number;
  lapses: number;
}

export interface Quiz {
  id: string;
  subject_id: string | null;
  document_id: string | null;
  title: string;
  difficulty: string;
  created_at: string;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  position: number;
  question_type: QuestionType;
  stem: string;
  options: string[] | null;
  explanation: string | null;
  points: number;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
}

export interface QuizAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  response: string | null;
  is_correct: boolean | null;
  score: number | null;
  feedback: string | null;
}

export interface StudyPlan {
  id: string;
  subject_id: string | null;
  goal: string;
  exam_date: string | null;
  daily_minutes: number;
  created_at: string;
}

export interface PlanItem {
  id: string;
  plan_id: string;
  scheduled_for: string;
  position: number;
  activity: PlanActivity;
  title: string;
  document_id: string | null;
  deck_id: string | null;
  estimated_minutes: number;
  completed_at: string | null;
}

export interface ChatThread {
  id: string;
  subject_id: string | null;
  title: string;
  scope: { document_ids?: string[]; subject_id?: string | null };
  last_message_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

export interface Citation {
  chunk_id: string;
  rank: number;
  snippet: string | null;
}

export interface UsageToday {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
