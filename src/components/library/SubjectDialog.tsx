import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { useCreateSubject } from "@/hooks/useSubjects";
import { cn } from "@/lib/utils";

const COLORS = ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2"];

export function SubjectDialog({ open, onClose, userId }: { open: boolean; onClose(): void; userId: string }) {
  const createSubject = useCreateSubject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await createSubject.mutateAsync({ name: name.trim(), description, color, userId });
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New subject"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="subject-form" loading={createSubject.isPending} disabled={!name.trim()}>
            Create subject
          </Button>
        </>
      }
    >
      <form id="subject-form" onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Discrete Mathematics"
          required
        />
        <Textarea
          label="Description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional"
        />
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(value)}
                aria-label={`Use colour ${value}`}
                aria-pressed={color === value}
                style={{ backgroundColor: value }}
                className={cn(
                  "h-8 w-8 rounded-full ring-offset-2 transition",
                  color === value ? "ring-2 ring-slate-900" : "ring-0",
                )}
              />
            ))}
          </div>
        </div>
        <ErrorNotice error={createSubject.error} />
      </form>
    </Modal>
  );
}
