/*
 * QNTNs goal embeds, ported for the Dashboard widgets (CHECKLIST-37 §25).
 * From assets/js/qntns/goal-embed.js: same GET /goals/<name>, same 4s
 * timeout, same empty shapes, so a failed read draws the "-" render silently.
 * One host, one name: the widget mounts it, so there is no page scan.
 * Dropped: feedback (not a widget) and stewardship (StewardshipTreemap, §18).
 * Added: mastery (the meditation doc in the traits view) and fund
 * (fund.js's own GET /fund and POST /fund/checkout, as on the theme).
 */
import { WORKER } from "../../constants.js";
import { attachMasteryPreview } from "./goal-mastery.js";
import { renderProjects, attachProjects } from "./goal-projects.js";
import { attachSavings } from "./goal-savings.js";
import { attachFriends } from "./goal-friends.js";
import { attachMood } from "./goal-mood.js";
import { attachSpending } from "./goal-spending.js";
import { attachFund, fundState, renderFund } from "./fund.js";

const TIMEOUT_MS = 4000;

const meditation = { doc: "meditation", empty: { sessions: {} } };
const GOALS = {
    meditation: { ...meditation, attach: (host, d) => attachMasteryPreview(host, d.sessions ?? {}, d.traits ?? [], { log: d.log ?? [] }) },
    mastery: { ...meditation, attach: (host, d) => attachMasteryPreview(host, d.sessions ?? {}, d.traits ?? [], { log: d.log ?? [], view: "traits" }) },
    projects: {
        empty: [],
        attach: (host, d) => {
            host.innerHTML = renderProjects(Array.isArray(d) ? d : []);
            attachProjects(host);
        },
    },
    savings: { empty: { entries: [] }, attach: (host, d) => attachSavings(host, d.entries ?? []) },
    friends: { empty: { counts: {} }, attach: (host, d) => attachFriends(host, d.counts ?? {}) },
    mood: { empty: { entries: [] }, attach: (host, d) => attachMood(host, d.entries ?? []) },
    spending: { empty: { rows: [] }, attach: (host, d) => attachSpending(host, d.rows ?? []) },
    // The unknown render (dashes) until fund.js's own GET /fund answers.
    fund: {
        noData: true,
        empty: null,
        attach: (host) => {
            host.innerHTML = renderFund(fundState([]), { unknown: true });
            return attachFund(host);
        },
    },
};

const fetchGoal = async (name) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${WORKER}/goals/${name}`, { signal: abort.signal });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

// Resolves to a teardown (fund's listeners) or undefined. Never rejects. `alive` false after the fetch (widget removed) skips the paint.
export const attachGoal = async (host, name, alive = () => true) => {
    const goal = GOALS[name];
    if (!goal) return undefined;
    const data = goal.noData ? null : await fetchGoal(goal.doc ?? name);
    if (!alive()) return undefined;
    try {
        return goal.attach(host, data ?? goal.empty);
    } catch {
        try {
            return goal.attach(host, goal.empty);
        } catch {
            return undefined;
        }
    }
};
