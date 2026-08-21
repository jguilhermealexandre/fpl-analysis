// Season Vault — self-serve predictions submission.
// Paste or type a ranked list of all 20 real Premier League teams (one per
// line, 1st place first), see a live preview, and submit — writes straight
// to Supabase (scripts/supabase-config.js), no manual JSON editing needed.

let teamIndex = {};
let lockAt = null;
let parsedTeams = []; // current valid parse: array of team objects, in order

function renderLockedNotice(message) {
    return `<div class="sv-locked-notice">
        <i data-lucide="lock" style="width:18px;height:18px;"></i>
        <div>${message}</div>
        <a class="btn btn-primary btn-sm" href="season-vault-d845fb.html">See the leaderboard →</a>
    </div>`;
}

function renderNotConfiguredNotice() {
    return `<div class="sv-locked-notice">
        <i data-lucide="settings" style="width:18px;height:18px;"></i>
        <div>This page isn't connected to a database yet — predictions can't be saved until that's set up.</div>
    </div>`;
}

function parsePredictionText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const unmatched = [];
    const seenIds = new Set();
    const duplicates = [];
    const teams = [];

    lines.forEach(label => {
        const team = matchTeam(label, teamIndex, unmatched);
        if (!team) return;
        if (seenIds.has(team.id)) {
            duplicates.push(team.name);
            return;
        }
        seenIds.add(team.id);
        teams.push(team);
    });

    return { teams, unmatched, duplicates, lineCount: lines.length };
}

function renderPreview(parsed) {
    const { teams, unmatched, duplicates, lineCount } = parsed;
    const rows = teams.map((t, i) => `
        <div class="sv-preview-row">
            <span class="sv-pos">${i + 1}</span>
            <span class="sv-team-cell">${teamBadge(t, 18)} ${escHTML(t.name)}</span>
        </div>`).join('');

    const issues = [];
    if (unmatched.length) issues.push(`Couldn't recognize: ${unmatched.map(escHTML).join(', ')}`);
    if (duplicates.length) issues.push(`Listed more than once: ${duplicates.map(escHTML).join(', ')}`);
    if (lineCount > 0 && teams.length < 20 && !unmatched.length && !duplicates.length) {
        issues.push(`${20 - teams.length} team${20 - teams.length > 1 ? 's' : ''} still missing`);
    }

    const issuesHtml = issues.length
        ? `<div class="sv-preview-issues"><i data-lucide="alert-triangle" style="width:13px;height:13px;"></i> ${issues.join(' · ')}</div>`
        : '';

    return `<div class="sv-preview-list">${rows}</div>${issuesHtml}`;
}

function updatePreviewAndSubmitState() {
    const text = document.getElementById('ps-textarea').value;
    const name = document.getElementById('ps-name').value.trim();
    const parsed = parsePredictionText(text);
    parsedTeams = parsed.teams;

    document.getElementById('ps-preview').innerHTML = text.trim()
        ? renderPreview(parsed)
        : renderEmptyState('Nothing yet', 'Type or paste your 20 teams, 1st place first, and they’ll show up here.', 'list');

    const isValid = name.length > 0 && parsed.teams.length === 20 && parsed.unmatched.length === 0 && parsed.duplicates.length === 0;
    document.getElementById('ps-submit').disabled = !isValid;
    initIcons();
}

async function checkExistingAndConfirm(nameKey, displayName) {
    try {
        const rows = await supabaseRequest(`predictions?name_key=eq.${encodeURIComponent(nameKey)}&select=name`);
        if (rows && rows.length > 0) {
            return confirm(`${displayName} already has predictions saved — update them?`);
        }
        return true;
    } catch (err) {
        console.error('Existence check failed:', err);
        return true; // don't block submission on a lookup failure — the upsert itself is still safe
    }
}

async function submitPredictions() {
    const name = document.getElementById('ps-name').value.trim();
    if (!name || parsedTeams.length !== 20) return;

    const nameKey = name.trim().toLowerCase();
    const proceed = await checkExistingAndConfirm(nameKey, name);
    if (!proceed) return;

    const submitBtn = document.getElementById('ps-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
        await supabaseRequest('predictions?on_conflict=name_key', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify([{ name, predictions: parsedTeams.map(t => t.short_name) }]),
        });
        document.getElementById('ps-form-section').innerHTML = `<div class="sv-locked-notice">
            <i data-lucide="check-circle" style="width:18px;height:18px;color:var(--color-success);"></i>
            <div>Saved! Thanks, ${escHTML(name)} — your predictions are locked in until the deadline.</div>
            <a class="btn btn-primary btn-sm" href="season-vault-d845fb.html">See the leaderboard →</a>
        </div>`;
        initIcons();
    } catch (err) {
        console.error('Submit failed:', err);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save my predictions';
        document.getElementById('ps-error').textContent = 'Something went wrong saving that — please try again.';
    }
}

async function initPredictionsSubmit() {
    createSkeletonCards(4, 'ps-skeleton');

    if (!isSupabaseConfigured()) {
        removeSkeletons('ps-skeleton');
        document.getElementById('ps-form-section').innerHTML = renderNotConfiguredNotice();
        initIcons();
        return;
    }

    try {
        const bootstrap = await DataCache.fetchJSON(DATA_URLS.bootstrap);
        teamIndex = buildTeamIndex(bootstrap.teams);

        const configRows = await supabaseRequest('config?select=lock_at&id=eq.1');
        lockAt = configRows && configRows[0] ? new Date(configRows[0].lock_at) : null;

        removeSkeletons('ps-skeleton');

        if (lockAt && Date.now() > lockAt.getTime()) {
            document.getElementById('ps-form-section').innerHTML = renderLockedNotice(
                `Predictions closed on ${lockAt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} — but you can still see how everyone's doing.`
            );
            initIcons();
            return;
        }

        document.getElementById('ps-textarea').addEventListener('input', updatePreviewAndSubmitState);
        document.getElementById('ps-name').addEventListener('input', updatePreviewAndSubmitState);
        document.getElementById('ps-submit').addEventListener('click', submitPredictions);
        updatePreviewAndSubmitState();
        initIcons();
    } catch (err) {
        console.error('Predictions submit page failed to load:', err);
        removeSkeletons('ps-skeleton');
        document.getElementById('ps-form-section').innerHTML =
            renderErrorState('Couldn’t load this page', 'Something went wrong loading team data or the submission form.', null);
    }
}

document.addEventListener('DOMContentLoaded', initPredictionsSubmit);
