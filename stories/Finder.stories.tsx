import { AppMount } from "./mount";

export default { title: "Apps/Finder", component: AppMount, args: { id: "finder" } };
export const Empty = {}; // alts: add named exports with { args: { initialData } }
export const Poems = { args: { initialData: { path: "/Poems" } } };
export const Recents = { args: { initialData: { path: "/Recents" } } };
