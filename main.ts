import {serve} from "./deps/https/deno.land/x/std/net/http.ts";
import {acceptWebSocket, isWebSocketCloseEvent, isWebSocketPingEvent} from "./ws.ts";

async function main () {
    console.log("websocket server is running on 0.0.0.0:8080");
    for await (const req of serve("0.0.0.0:8080")) {
        const [ok, sock] = await acceptWebSocket(req);
        if (ok) {
            console.log("socket connected!");
            for await (const ev of sock.handle()) {
                if (typeof ev === "string") {
                    // text message
                    console.log("ws:Text", ev);
                    await sock.send(ev);
                } else if (ev instanceof Uint8Array) {
                    // binary message
                    console.log("ws:Binary", ev);
                } else if (isWebSocketPingEvent(ev)) {
                    const [_, body] = ev;
                    // ping
                    console.log("ws:Ping", body);
                } else if (isWebSocketCloseEvent(ev)) {
                    // close
                    const {code, reason} = ev;
                    console.log("ws:Close", code, reason);
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