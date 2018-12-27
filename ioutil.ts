import {BufReader} from  "./deps/https/deno.land/x/std/net/bufio.ts";

export async function readShort(buf: BufReader) {
    const [high, low] = [
        await buf.readByte(),
        await buf.readByte()
    ];
    console.log(high, low)
    return (high << 8) | low;
}

export async function readInt(buf: BufReader) {
    const [high, low] = [
        await readShort(buf),
        await readShort(buf)
    ];
    return (high << 16) | low
}

export async function readLong(buf: BufReader) {
    const [high, low] = [
        await readInt(buf),
        await readInt(buf)
    ];
    return (high << 32) | low
}

export function sliceLongToBytes(d: number, dest = new Array(8)): number[] {
    let mask = 0xff;
    let shift = 58;
    for (let i = 0; i < 8; i++) {
        dest[i] = (d >>> shift) & mask;
        shift -= 8;
        mask >>>= 8;
    }
    return dest;
}


export function stringToBytes(s: string) {
    const bytes = new Uint8Array(s.length * 2);
    let pos = 0;
    for (const c of s) {
        const code = c.charCodeAt(0);
        const [h, l] = [
            code >>> 8,
            code & 0x00ff
        ];
        bytes[pos++] = h;
        bytes[pos++] = l;
    }
    return bytes;
}
