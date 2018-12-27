import {Conn, Buffer} from "deno"
import {ServerRequest} from "./deps/https/deno.land/x/std/net/http.ts";
import {BufReader, BufWriter} from "./deps/https/deno.land/x/std/net/bufio.ts";
import {readLong, readShort, sliceLongToBytes, stringToBytes} from "./ioutil.ts";
import {Sha1} from "./crypt.ts";

export const OpCodeContinue = 0x0;
export const OpCodeTextFrame = 0x1;
export const OpCodeBinaryFrame = 0x2;
export const OpCodeClose = 0x8;
export const OpcodePing = 0x9;
export const OpcodePong = 0xA;


export type WebSocketEvent = string | Uint8Array | WebSocketCloseEvent | WebSocketPingEvent | WebSocketPongEvent;

export type WebSocketCloseEvent = {
    code: number
    reason?: string
};
export function isWebSocketCloseEvent(a): a is WebSocketCloseEvent {
    return a && typeof a["code"] === "number"
}

export type WebSocketPingEvent = ["ping", Uint8Array]
export function isWebSocketPingEvent(a): a is WebSocketPingEvent {
    return Array.isArray(a) && a[0] === "ping" && a[1] instanceof Uint8Array;
}
export type WebSocketPongEvent = ["pong", Uint8Array]
export function isWebSocketPongEvent(a): a is WebSocketPongEvent {
    return Array.isArray(a) && a[0] === "pong" && a[1] instanceof Uint8Array;
}

export type WebSocketFrame = {
    isLastFrame: boolean,
    opcode: number,
    mask?: Uint8Array,
    payload: Uint8Array
}

class WebSocket {
    constructor(private conn: Conn, private mask?: Uint8Array) {
    }

    async* handle(): AsyncIterableIterator<WebSocketEvent> {
        let frames: WebSocketFrame[] = [];
        let payloadsLength = 0;
        for await (const frame of receive(this.conn)) {
            unmask(frame.payload, frame.mask);
            switch (frame.opcode) {
                case OpCodeTextFrame:
                case OpCodeBinaryFrame:
                case OpCodeContinue:
                    frames.push(frame);
                    payloadsLength += frame.payload.length;
                    if (frame.isLastFrame) {
                        const concat = new Uint8Array(payloadsLength);
                        let offs = 0;
                        for (const frame of frames) {
                            concat.set(frame.payload, offs);
                            offs += frame.payload.length;
                        }
                        if (frames[0].opcode === OpCodeTextFrame) {
                            // text
                            yield new Buffer(concat).toString()
                        } else {
                            // binary
                            yield concat
                        }
                        frames = [];
                    }
                    break;
                case OpCodeClose:
                    const code = (frame.payload[0] << 16) | frame.payload[1];
                    const reason = new Buffer(frame.payload.subarray(2, frame.payload.length)).toString();
                    yield {code, reason};
                    return;
                case OpcodePing:
                    yield ["ping", frame.payload] as WebSocketPingEvent;
                    break;
                case OpcodePong:
                    yield ["pong", frame.payload] as WebSocketPongEvent;
                    break;
            }
        }
    }

    async send(data: string | Uint8Array) {
        const opcode = typeof data === "string" ? OpCodeTextFrame : OpCodeBinaryFrame;
        const payload = typeof data === "string" ? stringToBytes(data) : data;
        let written = payload.length;
        while (written < payload.length) {
            const l = Math.min(0xffffffff, payload.length - written);
            const isLastFrame = payload.length - written - l === 0;
            await writeFrame({
                isLastFrame,
                opcode: written === 0 ? opcode : OpCodeContinue,
                payload: payload.subarray(written, l),
                mask: this.mask,
            }, this.conn)
        }
    }

    async ping(data: string | Uint8Array) {
        const payload = typeof data === "string" ? stringToBytes(data) : data;
        await writeFrame({
            isLastFrame: true,
            opcode: OpCodeClose,
            mask: this.mask,
            payload
        }, this.conn)
    }

    private _isClosed = false;
    get isClosed() {
        return this._isClosed;
    }

    async close(code: number, reason?: string) {
        try {
            const header = [
                (code >>> 8), (code & 0x00ff)
            ];
            let payload: Uint8Array;
            if (reason) {
                const reasonBytes = stringToBytes(reason);
                payload = new Uint8Array(2 + reasonBytes.length);
                payload.set(header);
                payload.set(reasonBytes, 2);
            } else {
                payload = new Uint8Array(header);
            }
            await writeFrame({
                isLastFrame: true,
                opcode: OpCodeClose,
                mask: this.mask,
                payload
            }, this.conn);
        } finally {
            this._isClosed = true;
        }
    }
}

export async function* receive(conn: Conn): AsyncIterableIterator<WebSocketFrame> {
    let receiving = true;
    const reader = new BufReader(conn);
    while (receiving) {
        const frame = await readFrame(reader);
        switch (frame.opcode) {
            case OpCodeTextFrame:
            case OpCodeBinaryFrame:
            case OpCodeContinue:
                yield frame;
                break;
            case OpCodeClose:
                await writeFrame({
                    isLastFrame: true,
                    opcode: OpCodeClose,
                    payload: frame.payload,
                }, conn);
                conn.close();
                yield frame;
                receiving = false;
                break;
            case OpcodePing:
                await writeFrame({
                    isLastFrame: true,
                    opcode: OpcodePong,
                    payload: frame.payload
                }, conn);
                yield frame;
                break;
            case OpcodePong:
                yield frame;
                break;
        }
    }
}

export async function writeFrame(frame: WebSocketFrame, conn: Conn) {
    let payloadLength = frame.payload.length;
    let header: Uint8Array;
    const hasMask = (frame.mask ? 1 : 0) << 7;
    if (payloadLength < 126) {
        header = new Uint8Array([
            (0b1000 << 4) | frame.opcode,
            (hasMask | (payloadLength & 0xff))
        ]);
    } else if (payloadLength < 0xffff) {
        header = new Uint8Array([
            (0b1000 << 4) | frame.opcode,
            (hasMask | 0b01111110),
            payloadLength >>> 8,
            (payloadLength & 0x00ff)
        ]);
    } else {
        header = new Uint8Array([
            (0b1000 << 4) | frame.opcode,
            (hasMask | 0b01111111),
            ...sliceLongToBytes(payloadLength)
        ]);
    }
    await conn.write(header);
    unmask(frame.payload, frame.mask    );
    await conn.write(frame.payload);
}

export function unmask(payload: Uint8Array, mask: Uint8Array) {
    if (mask) {
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }
}
export async function acceptWebSocket(req: ServerRequest): Promise<[boolean, WebSocket]> {
    if (req.headers["upgrade"]) {
        const sock = new WebSocket(req.conn);
        const secKey = req.headers["sec-websocket-key"];
        const secAccept = createHashFromNonce(secKey);
        await req.respond({
            status: 101,
            headers: new Headers({
                "Upgrade": "websocket",
                "Connection": "Upgrade",
                "Sec-WebSocket-Accept": secAccept,
            })
        });
        return [true, sock];
    }
    return [false, null];
}

const kGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function createHashFromNonce(nonce: string) {
    const sha1 = new Sha1();
    sha1.update(nonce + kGUID);
    return btoa(sha1.hex());
}

export async function readFrame(buf: BufReader): Promise<WebSocketFrame> {
    let b = await buf.readByte();
    let isLastFrame = false;
    switch (b >>> 4) {
        case 0b1000:
            isLastFrame = true;
            break;
        case 0b0000:
            isLastFrame = false;
            break;
        default:
            throw new Error("invalid signature");
    }
    const opcode = b & 0x0f;
    // has_mask & payload
    b = await buf.readByte();
    const hasMask = b >>> 7;
    let payloadLength = b & 0b01111111;
    if (payloadLength === 126) {
        payloadLength = await readShort(buf);
    } else if (payloadLength === 127) {
        payloadLength = await readLong(buf);
    }
    // mask
    let mask;
    if (hasMask) {
        mask = new Uint8Array(4);
        await buf.readFull(mask);
    }
    // payload
    const payload = new Uint8Array(payloadLength);
    await buf.readFull(payload);
    return {
        isLastFrame, opcode, mask, payload
    }
}
