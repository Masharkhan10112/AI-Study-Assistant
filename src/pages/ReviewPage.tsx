import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Layers } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useCardSchedule, useDecks, useDueCards, useReviewCard, useReviewStats } from "@/hooks/useStudy";
import { useAuth } from "@/providers/AuthProvider";
import { previewIntervals, type Rating } from "@/lib/scheduling";

const RATINGS: { rating: Rating; label: string; className: string }[] = [
  { rating: 1, label: "Again", className: "bg-rose-600 hover:bg-rose-700 text-white" },
  { rating: 2, label: "Hard", className: "bg-amber-500 hover:bg-amber-600 text-white" },
  { rating: 3, label: "Good", className: "bg-brand-600 hover:bg-brand-700 text-white" },
  { rating: 4, label: "Easy", className: "bg-emerald-600 hover:bg-emerald-700 text-white" },
];

export function ReviewPage() {
  const { user } = useAuth();
  const decks = useDecks();
  const [deckId, setDeckId] = useState("");
  const dueCards = useDueCards(deckId || null);
  const stats = useReviewStats();
  const reviewCard = useReviewCard();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const shownAt = useRef(Date.now());

  const queue = dueCards.data ?? [];
  const card = queue[index];
  const cardSchedule = useCardSchedule(card?.card_id);
  const intervals = useMemo(
    () => (cardSchedule.data ? previewIntervals(cardSchedule.data) : null),
    [cardSchedule.data],
  );

  useEffect(() => {
    setIndex(0);
    setRevealed(false);
  }, [deckId]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.card_id, revealed]);

  async function rate(rating: Rating) {
    if (!user || !card || !cardSchedule.data) return;
    await reviewCard.mutateAsync({
      userId: user.id,
      cardId: card.card_id,
      current: cardSchedule.data,
      rating,
      elapsedMs: Date.now() - shownAt.current,
    });
    setRevealed(false);
    setIndex((current) => current + 1);
  }

  return (
    <Page>
      <PageHeader
        title="Review"
        description="Spaced repetition over the cards generated from your material."
        action={
          <Select
            className="w-52"
            value={deckId}
            onChange={(event) => setDeckId(event.target.value)}
            aria-label="Deck"
          >
            <option value="">All decks</option>
            {(decks.data ?? []).map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          </Select>
        }
      />

      <div className="flex flex-wrap gap-2 text-sm text-slate-600">
        <Badge tone="info">{Math.max(0, queue.length - index)} left in this session</Badge>
        <Badge>{stats.data?.reviewedToday ?? 0} reviewed today</Badge>
        {stats.data?.retention !== null && stats.data !== undefined && (
          <Badge tone="success">{stats.data.retention}% retention</Badge>
        )}
      </div>

      <ErrorNotice error={dueCards.error ?? reviewCard.error} />

      {dueCards.isLoading
        ? <LoadingBlock />
        : queue.length === 0
        ? (
          <Card>
            <EmptyState
              icon={<Layers className="h-8 w-8" />}
              title="No cards yet"
              description="Generate flashcards from a document and they land here on a schedule."
              action={<Link to="/library"><Button size="sm">Go to library</Button></Link>}
            />
          </Card>
        )
        : !card
        ? (
          <Card>
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8 text-emerald-500" />}
              title="Session complete"
              description="Everything due right now has been reviewed."
              action={
                <Button size="sm" variant="secondary" onClick={() => dueCards.refetch()}>Check for more</Button>
              }
            />
          </Card>
        )
        : (
          <Card>
            <CardBody className="space-y-6">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{card.deck_name}</span>
                <span className="capitalize">{card.state} · {card.reps} reps</span>
              </div>

              <div className="min-h-[8rem] rounded-lg bg-slate-50 p-5 text-center">
                <p className="whitespace-pre-wrap text-lg font-medium text-slate-900">{card.front}</p>
              </div>

              {revealed
                ? (
                  <div className="min-h-[6rem] rounded-lg border border-slate-200 p-5 text-center">
                    <p className="whitespace-pre-wrap text-base text-slate-700">{card.back}</p>
                  </div>
                )
                : (
                  <Button className="w-full" size="lg" onClick={() => setRevealed(true)}>
                    Show answer
                  </Button>
                )}

              {revealed && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATINGS.map((option) => (
                    <button
                      key={option.rating}
                      type="button"
                      disabled={reviewCard.isPending || !cardSchedule.data}
                      onClick={() => void rate(option.rating)}
                      className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${option.className}`}
                    >
                      {option.label}
                      {intervals && <span className="ml-1 text-xs opacity-80">{intervals[option.rating]}</span>}
                    </button>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}
    </Page>
  );
}
