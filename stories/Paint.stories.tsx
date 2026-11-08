import { AppMount } from "./mount";

export default { title: "Apps/Paint", component: AppMount, args: { id: "paint" } };
export const Empty = {}; // Misc.
// §24: opened from a doc whose slug is a wall page.
export const Drawings = { args: { initialData: { ghost: { slug: "drawings" } } } };
