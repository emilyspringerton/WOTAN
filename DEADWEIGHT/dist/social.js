// social.ts -- friends, public profiles, and friendly-challenge duels for the DEADWEIGHT browser
// client (S537 continued). Talks to the exact same IDUNA routes WOTAN's friends.html/profile.html
// use (IDUNA internal/http/handlers/game_social.go, under /api/v1/games/deadweight/...) -- same
// identity, same server, a second real consumer rather than a parallel design.
const GAME = 'deadweight';
async function api(idunaBase, token, path, opts) {
    const headers = { 'Content-Type': 'application/json' };
    if (token)
        headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(idunaBase + '/api/v1/games/' + GAME + path, { ...opts, headers: { ...headers, ...opts?.headers } });
    let body = null;
    try {
        body = await res.json();
    }
    catch (e) {
        /* no body */
    }
    if (!res.ok) {
        const msg = (body && (body.error || body.message)) || res.statusText || 'HTTP ' + res.status;
        throw new Error(msg);
    }
    return body;
}
export function getProfile(idunaBase, playerID) {
    return api(idunaBase, '', '/players/' + encodeURIComponent(playerID) + '/profile');
}
export function listFriends(idunaBase, token) {
    return api(idunaBase, token, '/friends');
}
export function removeFriend(idunaBase, token, playerID) {
    return api(idunaBase, token, '/friends/' + encodeURIComponent(playerID), { method: 'DELETE' });
}
export function listFriendRequests(idunaBase, token) {
    return api(idunaBase, token, '/friend-requests');
}
export function sendFriendRequest(idunaBase, token, toPlayerID) {
    return api(idunaBase, token, '/friend-requests', { method: 'POST', body: JSON.stringify({ to_player_id: toPlayerID }) });
}
export function respondFriendRequest(idunaBase, token, id, accept) {
    return api(idunaBase, token, '/friend-requests/' + id + '/' + (accept ? 'accept' : 'decline'), { method: 'POST' });
}
export function listDuels(idunaBase, token) {
    return api(idunaBase, token, '/duels');
}
export function createDuel(idunaBase, token, toPlayerID) {
    return api(idunaBase, token, '/duels', { method: 'POST', body: JSON.stringify({ to_player_id: toPlayerID }) });
}
export function respondDuel(idunaBase, token, id, accept) {
    return api(idunaBase, token, '/duels/' + id + '/' + (accept ? 'accept' : 'decline'), { method: 'POST' });
}
//# sourceMappingURL=social.js.map