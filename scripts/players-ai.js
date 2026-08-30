// ============================================
// FPL AI ASSISTANT
// ============================================

// Initialize player count and update suggestions after data loads
const aiInitInterval = setInterval(() => {
    if (allAnalyses && allAnalyses.length > 0) {
        const countEl = document.getElementById('ai-player-count');
        if (countEl) countEl.textContent = allAnalyses.length;

        // Update comparison suggestion with real player names
        const topPlayers = allAnalyses
            .filter(p => p.selectedBy > 15 && p.l5?.games >= 3)
            .sort((a, b) => b.selectedBy - a.selectedBy);

        if (topPlayers.length >= 2) {
            const p1 = topPlayers[0].name;
            const p2 = topPlayers[1].name;
            const compareBtn = document.getElementById('ai-compare-suggestion');
            if (compareBtn) {
                compareBtn.innerHTML = `<i data-lucide="scale" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> ${p1} vs ${p2}`;
                compareBtn.onclick = () => askAI(`Compare ${p1} and ${p2}`);
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }

        clearInterval(aiInitInterval);
    }
}, 500);

function toggleAIChat() {
    document.getElementById('fpl-ai-widget').classList.toggle('expanded');
}

function handleAIEnter(e) {
    if (e.key === 'Enter') submitAIQuery();
}

function askAI(question) {
    document.getElementById('ai-input').value = question;
    submitAIQuery();
}

function submitAIQuery() {
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;

    addAIMessage(text, 'user');
    input.value = '';

    // Simulate thinking delay
    setTimeout(() => {
        const response = processAIQuery(text);
        addAIMessage(response, 'bot');
    }, 300);
}

function addAIMessage(content, type) {
    const container = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = `ai-msg ${type}`;
    if (type === 'user') {
        div.textContent = content;
    } else {
        div.innerHTML = content;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ============================================
// AI QUERY PROCESSING ENGINE
// ============================================
function processAIQuery(query) {
    if (!allAnalyses || allAnalyses.length === 0) {
        return "Still loading player data... Please try again in a moment.";
    }

    const q = query.toLowerCase();

    // --- Intent: Debug/Help - Show sample players ---
    if (q.includes('debug') || q.includes('help') || q.includes('list players')) {
        const samples = allAnalyses.slice(0, 10).map(p => p.name);
        return `
            <strong>Sample player names in database:</strong>
            <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary);">
                ${samples.join(', ')}...
            </div>
            <div style="margin-top: 10px; font-size: 11px;">
                Try: "Stats for ${samples[0]}" or "Compare ${samples[1]} and ${samples[2]}"
            </div>
        `;
    }

    // --- Intent: Compare Players ---
    if (q.includes('compare') || q.includes(' vs ') || q.includes(' or ')) {
        const players = findPlayersInQuery(q);
        if (players.length >= 2) {
            return generateComparisonResponse(players.slice(0, 2));
        }
        if (players.length === 1) {
            return `I found <strong>${players[0].name}</strong>, but I need a second player to compare. Try adding another name.`;
        }
        // Show some popular player names as hints
        const popularPlayers = allAnalyses
            .filter(p => p.selectedBy > 15)
            .sort((a, b) => b.selectedBy - a.selectedBy)
            .slice(0, 4)
            .map(p => p.name);
        return `I couldn't find those players. Try using names like: <strong>${popularPlayers.join(', ')}</strong>`;
    }

    // --- Intent: Best/Top Players ---
    if (q.includes('best') || q.includes('top') || q.includes('recommend')) {
        return generateBestPlayersResponse(q);
    }

    // --- Intent: Differentials ---
    if (q.includes('differential') || q.includes('hidden gem') || q.includes('under owned')) {
        return generateDifferentialsResponse(q);
    }

    // --- Intent: Fixtures ---
    if (q.includes('fixture') || q.includes('schedule') || q.includes('easiest') || q.includes('hardest')) {
        return generateFixtureResponse(q);
    }

    // --- Intent: Value Picks ---
    if (q.includes('value') || q.includes('cheap') || q.includes('budget') || q.includes('bargain')) {
        return generateValueResponse(q);
    }

    // --- Intent: Form/Hot Players ---
    if (q.includes('form') || q.includes('hot') || q.includes('scoring') || q.includes('returning')) {
        return generateFormResponse(q);
    }

    // --- Intent: Specific Player Info ---
    const players = findPlayersInQuery(q);
    if (players.length === 1) {
        return generatePlayerResponse(players[0]);
    }

    // --- Intent: Captain Picks ---
    if (q.includes('captain') || q.includes('armband')) {
        return generateCaptainResponse();
    }

    // --- Intent: Search for player ---
    if (q.startsWith('search ') || q.startsWith('find ')) {
        const searchTerm = q.replace(/^(search|find)\s+/, '').trim();
        const matches = allAnalyses.filter(p => 
            p.name.toLowerCase().includes(searchTerm) ||
            (p.fullName && p.fullName.toLowerCase().includes(searchTerm))
        ).slice(0, 5);

        if (matches.length === 0) {
            return `No players found matching "${escHTML(searchTerm)}". Try a shorter search term.`;
        }

        return `
            <strong>Players matching "${escHTML(searchTerm)}":</strong>
            <div class="ai-player-list">
                ${matches.map(p => `
                    <div class="ai-player-row" style="cursor: pointer;" data-pname="${escHTML(p.name)}" onclick="askAI('Stats for ' + this.dataset.pname)">
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">£${p.price}m · ${escHTML(p.team)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 8px; font-size: 10px; color: var(--text-muted);">Click a player to see their stats</div>
        `;
    }

    // Default fallback - use actual popular players from database
    const topPlayers = allAnalyses
        .filter(p => p.selectedBy > 10)
        .sort((a, b) => b.selectedBy - a.selectedBy)
        .slice(0, 3);
    const playerHint = topPlayers.length > 0 ? topPlayers[0].name : 'Haaland';

    return `I'm not sure about that. Try asking:
        <div class="ai-suggestions" style="margin-top: 10px;">
            <button onclick="askAI('Best budget forwards')"><i data-lucide="coins" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Budget picks</button>
            <button onclick="askAI('Who should I captain?')"><i data-lucide="crown" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Captain</button>
            <button onclick="askAI('Stats for ${escHTML(playerHint)}')"><i data-lucide="bar-chart-3" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Player stats</button>
            <button onclick="askAI('search sal')"><i data-lucide="search" style="width:12px;height:12px;display:inline-block;vertical-align:middle;"></i> Search players</button>
        </div>`;
}

// ============================================
// PLAYER FINDER (Fuzzy Search)
// ============================================
function findPlayersInQuery(query) {
    if (!allAnalyses || allAnalyses.length === 0) {
        console.log('No analyses data available');
        return [];
    }

    const found = [];
    const q = query.toLowerCase().trim();

    // Extract meaningful words from query (remove common words)
    const stopWords = ['compare', 'vs', 'versus', 'and', 'or', 'the', 'to', 'with', 'for', 'stats', 'how', 'is', 'doing', 'who', 'what', 'best', 'top', 'should', 'i', 'my', 'a', 'an', 'about', 'tell', 'me', 'show'];
    const queryWords = q.split(/[\s,]+/).filter(w => w.length > 2 && !stopWords.includes(w));

    console.log('Query words:', queryWords);

    allAnalyses.forEach(p => {
        if (found.some(f => f.id === p.id)) return; // Skip if already found

        // Get all name variations and clean them
        const names = [p.name, p.fullName].filter(Boolean);

        for (const rawName of names) {
            const playerName = rawName.toLowerCase().trim();
            const nameParts = playerName.split(/[\s.-]+/).filter(part => part.length > 1);

            // Method 1: Full name match in query
            if (q.includes(playerName)) {
                found.push(p);
                return;
            }

            // Method 2: Any query word matches any name part
            for (const queryWord of queryWords) {
                for (const namePart of nameParts) {
                    // For short names/words (<= 4 chars), require exact match only
                    if (namePart.length <= 4 || queryWord.length <= 4) {
                        if (namePart === queryWord) {
                            found.push(p);
                            return;
                        }
                    } else {
                        // For longer names, allow substring matching
                        if (namePart === queryWord || 
                            queryWord.includes(namePart) ||
                            namePart.includes(queryWord)) {
                            found.push(p);
                            return;
                        }
                    }
                }
            }
        }
    });

    console.log('Found players:', found.map(p => p.name));
    return found.slice(0, 4);
}

function getPosString(pos) {
    return { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[pos] || 'MID';
}

// ============================================
// RESPONSE GENERATORS
// ============================================
function generatePlayerResponse(p) {
    const g = p.l5?.games || 1;
    const ptsPerGame = (p.l5?.points / g).toFixed(1);
    const xGI = (p.l5?.xGI / g).toFixed(2);
    const posStr = getPosString(p.position);

    return `
        <strong>${escHTML(p.name)}</strong> <span style="color: var(--text-muted)">(${escHTML(p.team)} - ${posStr})</span>
        <div class="ai-player-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 18px; font-weight: 700;">£${p.price}m</span>
                <span style="font-size: 11px; color: var(--text-muted);">${p.selectedBy?.toFixed(1) || 0}% owned</span>
            </div>
            <div class="ai-player-stats">
                <div class="ai-stat-box">
                    <div class="ai-stat-label">Pts/G (L5)</div>
                    <div class="ai-stat-value">${ptsPerGame}</div>
                </div>
                <div class="ai-stat-box">
                    <div class="ai-stat-label">xGI/G</div>
                    <div class="ai-stat-value">${xGI}</div>
                </div>
                <div class="ai-stat-box">
                    <div class="ai-stat-label">Goals (L5)</div>
                    <div class="ai-stat-value">${p.l5?.goals || 0}</div>
                </div>
                <div class="ai-stat-box">
                    <div class="ai-stat-label">Assists (L5)</div>
                    <div class="ai-stat-value">${p.l5?.assists || 0}</div>
                </div>
            </div>
            <div style="margin-top: 10px; font-size: 11px; color: var(--text-muted);">
                Next 3: <strong>${p.fixtures?.fixtureString || 'N/A'}</strong>
            </div>
        </div>
        <button class="ai-view-btn" onclick="openPlayerModal(${p.id}, '${posStr}')">View Full Profile</button>
    `;
}

function generateComparisonResponse(players) {
    const [p1, p2] = players;
    const g1 = p1.l5?.games || 1;
    const g2 = p2.l5?.games || 1;

    const stats = [
        { label: 'Price', v1: `£${p1.price}m`, v2: `£${p2.price}m`, better: p1.price < p2.price ? 1 : 2 },
        { label: 'Pts/G (L5)', v1: (p1.l5?.points/g1).toFixed(1), v2: (p2.l5?.points/g2).toFixed(1), better: (p1.l5?.points/g1) > (p2.l5?.points/g2) ? 1 : 2 },
        { label: 'xGI/G', v1: (p1.l5?.xGI/g1).toFixed(2), v2: (p2.l5?.xGI/g2).toFixed(2), better: (p1.l5?.xGI/g1) > (p2.l5?.xGI/g2) ? 1 : 2 },
        { label: 'Goals (L5)', v1: p1.l5?.goals || 0, v2: p2.l5?.goals || 0, better: (p1.l5?.goals || 0) > (p2.l5?.goals || 0) ? 1 : 2 },
        { label: 'Assists (L5)', v1: p1.l5?.assists || 0, v2: p2.l5?.assists || 0, better: (p1.l5?.assists || 0) > (p2.l5?.assists || 0) ? 1 : 2 },
        { label: 'Avg FDR', v1: p1.fixtures?.avgFDR5?.toFixed(1) || 'N/A', v2: p2.fixtures?.avgFDR5?.toFixed(1) || 'N/A', better: (p1.fixtures?.avgFDR5 || 5) < (p2.fixtures?.avgFDR5 || 5) ? 1 : 2 },
    ];

    const p1Wins = stats.filter(s => s.better === 1).length;
    const p2Wins = stats.filter(s => s.better === 2).length;
    const winner = p1Wins > p2Wins ? p1 : p2;

    return `
        <strong>${p1.name} vs ${p2.name}</strong>
        <table style="width: 100%; margin-top: 10px; font-size: 11px; border-collapse: collapse;">
            <tr style="background: var(--surface-3);">
                <th style="padding: 6px; text-align: left;">Stat</th>
                <th style="padding: 6px; text-align: center;">${p1.name.split(' ').pop()}</th>
                <th style="padding: 6px; text-align: center;">${p2.name.split(' ').pop()}</th>
            </tr>
            ${stats.map(s => `
                <tr>
                    <td style="padding: 6px; color: var(--text-muted);">${s.label}</td>
                    <td style="padding: 6px; text-align: center; ${s.better === 1 ? 'color: var(--color-success); font-weight: 700;' : ''}">${s.v1}</td>
                    <td style="padding: 6px; text-align: center; ${s.better === 2 ? 'color: var(--color-success); font-weight: 700;' : ''}">${s.v2}</td>
                </tr>
            `).join('')}
        </table>
        <div style="margin-top: 10px; padding: 8px; background: var(--surface-3); border-radius: 6px; font-size: 12px;">
            <strong style="color: var(--color-success);">Edge: ${winner.name}</strong> (${Math.max(p1Wins, p2Wins)}/${stats.length} categories)
        </div>
    `;
}

function generateBestPlayersResponse(q) {
    let pos = null;
    if (q.includes('goalkeeper') || q.includes(' gk')) pos = 1;
    else if (q.includes('defender') || q.includes(' def')) pos = 2;
    else if (q.includes('midfielder') || q.includes(' mid')) pos = 3;
    else if (q.includes('forward') || q.includes('striker') || q.includes(' fwd')) pos = 4;

    let maxPrice = 20;
    if (q.includes('budget') || q.includes('cheap')) maxPrice = pos === 1 ? 5.0 : pos === 2 ? 5.5 : pos === 3 ? 7.0 : 7.5;
    const priceMatch = q.match(/under (\d+(\.\d+)?)/);
    if (priceMatch) maxPrice = parseFloat(priceMatch[1]);

    let candidates = allAnalyses.filter(p => 
        (pos === null || p.position === pos) &&
        p.price <= maxPrice &&
        (p.l5?.games || 0) >= 3
    );

    // Sort by points per game
    candidates.sort((a, b) => {
        const aG = a.l5?.games || 1;
        const bG = b.l5?.games || 1;
        return (b.l5?.points / bG) - (a.l5?.points / aG);
    });

    const top3 = candidates.slice(0, 3);
    if (top3.length === 0) return "No players found matching that criteria.";

    const posName = pos ? getPosString(pos) + 's' : 'players';
    const priceText = maxPrice < 20 ? ` under £${maxPrice}m` : '';

    return `
        <strong>Best ${posName}${priceText}</strong> (by Pts/G)
        <div class="ai-player-list">
            ${top3.map((p, i) => {
                const g = p.l5?.games || 1;
                return `
                    <div class="ai-player-row">
                        <span class="ai-player-rank">${i + 1}</span>
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">£${p.price}m · ${escHTML(p.team)}</div>
                        </div>
                        <div class="ai-player-stat">
                            <div class="ai-player-stat-value">${(p.l5?.points / g).toFixed(1)}</div>
                            <div class="ai-player-stat-label">Pts/G</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function generateDifferentialsResponse(q) {
    let maxOwnership = 10;
    const ownMatch = q.match(/under (\d+)%?/);
    if (ownMatch) maxOwnership = parseFloat(ownMatch[1]);

    const candidates = allAnalyses.filter(p => 
        (p.selectedBy || 0) <= maxOwnership &&
        (p.l5?.games || 0) >= 3 &&
        (p.l5?.points || 0) >= 15
    ).sort((a, b) => {
        const aG = a.l5?.games || 1;
        const bG = b.l5?.games || 1;
        return (b.l5?.points / bG) - (a.l5?.points / aG);
    });

    const top3 = candidates.slice(0, 3);
    if (top3.length === 0) return "No differentials found with good form.";

    return `
        <strong><i data-lucide="crosshair" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Top Differentials</strong> (under ${maxOwnership}% owned)
        <div class="ai-player-list">
            ${top3.map((p, i) => {
                const g = p.l5?.games || 1;
                return `
                    <div class="ai-player-row">
                        <span class="ai-player-rank">${i + 1}</span>
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">£${p.price}m · ${(p.selectedBy || 0).toFixed(1)}% owned</div>
                        </div>
                        <div class="ai-player-stat">
                            <div class="ai-player-stat-value">${(p.l5?.points / g).toFixed(1)}</div>
                            <div class="ai-player-stat-label">Pts/G</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function generateFixtureResponse(q) {
    const isHard = q.includes('hard') || q.includes('worst') || q.includes('avoid');

    // Group by team and get fixture data
    const teamData = {};
    allAnalyses.forEach(p => {
        if (p.teamId && p.fixtures && !teamData[p.teamId]) {
            teamData[p.teamId] = {
                name: p.team,
                avgFDR: p.fixtures.avgFDR5 || 3,
                fixtures: p.fixtures.fixtureString || 'N/A'
            };
        }
    });

    const sorted = Object.values(teamData).sort((a, b) => 
        isHard ? b.avgFDR - a.avgFDR : a.avgFDR - b.avgFDR
    ).slice(0, 5);

    const title = isHard ? '<i data-lucide="alert-triangle" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Hardest Fixtures (Next 5)' : '<i data-lucide="circle-check" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Easiest Fixtures (Next 5)';

    return `
        <strong>${title}</strong>
        <div style="margin-top: 10px;">
            ${sorted.map((t, i) => `
                <div style="display: flex; justify-content: space-between; padding: 8px; background: var(--surface-3); border-radius: 6px; margin-bottom: 4px;">
                    <span><strong>${i + 1}.</strong> ${t.name}</span>
                    <span style="color: ${t.avgFDR <= 2.5 ? 'var(--color-success)' : t.avgFDR >= 3.5 ? 'var(--color-error)' : 'var(--text-muted)'}">
                        FDR ${t.avgFDR.toFixed(1)}
                    </span>
                </div>
            `).join('')}
        </div>
    `;
}

function generateValueResponse(q) {
    let pos = null;
    if (q.includes('goalkeeper') || q.includes(' gk')) pos = 1;
    else if (q.includes('defender') || q.includes(' def')) pos = 2;
    else if (q.includes('midfielder') || q.includes(' mid')) pos = 3;
    else if (q.includes('forward') || q.includes('striker') || q.includes(' fwd')) pos = 4;

    const candidates = allAnalyses.filter(p => 
        (pos === null || p.position === pos) &&
        (p.l5?.games || 0) >= 3
    ).map(p => {
        const g = p.l5?.games || 1;
        const ptsPerGame = p.l5?.points / g;
        return { ...p, valueScore: ptsPerGame / p.price };
    }).sort((a, b) => b.valueScore - a.valueScore);

    const top3 = candidates.slice(0, 3);
    const posName = pos ? getPosString(pos) + 's' : 'players';

    return `
        <strong><i data-lucide="gem" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Best Value ${posName}</strong> (Pts/G per £1m)
        <div class="ai-player-list">
            ${top3.map((p, i) => {
                const g = p.l5?.games || 1;
                return `
                    <div class="ai-player-row">
                        <span class="ai-player-rank">${i + 1}</span>
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">£${p.price}m · ${(p.l5?.points / g).toFixed(1)} Pts/G</div>
                        </div>
                        <div class="ai-player-stat">
                            <div class="ai-player-stat-value">${p.valueScore.toFixed(2)}</div>
                            <div class="ai-player-stat-label">Value</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function generateFormResponse(q) {
    const candidates = allAnalyses.filter(p => 
        (p.l5?.games || 0) >= 3
    ).sort((a, b) => (b.form || 0) - (a.form || 0));

    const top3 = candidates.slice(0, 3);

    return `
        <strong><i data-lucide="flame" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Hottest Form Right Now</strong>
        <div class="ai-player-list">
            ${top3.map((p, i) => {
                const g = p.l5?.games || 1;
                return `
                    <div class="ai-player-row">
                        <span class="ai-player-rank">${i + 1}</span>
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">£${p.price}m · ${escHTML(p.team)}</div>
                        </div>
                        <div class="ai-player-stat">
                            <div class="ai-player-stat-value">${p.form?.toFixed(1) || 0}</div>
                            <div class="ai-player-stat-label">Form</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function generateCaptainResponse() {
    // Find eligible players with best combo of form + easy fixtures
    const candidates = allAnalyses.filter(p => 
        isPlayerEligible(p, { checkAvailability: true, checkStarters: true }) &&
        p.fixtures?.avgFDR3
    ).map(p => {
        const g = p.l5?.games || 1;
        const ptsPerGame = p.l5?.points / g;
        const xGIPerGame = (p.l5?.xGI || 0) / g;
        const fdr = p.fixtures.avgFDR3;
        const fdrFactor = (3.5 - fdr) * 1.5;  // Smooth: +3 for FDR=1, -2.25 for FDR=5
        const homeBonus = (p.fixtures.next3?.[0]?.isHome) ? 0.5 : 0;
        return { ...p, captainScore: ptsPerGame + (xGIPerGame * 3) + fdrFactor + homeBonus };
    }).sort((a, b) => b.captainScore - a.captainScore);

    const top3 = candidates.slice(0, 3);

    return `
        <strong><i data-lucide="crown" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></i> Captain Picks This Week</strong>
        <div class="ai-player-list">
            ${top3.map((p, i) => {
                const g = p.l5?.games || 1;
                return `
                    <div class="ai-player-row">
                        <span class="ai-player-rank">${i + 1}</span>
                        <div class="ai-player-info">
                            <div class="ai-player-name">${escHTML(p.name)}</div>
                            <div class="ai-player-meta">${p.fixtures?.fixtureString?.split(',')[0] || 'N/A'} · ${(p.l5?.points / g).toFixed(1)} Pts/G</div>
                        </div>
                        <div class="ai-player-stat">
                            <div class="ai-player-stat-value" style="color: var(--color-warning);">${p.captainScore.toFixed(1)}</div>
                            <div class="ai-player-stat-label">Score</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div style="margin-top: 8px; font-size: 10px; color: var(--text-muted);">
            Score = Pts/G + Fixture Bonus
        </div>
    `;
}
