# Hummingbird

> A Real-time Bitcoin Application Framework

Hummingbird helps you build real-time Bitcoin applications. Optimizing for speed and stability, Hummingbird handles the lower levels between your app and Bitcoin, ensuring your user experiences are always fast and reliable.

## Example

Here's an example of a simple Hummingbird application

    const log = require("debug")("hummingbird");

    import Hummingbird from "./index"
    import { connect, isduplicate } from "./helpers"

    const config = {
        rpc: { host: "127.0.0.1", user: "root", pass: "bitcoin" },
        peer: { host: "127.0.0.1" },
        from: 600000,
    };

    const h = new Hummingbird(config);

    h.ready = async function() {
        h.db = await connect("hummingbird");
    }

    h.ontransaction = async function(tx) {
        const db = (tx.blk ? "c": "u");
        log(`ontransaction processing tx ${tx.tx.h}`);
        try {
            await h.db.collection(db).insertOne(tx);
        } catch (e) {
            if (!isduplicate(e, ["tx.h"]) && !isduplicate(e, ["_id"])) {
                throw e;
            }
        }

        return true;
    }

    h.onrealtime = async function(block) {
        log(`realtime`);

        log(`refreshing mempool`);
        await h.db.collection("u").deleteMany({});
        await h.fetchmempool();
    }

    h.start();


