import { AppMount } from "./mount";

export default { title: "Apps/Books", component: AppMount, args: { id: "books" } };
export const Empty = {}; // alts: add named exports with { args: { initialData } }

// Ishta owned, opens on Library (§14j). Phrase: STORYBOOK_ISHTA_PHRASE in the fork's gitignored local env file; without it only the free half reads.
export const Owned = { args: { initialData: { own: { slug: "ishta", phrase: import.meta.env.STORYBOOK_ISHTA_PHRASE } } } };
