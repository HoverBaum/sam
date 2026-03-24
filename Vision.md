# sam — Vision

> A personal knowledge companion for Obsidian and Zettelkasten: capture quickly, shape ideas clearly, and surface meaningful connections without replacing human thinking.

---

## Why this exists

People usually do not fail to build a strong knowledge system because they lack ideas. They fail because capture and processing have too much friction. Notes stay in temporary places, sources pile up, and potential connections never become part of the actual system.

`sam` exists to remove that friction. It should handle the repetitive effort around intake and organization so the user can spend energy on interpretation, synthesis, and decision-making.

The end goal is simple: less capture fatigue, more compounding insight.

---

## Product vision

`sam` should feel like a calm, reliable thinking partner that helps transform raw inputs into durable knowledge.

It should:

1. Make capture nearly effortless from everyday inputs.
2. Help turn rough thoughts into clear, usable notes.
3. Surface potential links and context at the right moment.
4. Keep the user in control of meaning and final decisions.
5. Build trust through transparency and reversible actions.
6. Feel **pleasant and fun** in the terminal—`sam` should reward daily use, not only pass a checklist.

---

## Experience and interactivity

The primary interface is an **Ink-powered** CLI: a **responsive, modern TUI** with the snappy keyboard-driven feel people expect from contemporary tools. Running `sam` should **welcome** the user and make the next step obvious.

Users should be able to work from a **home shell** with simple routing—e.g. **`/new`** (or similar) to start capture with optional arguments—so flows stay discoverable without memorizing every subcommand. **Subcommands** (`sam new`, `sam index`, …) remain for scripts, aliases, and automation.

**Joy matters.** If `sam` is calm and reliable but also a little delightful to open, people will trust it with their thinking.

Packaging `sam` as a portable **skill** for non-terminal environments may sit awkwardly next to a rich interactive shell; that trade-off is acknowledged and **deferred**—the day-to-day terminal experience comes first.

---

## Core principles

1. Human meaning comes first.
Connections are suggestions until the user accepts them. The system supports judgment; it does not replace it.

2. Reduce friction at every step.
The default path should make it easy to go from idea to integrated note without a long operational burden.

3. Trust through clarity.
Users should always understand what is being proposed, what will change, and how to undo it.

4. Preserve knowledge quality over speed.
Fast capture matters, but long-term clarity and retrieval matter more.

5. Grow with real practice.
The product should evolve from actual usage patterns and real workflows, not theoretical complexity.

6. **Terminal UX is a first-class product.**
Interactivity, feedback, and responsiveness are not afterthoughts; they are how trust and habit form.

---

## Boundaries

`sam` is not intended to fully automate knowledge work. It should not optimize for maximum automation at the cost of understanding.

`sam` is also not the place for implementation detail in this document. Technical architecture, tooling choices, module structure, and phased delivery belong in the implementation plan.

---

## Success criteria

We know this vision is being achieved when users consistently report:

1. Faster capture from thought or source to stored note.
2. Fewer lost ideas and fewer unprocessed backlogs.
3. Better recall through richer, human-approved connections.
4. Higher confidence that the system supports thinking instead of distracting from it.
5. The **terminal experience** feels responsive and worth opening—capture and review stay lightweight and, when appropriate, **fun**.

---

## Long-term direction

Over time, `sam` should become a personalized knowledge companion that adapts to a user's style, preferred structures, and recurring themes while remaining transparent and controllable.

The north star is a system that strengthens human insight over months and years, not just a tool that processes text quickly.

