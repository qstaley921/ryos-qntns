import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { addDays, todayKey } from "./fund.js";
import { rampColor } from "./ramp.js";
import { playClick } from "./sound.js";

/*
 * QNTNs projects — "Stewarding work". CHECKLIST-16 items 10, 11, 48 and 49.
 *
 * A project is { name, tasks }. A task is { name, added, done?, deleted?,
 * current? } with day keys ("2026-09-18"). Open = neither done nor deleted.
 * A deleted task keeps its deleted date: the trend's history needs it (49).
 *
 * THE ROW (10). One bar of task segments: done tasks first, in the order they
 * were done; then the CURRENT task, set by hand in the data, never by age — the
 * wide segment, carrying its name and age; then the other open tasks as narrow
 * segments, oldest first (worker's pick, open for the user at STOP 2). Deleted
 * tasks are not drawn. A div group, not an <ol>: content.css numbers and
 * indents every list in a post body.
 *
 * AGE OF ACTION (11, 48). A task's age on day d is d − added in whole days. A
 * project's figure is ceil(mean age of its open tasks); the head's is the same
 * over every open task pooled across projects. No open tasks → "-".
 *
 * ARCHIVE (75, 92). A project with `archived: true` is drawn under the
 * "Archive" disclosure and counts toward no Age of action figure: its
 * own row shows "-", and it is left out of the head's figure and the trend.
 * The flag is DERIVED, never typed (user, 2026-09-23): renderProjects sets it
 * on any project with no task open today, so finishing the last task moves the
 * card to Archive and adding a task moves it straight back out. A stored
 * `archived` is ignored — the Worker never writes one.
 *
 * THE TREND (49; DECISIONS-LOG #117, #118). The arrow says which way the
 * head's whole-day figure last moved. Walk back from now: undo today's edits
 * one at a time, latest first by their Worker stamp (addedAt, doneAt,
 * deletedAt; an unstamped one counts as earliest), then end at yesterday's
 * figure. The first figure that differs from now's is "before". So 34 → 20 →
 * 10 on one day reads down, and dropping a young task after that reads up at
 * once. A quiet day ages every open task by one, so it reads up. Lower is
 * better: down is "improving", arrow-DOWN in --color-up (green); up is
 * "worsening", arrow-UP in --color-down (red); nothing differs, a dash.
 */
const DAY_MS = 86400000;
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
// An age is never under 1d: a task added today has been waiting a day (user, #153).
const age = (from, to) => Math.max(1, days(from, to));
const closed = (task) => task.done || task.deleted || null;
const openOn = (task, day) => task.added <= day && !(closed(task) && closed(task) <= day);
const mean = (list) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
const ageOfAction = (tasks, day) => mean(tasks.filter((t) => openOn(t, day)).map((t) => age(t.added, day)));
const whole = (value) => value === null ? "-" : `${Math.ceil(value)}d`;

const EDITS = ["added", "done", "deleted"];
const figure = (tasks, day) => {
    const value = ageOfAction(tasks.filter(Boolean), day);
    return value === null ? null : Math.ceil(value);
};

export const trend = (tasks, today = todayKey()) => {
    const now = figure(tasks, today);
    const edits = tasks
        .flatMap((t, i) => EDITS.filter((f) => t[f] === today).map((f) => ({ i, f, at: t[`${f}At`] || "" })))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const state = [...tasks];
    const earlier = edits.map(({ i, f }) => {
        state[i] = f === "added" ? null : { ...state[i], [f]: undefined };
        return figure(state, today);
    });
    earlier.push(figure(tasks, addDays(today, -1)));
    const before = earlier.find((v) => v !== null && v !== now) ?? null;
    const gap = now === null || before === null ? 0 : now - before;
    return { before, trend: gap < 0 ? "improving" : (gap > 0 ? "worsening" : "steady") };
};

export const score = (projects = [], today = todayKey()) => {
    const all = projects.filter((p) => !p.archived).flatMap((p) => p.tasks);
    return {
        overall: ageOfAction(all, today),
        rows: projects.map((p) => p.archived ? null : ageOfAction(p.tasks, today)),
        // Every project's tasks, archived ones too: a project archived today by
        // its last task being crossed off still counted yesterday.
        ...trend(projects.flatMap((p) => p.tasks), today)
    };
};

const ARROW = { improving: "arrow-down", worsening: "arrow-up", steady: "minus" };

/*
 * CLICK TO EXPAND (64). Every segment is a button holding its name and age;
 * CSS shows them only on the one .is-expanded segment per row, which starts as
 * the row's home segment (147, marked data-home): the open task marked
 * `current`, else the oldest open task by `added`, which then takes the
 * current slot and look; else, with nothing open, the last done task, which
 * keeps its done look. A done task's age is how long it took (done − added), an
 * open task's is how old it is today. Expanding and the fallback are view state
 * only: the data's current task never changes.
 */
/*
 * DONE SHADES (74). Done tasks step along the home ramp in the order they were
 * done, the OLDEST darkest (navy) and the most recent lightest (grey), the way
 * home runs its first card navy (card-group.js:808). The middle of the ramp,
 * t 0.32 to 0.66, fails 4.5:1 with both text colours (beige page text holds to
 * t 0.322, ink from t 0.653), so it is skipped, as #32 drops its middle stop:
 * u = i / (n - 1) is squeezed onto the 0.66 of ramp that passes. rampColor(t, 2)
 * is the ramp at t exactly (index / (total - 1) = t). Text is beige below the
 * gap, ink above it.
 * ARCHIVED (96): an archived card's done tasks keep the same order but step
 * only along the light end, t 0.66 to 1, the stretch ink passes on, and all
 * their text is ink. So archived work reads paler than live work, with no
 * color-mix and no second text colour.
 */
const GAP_FROM = 0.32;
const GAP_TO = 0.66;
const doneShade = (i, n, archived) => {
    const u = n <= 1 ? 0 : i / (n - 1);
    let t = archived ? GAP_TO + u * (1 - GAP_TO) : u * (1 - (GAP_TO - GAP_FROM));
    if (!archived && t > GAP_FROM) t += GAP_TO - GAP_FROM;
    return `--seg-fill: ${rampColor(t, 2)}; --seg-text: var(${t <= GAP_FROM ? "--color-page" : "--color-ink"})`;
};

const segment = (task, today, kind, style = "", on = kind === "current") => {
    const shown = task.done ? `took ${age(task.added, task.done)}d` : `${age(task.added, today)}d`;
    const said = `${task.name}, ${shown}${kind === "current" ? ", current" : ""}`;
    return `<button type="button" class="qntns-proj__seg is-${kind}${on ? " is-expanded" : ""}"${on ? " data-home" : ""}${style ? ` style="${style}"` : ""} aria-expanded="${on}" aria-label="${escapeHtml(said)}"><span class="qntns-proj__name"><span class="qntns-proj__text">${escapeHtml(task.name)}</span></span><span class="qntns-proj__age">${shown}</span></button>`;
};

/*
 * THE INFO POP-UP (81) is the footnote pop-up's markup and classes
 * (footnotes.js renderPopover, footnotes.css .qntns-fn-pop*), built here
 * because footnotes.js does not export its own. No fade: the copy is short
 * enough never to scroll inside the 80vh panel.
 */
const renderInfo = () => `
    <div class="qntns-fn-pop" data-proj-pop hidden>
        <div class="qntns-fn-pop__scrim" data-proj-close></div>
        <div class="qntns-fn-pop__panel" role="dialog" aria-modal="true" aria-label="Age of action">
            <button type="button" class="qntns-fn-pop__close" data-proj-close aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <div class="qntns-fn-pop__body" data-proj-body tabindex="0">
                <div class="qntns-med__title qntns-proj__pop-title">Age of action</div>
                <p>The average time it takes to complete a task once it is conceived. It could be seen as a procrastination period, or a backlog period, or commitment/over-commitment gauge. Ideally, the age of action is within one week, but depending on priorities and the season of life, that age may grow. A high age is an indicator that I have said “Yes” to too much. It’s time to cull, prioritize, and take action on what matters most.</p>
            </div>
        </div>
    </div>`;

// Each render's archive region gets its own id for aria-controls.
let archiveId = 0;

export const renderProjects = (list = [], { today = todayKey() } = {}) => {
    const projects = list.map((p) => ({ ...p, archived: !p.tasks.some((t) => openOn(t, today)) }));
    const s = score(projects, today);
    const card = (project, i) => {
        const live = project.tasks.filter((t) => !t.deleted);
        const done = live.filter((t) => t.done).sort((a, b) => a.done.localeCompare(b.done));
        const open = live.filter((t) => !t.done);
        const oldest = [...open].sort((a, b) => a.added.localeCompare(b.added));
        const current = open.find((t) => t.current) ?? oldest[0];
        const rest = oldest.filter((t) => t !== current);
        const home = current ?? done.at(-1);
        const segs = [
            ...done.map((t, d) => segment(t, today, "done", doneShade(d, done.length, project.archived), t === home)),
            ...(current ? [segment(current, today, "current")] : []),
            ...rest.map((t) => segment(t, today, "open"))
        ].join("");
        return `
        <div class="qntns-proj__row">
          <div class="qntns-proj__row-head">
            <span class="qntns-card__title qntns-proj__project">${escapeHtml(project.name)}</span>
            <span class="qntns-proj__row-age" title="Age of action">${whole(s.rows[i])}</span>
          </div>
          <div class="qntns-proj__bar" role="group" aria-label="${escapeHtml(project.name)} tasks">${segs}</div>
        </div>`;
    };
    /* ORDER (91): live cards by their row figure, highest first, compared
       unrounded; ties and "-" rows keep data order (sort is stable), "-" last.
       Indexes are sorted, not projects, so s.rows[i] stays with its card.
       Archive keeps data order: they all score null. `|| 0` turns
       -Infinity - -Infinity (NaN) into a tie. */
    const rank = (i) => s.rows[i] ?? -Infinity;
    const order = projects.map((_, i) => i).sort((a, b) => (rank(b) - rank(a)) || 0);
    const cards = (archived) => order.map((i) => !projects[i].archived === !archived ? card(projects[i], i) : "").join("");
    const rows = cards(false);
    const archived = cards(true);

    /* ARCHIVE (75, 76, 92, 123): a button and a region, not a <details>. A
       closed <details> does not lay its rows out and fires `toggle` a frame
       late, so the cards flashed in place before the drop (123). Here the rows
       are always in the DOM and laid out. The markup ships OPEN (no inert,
       height auto, aria-expanded true), so with no JS the archive is simply
       visible; attachProjects collapses it. The caret is Lucide `play` filled
       by CSS, turned 90deg while aria-expanded is true. */
    const id = `qntns-proj-archive-${++archiveId}`;
    const closed = archived ? `
      <div class="qntns-proj__closed">
        <button type="button" class="qntns-proj__closed-head" aria-expanded="true" aria-controls="${id}">${icon("play", { size: 24, className: "icon qntns-proj__caret" })}<span class="qntns-med__title">Archive</span></button>
        <div class="qntns-proj__archive" id="${id}">${archived}
        </div>
      </div>` : "";

    // The head is meditation's, classes and all (48, sharing #41/#46's rule
    // in goal-meditation.css rather than copying it).
    return `
    <div class="qntns-proj">
      <div class="qntns-med__head">
        <div class="qntns-med__title">Stewarding work</div>
        <div class="qntns-med__figure" title="Age of action">
          <span class="qntns-med__trend is-${s.trend}" role="img" aria-label="${s.trend}">${icon(ARROW[s.trend], { size: 16 })}</span>
          <div class="qntns-med__rate">${whole(s.overall)}</div>
          <button type="button" class="qntns-proj__info" data-proj-info aria-label="What is age of action?">${icon("info", { size: 24 })}</button>
        </div>
      </div>${rows}${closed}
    </div>`;
};

/*
 * One click listener on the document, because a click anywhere outside a row
 * has to restore it. A click on a segment expands that segment in its row; any
 * other click restores every row whose expanded segment it did not land in.
 * Enter and Space arrive as clicks on the button; Escape restores every row.
 * The same listeners open and close the info pop-up (81), which is put inside
 * `root` (its body, for a document) as footnotes.js puts its own, so a
 * remount cannot stack copies. The Archive (123) is collapsed on attach and
 * toggled by its button, all synchronously in the click, so nothing paints
 * between the measure and the drop. Opening drops the cards in (95): each
 * gets its pitch, stagger index and a z-index one below the card before it,
 * and the region's height grows from 0 to its measured px height alongside
 * them, then settles to auto. Closing is the reverse (107): the cards lift
 * bottom-first while the height shrinks to 0, then the region goes inert. Both
 * take --drop-ms + (n - 1) x --drop-step, the whole cascade; a click while
 * one runs is ignored. aria-expanded flips at the press, so the caret turns
 * with the cards. Under reduced motion it opens and closes instantly. The
 * button is a sound.js control, so the page's attachClickSound clicks for it
 * (85's manual playClick for the <summary> is gone).
 * Returns the teardown, which removes the listeners and the pop-up.
 */
export const attachProjects = (root) => {
    (root.body ?? root).insertAdjacentHTML("beforeend", renderInfo());
    const pop = root.querySelector("[data-proj-pop]");
    let opener = null;
    // The X is a button, so the page's attachClickSound (content.js) already
    // clicks for it; the scrim and Escape are not controls and click here.
    const closeInfo = (quiet = false) => {
        if (pop.hidden) return;
        if (!quiet) playClick();
        pop.hidden = true;
        opener?.focus();
        opener = null;
    };
    // THE PITCH (112): each card travels from where the thing above it sits,
    // its top minus that one's top (the button, for the first card). offsetTop
    // ignores transforms and clipping, so it measures the rest position.
    const pitch = (head, items) => items.forEach((el, i) => {
        const above = items[i - 1] ?? head;
        el.style.setProperty("--drop-y", `${el.offsetTop - above.offsetTop}px`);
    });
    const collapse = (head) => {
        head.setAttribute("aria-expanded", "false");
        head.nextElementSibling.inert = true;
    };
    root.querySelectorAll(".qntns-proj__closed-head").forEach(collapse);
    const toggleArchive = (head) => {
        const box = head.nextElementSibling;
        if (box.classList.contains("is-moving")) return;
        const opening = head.getAttribute("aria-expanded") !== "true";
        const items = [...box.querySelectorAll(".qntns-proj__row")];
        const n = items.length;
        head.setAttribute("aria-expanded", String(opening));
        items.forEach((el) => el.classList.remove("is-dropping", "is-lifting"));
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
            box.inert = !opening;
            return;
        }
        const css = getComputedStyle(box);
        const ms = parseFloat(css.getPropertyValue("--drop-ms")) + (n - 1) * parseFloat(css.getPropertyValue("--drop-step"));
        // Pin the current height in px, then leave inert so the rows lay out
        // at full size behind the 0 or the clip.
        box.style.height = `${box.offsetHeight}px`;
        box.style.setProperty("--drop-span", `${ms}ms`);
        box.classList.add("is-moving");
        box.inert = false;
        const full = box.scrollHeight;
        pitch(head, items);
        items.forEach((el, i) => {
            el.style.setProperty("--drop-i", i);
            el.style.setProperty("--lift-i", n - 1 - i);
            el.style.zIndex = -1 - i;
        });
        void box.offsetHeight;
        box.style.height = opening ? `${full}px` : "0px";
        items.forEach((el) => el.classList.add(opening ? "is-dropping" : "is-lifting"));
        // The height transition and the last card end together at `ms`.
        setTimeout(() => {
            box.inert = !opening;
            box.style.height = "";
            box.classList.remove("is-moving");
            items.forEach((el) => el.classList.remove("is-lifting"));
        }, ms);
    };
    const expand = (row, seg) => {
        for (const other of row.querySelectorAll(".qntns-proj__seg")) {
            other.classList.toggle("is-expanded", other === seg);
            other.setAttribute("aria-expanded", String(other === seg));
        }
    };
    const restore = (row) => expand(row, row.querySelector(".qntns-proj__seg[data-home]"));
    const onClick = (event) => {
        const head = event.target.closest?.(".qntns-proj__closed-head");
        if (head && root.contains(head)) toggleArchive(head);
        const info = event.target.closest?.("[data-proj-info]");
        if (info && root.contains(info)) {
            opener = info;
            pop.hidden = false;
            pop.querySelector("[data-proj-body]").focus();
        } else if (event.target.closest?.("[data-proj-close]")) closeInfo(Boolean(event.target.closest("button")));
        const seg = event.target.closest?.(".qntns-proj__seg");
        for (const row of root.querySelectorAll(".qntns-proj__row")) {
            if (seg && row.contains(seg)) expand(row, seg);
            else restore(row);
        }
    };
    // DRAG TO READ (see the CSS): touch and trackpad scroll the text span
    // natively; a mouse drag sets its scrollLeft. Capture keeps the release's
    // click on the segment, so a drag that ends outside the row does not
    // restore it. The "…" shows while text is hidden past the right edge,
    // checked on every scroll and every resize (the expand grows the segment).
    const more = (text) => text.parentElement.classList.toggle("is-more", text.scrollLeft + text.clientWidth < text.scrollWidth - 1);
    const onScroll = (event) => event.target.classList?.contains("qntns-proj__text") && more(event.target);
    const sizes = new ResizeObserver((entries) => entries.forEach((e) => more(e.target)));
    root.querySelectorAll(".qntns-proj__text").forEach((text) => sizes.observe(text));
    const onDown = (event) => {
        const text = event.target.closest?.(".is-expanded .qntns-proj__text");
        if (event.pointerType !== "mouse" || !text || text.scrollWidth <= text.clientWidth) return;
        const x = event.clientX;
        const left = text.scrollLeft;
        const move = (e) => { text.scrollLeft = left - (e.clientX - x); };
        text.setPointerCapture(event.pointerId);
        text.addEventListener("pointermove", move);
        text.addEventListener("lostpointercapture", () => text.removeEventListener("pointermove", move), { once: true });
    };
    const onKey = (event) => {
        if (event.key !== "Escape") return;
        closeInfo();
        root.querySelectorAll(".qntns-proj__row").forEach(restore);
    };
    document.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("scroll", onScroll, true);
    return () => {
        root.removeEventListener("pointerdown", onDown);
        root.removeEventListener("scroll", onScroll, true);
        sizes.disconnect();
        document.removeEventListener("click", onClick);
        root.removeEventListener("keydown", onKey);
        pop.remove();
    };
};
