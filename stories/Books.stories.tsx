import { AppMount } from "./mount";
import { BookCheckoutForm, saveDraft } from "@/apps/books/components/BookCheckoutForm";
import type { GhostBook } from "@/lib/ghost";

export default { title: "Apps/Books", component: AppMount, args: { id: "books" } };
export const Empty = {}; // alts: add named exports with { args: { initialData } }

// Ishta owned, opens on Library (§14j). Phrase: STORYBOOK_ISHTA_PHRASE in the fork's gitignored local env file; without it only the free half reads.
export const Owned = { args: { initialData: { own: { slug: "ishta", phrase: import.meta.env.STORYBOOK_ISHTA_PHRASE } } } };

// §14l: the checkout sheet alone; its saved draft is seeded with a made-up gift. Nothing posts until Go to Payment is pressed.
const sampleSale = {
  book: { id: "sample", slug: "sample-book", title: "Ishta Book", url: "/ishta/", feature_image: null, tags: [], html: "", custom_excerpt: "A short novel about a house that remembers everyone who lived in it." } as unknown as GhostBook,
  price: "$24",
  draft: "sample",
  owned: false,
};
export const BuyForm = {
  render: () => {
    saveDraft(sampleSale.book.slug, { qty: "1", gift: true, name: "Ada Lovelace", line1: "12 Marylebone Rd", line2: "Apt 4", city: "Brooklyn", state: "NY", zip: "11201", message: "Happy birthday — this one made me think of you.", email: "ada@example.com" });
    return <BookCheckoutForm sale={sampleSale} open onOpenChange={() => {}} />;
  },
};
