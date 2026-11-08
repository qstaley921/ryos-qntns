import { journalText, type JournalFragment } from "../sampleContent";

// Read-only: a #home-content post as paragraphs.
export function JournalEntryEditor({ fragment, language }: { fragment: JournalFragment; language: string }) {
  const text = fragment.text ? journalText(fragment.text, language) : "";
  return (
    <div className="font-os-ui text-base leading-relaxed select-text">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="my-1 whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}
