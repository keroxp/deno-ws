import {serve} from "./deps/https/deno.land/x/std/net/http.ts";
import {acceptWebSocket, isWebSocketCloseEvent, isWebSocketPingEvent} from "./ws.ts";

async function main () {
    console.log("websocket server is running on 0.0.0.0:8080");
    for await (const req of serve("0.0.0.0:8080")) {
        console.log(req.headers);
        const [ok, sock] = await acceptWebSocket(req);
        if (ok) {
            await sock.send("hello");
            for await (const ev of sock.handle()) {
                if (typeof ev === "string") {
                    // text message
                } else if (ev instanceof Uint8Array) {
                    // binary message
                } else if (isWebSocketPingEvent(ev)) {
                    const [_, body] = ev;
                } else if (isWebSocketCloseEvent(ev)) {

                }
            }
        } else {
            await req.respond({
                status: 200,
                headers: new Headers({
                    "Content-Type": "text/plain"
                }),
                body: new TextEncoder().encode("Hello!")
            });
        }
    }
}

main();