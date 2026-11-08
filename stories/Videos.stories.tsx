import { AppMount } from "./mount";

export default { title: "Apps/Videos", component: AppMount, args: { id: "videos" } };
export const Empty = {}; // playlist loads from the Ghost video posts on mount
