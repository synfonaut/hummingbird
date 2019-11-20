const { Peer, Messages } = require("b2p2p");
import bsv from "bsv"

import { sleep } from "./helpers"

const messages = new Messages({ Block: bsv.Block, BlockHeader: bsv.BlockHeader, Transaction: bsv.Transaction, MerkleBlock: bsv.MerkleBlock });

const STATE = {
    DISCONNECTED: "DISCONNECTED",
    CONNECTING: "CONNECTING",
    CRAWLING: "CRAWLING",
    LISTENING: "LISTENING",
};

export default class Hummingbird {

    constructor(config={}) {
        this.config = config;
        if (!this.config.peer || !this.config.peer.host) { throw new Error(`expected peer.host in config`) }

        this.state = STATE.DISCONNECTED;


        this.peer = new Peer({ host: this.config.peer.host, messages });

        this.peer.on("ready", () => {
            //console.log("CONNECTED");
            this.onconnect();
            //const message = this.peer.messages.MemPool();
            //this.peer.sendMessage(message);
        });

        this.peer.on("disconnect", () => {
            this.ondisconnect();
        });

        this.peer.on("tx", async function(message) {
            //const tx = await txo.fromTx(String(message.transaction));
            //console.log("TX", tx.tx.h);
        });

        this.peer.on("inv", function(message) {
            //console.log("INV");
            //this.peer.sendMessage(peer.messages.GetData(message.inventory))
        });

        this.peer.on("error", function(message) {
            console.log("ERR", message);
        });
    }

    connect() {
        this.state = STATE.CONNECTING;
        this.peer.connect();
    }

    onconnect() {
        this.crawl();
    }

    ondisconnect(reconnect=false) {
        this.state = STATE.DISCONNECTED;
        if (reconnect) {
            this.connect();
        }
    }

    isuptodate() {
        return false;
    }

    listen() {
        this.state = STATE.LISTENING;
    }

    async crawl() {
        if (this.isuptodate()) {
            this.listen();
        } else {
            this.state = STATE.CRAWLING;

            while (true) {
                if (this.isuptodate()) {
                    //console.log("DONE CRAWLING");
                    break;
                }

                await sleep(250);
            }

            this.listen();
        }
    }

    disconnect() {
        this.peer.disconnect();
    }
}

Hummingbird.STATE = STATE;



/*
const hummingbird = new Hummingbird({
    rpc: { host: "209.50.56.81", user: "root", pass: "bitcoin" },
    peer: { host: "209.50.56.81" },
});

console.log(hummingbird);
*/
