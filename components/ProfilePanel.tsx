"use client";

import type { Experience, Fact, Profile } from "@/lib/types";

// The "everything the system knows about me" panel (plan §7). It renders
// profile.json directly — full transparency, no hidden state — and edits it
// in place. Pure CRUD: no AI anywhere in this component.

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export default function ProfilePanel({ profile, onChange }: Props) {
  const updateExperience = (id: string, patch: Partial<Experience>) => {
    onChange({
      ...profile,
      experiences: profile.experiences.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    });
  };

  const updateFact = (expId: string, factId: string, text: string) => {
    const exp = profile.experiences.find((e) => e.id === expId);
    if (!exp) return;
    updateExperience(expId, {
      facts: exp.facts.map((f) => (f.id === factId ? { ...f, text } : f)),
    });
  };

  const addFact = (expId: string) => {
    const exp = profile.experiences.find((e) => e.id === expId);
    if (!exp) return;
    const fact: Fact = {
      id: newId("f"),
      text: "",
      source: `manual ${new Date().toISOString().slice(0, 10)}`,
    };
    updateExperience(expId, { facts: [...exp.facts, fact] });
  };

  const deleteFact = (expId: string, factId: string) => {
    const exp = profile.experiences.find((e) => e.id === expId);
    if (!exp) return;
    updateExperience(expId, { facts: exp.facts.filter((f) => f.id !== factId) });
  };

  const addExperience = () => {
    const exp: Experience = {
      id: newId("exp"),
      org: "",
      role: "",
      dates: "",
      facts: [],
    };
    onChange({ ...profile, experiences: [...profile.experiences, exp] });
  };

  const deleteExperience = (id: string) => {
    onChange({
      ...profile,
      experiences: profile.experiences.filter((e) => e.id !== id),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {profile.experiences.length === 0 && (
        <p className="text-sm text-zinc-500">
          No facts yet. Add an experience, or run a resume — parsed facts land
          here after you confirm them.
        </p>
      )}

      {profile.experiences.map((exp) => (
        <div key={exp.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <div className="mb-2 flex gap-2">
            <input
              className="w-1/3 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Organization"
              value={exp.org}
              onChange={(e) => updateExperience(exp.id, { org: e.target.value })}
            />
            <input
              className="w-1/3 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Role"
              value={exp.role}
              onChange={(e) => updateExperience(exp.id, { role: e.target.value })}
            />
            <input
              className="w-1/4 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              placeholder="Dates"
              value={exp.dates}
              onChange={(e) => updateExperience(exp.id, { dates: e.target.value })}
            />
            <button
              className="ml-auto text-xs text-red-500 hover:text-red-700"
              onClick={() => deleteExperience(exp.id)}
              title="Delete experience"
            >
              ✕
            </button>
          </div>

          <ul className="flex flex-col gap-1">
            {exp.facts.map((fact) => (
              <li key={fact.id} className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  placeholder="A raw truth: what you did, a metric, an outcome…"
                  value={fact.text}
                  onChange={(e) => updateFact(exp.id, fact.id, e.target.value)}
                />
                <span className="whitespace-nowrap text-[10px] text-zinc-400" title="source">
                  {fact.source}
                </span>
                <button
                  className="text-xs text-zinc-400 hover:text-red-600"
                  onClick={() => deleteFact(exp.id, fact.id)}
                  title="Delete fact"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => addFact(exp.id)}
          >
            + fact
          </button>
        </div>
      ))}

      <button
        className="self-start rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        onClick={addExperience}
      >
        + experience
      </button>

      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        Bullet char limit
        <input
          type="number"
          className="w-20 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
          value={profile.settings.defaultCharLimit}
          onChange={(e) =>
            onChange({
              ...profile,
              settings: { ...profile.settings, defaultCharLimit: Number(e.target.value) || 0 },
            })
          }
        />
      </label>
    </div>
  );
}
