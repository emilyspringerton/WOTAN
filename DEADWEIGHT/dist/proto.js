// DEADWEIGHT wire protocol v3 codec — see docs/WIRE_PROTOCOL.md (that doc is the source of truth;
// this file is a hand-written, direct TypeScript port of its byte layout, not generated).
//
// Little-endian. Frame = u16 len (bytes after this field) + u8 type + payload. Strings are fixed
// 16-byte NUL-padded UTF-8 ("name16"). This module only encodes/decodes bytes; it knows nothing
// about game rules (those come from generated/CardRules.ts) or transport (WebSocket, handled by
// client.ts).
export const PROTO_VERSION = 3;
export const ClientMsg = {
    HELLO: 0x01,
    QUEUE: 0x02,
    PLAY: 0x03,
    LEAVE: 0x04,
    PING: 0x05,
    AUTH: 0x06,
    DRAFT_PICK: 0x07,
};
export const ServerMsg = {
    WELCOME: 0x81,
    QUEUED: 0x82,
    MATCH_FOUND: 0x83,
    ROUND_START: 0x84,
    PLAY_ACK: 0x85,
    PLAY_REJECT: 0x86,
    ROUND_RESULT: 0x87,
    MATCH_END: 0x88,
    PONG: 0x89,
    DRAFT_OFFER: 0x8a,
    DRAFT_DONE: 0x8b,
    ERROR: 0x8f,
};
// --- little-endian binary writer, growable, matching the frame shape above ---
class Writer {
    constructor() {
        this.bytes = [];
    }
    u8(v) { this.bytes.push(v & 0xff); }
    i8(v) { this.bytes.push(v & 0xff); }
    u16(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); }
    u32(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); }
    bytesRaw(b) { for (const x of b)
        this.bytes.push(x & 0xff); }
    name16(s) {
        const enc = new TextEncoder().encode(s).slice(0, 16);
        const buf = new Uint8Array(16);
        buf.set(enc);
        this.bytesRaw(buf);
    }
    toBytes() { return new Uint8Array(this.bytes); }
}
// --- little-endian binary reader over one frame's payload ---
class Reader {
    constructor(view) {
        this.view = view;
        this.pos = 0;
    }
    u8() { return this.view.getUint8(this.pos++); }
    i8() { return this.view.getInt8(this.pos++); }
    u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
    u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
    name16() {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, 16);
        this.pos += 16;
        const nul = bytes.indexOf(0);
        return new TextDecoder().decode(nul === -1 ? bytes : bytes.subarray(0, nul));
    }
    remaining() { return this.view.byteLength - this.pos; }
}
/** Wraps a type+payload into a full frame (u16 len + u8 type + payload), ready to send. */
function frame(type, payload) {
    const len = payload.length + 1; // +1 for the type byte, matching "len = bytes after this field"
    const out = new Uint8Array(2 + 1 + payload.length);
    out[0] = len & 0xff;
    out[1] = (len >> 8) & 0xff;
    out[2] = type;
    out.set(payload, 3);
    return out;
}
export function encodeHello(mode, kind, name, token) {
    const w = new Writer();
    w.u8(PROTO_VERSION);
    w.u8(mode);
    w.u8(kind);
    w.name16(name);
    const tokenBytes = new TextEncoder().encode(token).slice(0, 200);
    w.u8(tokenBytes.length);
    w.bytesRaw(tokenBytes);
    return frame(ClientMsg.HELLO, w.toBytes());
}
/** AUTH (0x06): the real IDUNA player JWT, up to 900 bytes (docs/WIRE_PROTOCOL.md's AUTH row --
 * "Real IDUNA ES256 JWTs are ~400-500 bytes, far above HELLO's 200-byte token field"). Sent right
 * after HELLO (which then carries an empty inline token) whenever a real token exists; a
 * --no-auth server just ignores it. */
export function encodeAuth(token) {
    const w = new Writer();
    const tokenBytes = new TextEncoder().encode(token).slice(0, 900);
    w.u16(tokenBytes.length);
    w.bytesRaw(tokenBytes);
    return frame(ClientMsg.AUTH, w.toBytes());
}
/** matchToken (S537 Duel Phase 2): a purely additive, no-proto-bump extension of QUEUE's already-
 * variable payload (0, 1, or 33 bytes -- docs/WIRE_PROTOCOL.md). When present, the wire form is
 * ALWAYS same_deck-byte-then-32-raw-token-bytes (matching core/protocol.c's dw_encode -- same_deck
 * is written even when 0, since the 33-byte length itself is what signals "token present" to the
 * decoder). Encoded to exactly 32 bytes, zero-padded/truncated, matching the C client's fixed
 * char[33] buffer (IDUNA always mints exactly 32 hex chars, so this never actually truncates). */
export function encodeQueue(sameDeck, matchToken) {
    const w = new Writer();
    if (matchToken) {
        w.u8(sameDeck ?? 0);
        const tokenBytes = new Uint8Array(32);
        tokenBytes.set(new TextEncoder().encode(matchToken).slice(0, 32));
        w.bytesRaw(tokenBytes);
    }
    else if (sameDeck !== undefined) {
        w.u8(sameDeck);
    }
    return frame(ClientMsg.QUEUE, w.toBytes());
}
export function encodePlay(matchId, round, slot) {
    const w = new Writer();
    w.u32(matchId);
    w.u8(round);
    w.i8(slot);
    return frame(ClientMsg.PLAY, w.toBytes());
}
export function encodeLeave() {
    return frame(ClientMsg.LEAVE, new Uint8Array(0));
}
export function encodePing(nonce) {
    const w = new Writer();
    w.u32(nonce);
    return frame(ClientMsg.PING, w.toBytes());
}
/** Decodes one already-length-delimited frame's type+payload bytes (see FrameDecoder below for
 * pulling exactly one frame's bytes out of a WebSocket message / TCP stream). */
export function decodeServerFrame(typeAndPayload) {
    const view = new DataView(typeAndPayload.buffer, typeAndPayload.byteOffset, typeAndPayload.byteLength);
    const msgType = view.getUint8(0);
    const r = new Reader(new DataView(typeAndPayload.buffer, typeAndPayload.byteOffset + 1, typeAndPayload.byteLength - 1));
    switch (msgType) {
        case ServerMsg.WELCOME: {
            const sessionId = r.u32();
            const flags = r.u8();
            return { type: 'WELCOME', sessionId, fastForward: !!(flags & 1), authRequired: !!(flags & 2) };
        }
        case ServerMsg.QUEUED:
            return { type: 'QUEUED', waiting: r.u16() };
        case ServerMsg.MATCH_FOUND: {
            const matchId = r.u32();
            const seed = r.u32();
            const seat = r.u8();
            const oppName = r.name16();
            const oppKind = r.u8();
            return { type: 'MATCH_FOUND', matchId, seed, seat, oppName, oppKind };
        }
        case ServerMsg.ROUND_START: {
            const round = r.u8();
            const hullYou = r.i8();
            const hullOpp = r.i8();
            const energyYou = r.u8();
            const energyOpp = r.u8();
            const hand = [r.i8(), r.i8(), r.i8(), r.i8()];
            const oppHandSize = r.u8();
            const deadlineMs = r.u16();
            const armorYou = r.u8();
            const armorOpp = r.u8();
            const vaultYou = r.i8();
            const vaultOpp = r.i8();
            const lockMask = r.u8();
            const statusYou = r.u8();
            const statusOpp = r.u8();
            return {
                type: 'ROUND_START', round, hullYou, hullOpp, energyYou, energyOpp, hand, oppHandSize,
                deadlineMs, armorYou, armorOpp, vaultYou, vaultOpp, lockMask, statusYou, statusOpp,
            };
        }
        case ServerMsg.PLAY_ACK:
            return { type: 'PLAY_ACK', matchId: r.u32(), round: r.u8() };
        case ServerMsg.PLAY_REJECT:
            return { type: 'PLAY_REJECT', matchId: r.u32(), round: r.u8(), reason: r.u8() };
        case ServerMsg.ROUND_RESULT: {
            const round = r.u8();
            const cardYou = r.i8();
            const cardOpp = r.i8();
            const dmgToYou = r.u8();
            const dmgToOpp = r.u8();
            const hullYou = r.i8();
            const hullOpp = r.i8();
            const effYou = r.i8();
            const effOpp = r.i8();
            const armorYou = r.u8();
            const armorOpp = r.u8();
            const vaultYou = r.i8();
            const vaultOpp = r.i8();
            const healYou = r.u8();
            const healOpp = r.u8();
            const rollYou = r.u8();
            const rollOpp = r.u8();
            const flagsYou = r.u8();
            const flagsOpp = r.u8();
            return {
                type: 'ROUND_RESULT', round, cardYou, cardOpp, dmgToYou, dmgToOpp, hullYou, hullOpp,
                effYou, effOpp, armorYou, armorOpp, vaultYou, vaultOpp, healYou, healOpp, rollYou, rollOpp,
                flagsYou, flagsOpp,
            };
        }
        case ServerMsg.MATCH_END:
            return { type: 'MATCH_END', matchId: r.u32(), result: r.u8(), reason: r.u8() };
        case ServerMsg.PONG:
            return { type: 'PONG', nonce: r.u32() };
        case ServerMsg.DRAFT_OFFER: {
            const pickNo = r.u8();
            const total = r.u8();
            const card = [r.i8(), r.i8()];
            const left = [r.u8(), r.u8(), r.u8()];
            return { type: 'DRAFT_OFFER', pickNo, total, card, left };
        }
        case ServerMsg.DRAFT_DONE: {
            const deckId = r.u32();
            const cards = [];
            for (let i = 0; i < 23; i++)
                cards.push(r.i8());
            return { type: 'DRAFT_DONE', deckId, cards };
        }
        case ServerMsg.ERROR:
            return { type: 'ERROR', code: r.u8() };
        default:
            return { type: 'UNKNOWN', msgType };
    }
}
/** Feed raw bytes in as they arrive (WebSocket binary messages may split or coalesce frames);
 * pulls out complete frames and calls onFrame(type, payloadWithType) for each. Payload passed to
 * onFrame includes the leading type byte, matching decodeServerFrame's own expected input. */
export class FrameDecoder {
    constructor() {
        this.buf = new Uint8Array(0);
    }
    push(chunk, onFrame) {
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
        while (this.buf.length >= 2) {
            const len = this.buf[0] | (this.buf[1] << 8);
            if (this.buf.length < 2 + len)
                break; // wait for more bytes
            const typeAndPayload = this.buf.slice(2, 2 + len);
            this.buf = this.buf.slice(2 + len);
            onFrame(typeAndPayload);
        }
    }
}
//# sourceMappingURL=proto.js.map