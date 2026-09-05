/* ============================================
   EasyFPL — remembering a lineup

   Two things the Lineup Wizard could not do. Auto-optimise was a one-way door:
   it rearranged your eleven with no way back to what you had, and the only
   recovery was to remember the shape yourself and rebuild it by hand. And
   nothing you did there survived a reload, so a lineup worked out on Friday was
   gone by Saturday morning.

   Both are the same missing idea — an arrangement as a value you can hold on
   to, rather than something that only exists as the current state of a panel.

   WHY IT EXPIRES. A lineup is an answer to one gameweek's question. Restoring
   GW4's eleven into GW5 would silently reinstate a shape chosen against
   fixtures that have already been played, and it would look exactly like a
   lineup you had picked on purpose. So a saved arrangement carries the
   gameweek it was for and the team it belonged to, and is discarded rather
   than adapted when either moves on. A stale lineup is worse than none,
   because none is obvious.

   The age cap is a backstop rather than the mechanism: gameweek and team are
   what actually decide, and the fortnight only matters if a season ends or an
   id goes missing while something is still in storage.

   Prefix ls*. No DOM. Pure functions over an arrangement plus localStorage.
   ============================================ */

        const LS_STORE = 'easyfpl_lineup';

        // Long enough to survive an international break, short enough that
        // nothing from a previous season can ever be restored.
        const LS_MAX_AGE_DAYS = 21;

        /* An arrangement is everything a manager decided and nothing derived.

           Formation is not stored: it is a fact about which eleven are picked,
           so keeping it would give two sources of truth that could disagree.
           Bench order is stored, because it is a decision — it is what the
           auto-substitutions run through. */
        function lsArrangement(state) {
            if (!state || !Array.isArray(state.xi)) return null;
            return {
                xi: state.xi.map(p => p.id),
                bench: (state.bench || []).map(p => p.id),
                captain: state.captain != null ? state.captain : null,
                vice: state.viceCaptain != null ? state.viceCaptain : null,
                excluded: state.excluded ? [...state.excluded] : []
            };
        }

        /* Put an arrangement back, against the squad currently loaded.

           Ids are resolved rather than trusted: a saved eleven can name a player
           who has since been transferred out, and reinstating him would put
           someone in your XI who is not in your squad. Anyone missing is
           dropped, and if that leaves the eleven short the caller is told so it
           can re-solve rather than render ten players. */
        function lsApply(state, arrangement) {
            if (!state || !arrangement || !Array.isArray(state.squad)) return false;
            const byId = new Map(state.squad.map(p => [p.id, p]));
            const resolve = (ids) => (ids || []).map(id => byId.get(id)).filter(Boolean);

            const xi = resolve(arrangement.xi);
            if (xi.length !== 11) return false;

            const xiIds = new Set(xi.map(p => p.id));
            // Anyone in the squad who is not in the saved eleven is on the
            // bench, in the saved order where it is known and after it otherwise.
            const savedBench = resolve(arrangement.bench).filter(p => !xiIds.has(p.id));
            const seen = new Set(savedBench.map(p => p.id));
            const rest = state.squad.filter(p => !xiIds.has(p.id) && !seen.has(p.id));

            state.xi = xi;
            state.bench = savedBench.concat(rest);
            state.excluded = new Set((arrangement.excluded || []).filter(id => byId.has(id)));
            state.captain = xiIds.has(arrangement.captain) ? arrangement.captain : null;
            state.viceCaptain = xiIds.has(arrangement.vice) ? arrangement.vice : null;
            return true;
        }

        function lsSave(teamId, gw, arrangement) {
            if (!arrangement || teamId == null || gw == null) return false;
            try {
                localStorage.setItem(LS_STORE, JSON.stringify({
                    teamId: String(teamId), gw, arrangement, savedAt: Date.now()
                }));
                return true;
            } catch (e) { return false; }
        }

        /* The saved arrangement, if it is still about this team and this
           gameweek. Every mismatch returns null rather than something adapted:
           there is no sensible way to translate an eleven from one gameweek to
           the next, and pretending otherwise is how a stale lineup gets fielded. */
        function lsLoad(teamId, gw, now) {
            let raw;
            try { raw = JSON.parse(localStorage.getItem(LS_STORE) || 'null'); } catch (e) { return null; }
            if (!raw || !raw.arrangement) return null;
            if (String(raw.teamId) !== String(teamId)) return null;
            if (raw.gw !== gw) return null;
            const age = (now != null ? now : Date.now()) - (raw.savedAt || 0);
            if (age > LS_MAX_AGE_DAYS * 86400000) return null;
            return raw.arrangement;
        }

        function lsClear() {
            try { localStorage.removeItem(LS_STORE); } catch (e) { /* private mode */ }
        }

        // Whether two arrangements are the same decision, so an undo button is
        // not offered for a change that did not change anything.
        function lsSame(a, b) {
            if (!a || !b) return false;
            const sameSet = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
            return sameSet(a.xi, b.xi) && sameSet(a.bench, b.bench)
                && a.captain === b.captain && a.vice === b.vice;
        }
