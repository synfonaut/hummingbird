const { Peer, Messages } = require("b2p2p");
import bsv from "bsv"
import RPCClient from "bitcoind-rpc"
import txo from "txo"

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

        const rpcconfig = Object.assign({}, {
            protocol: "http",
            host: "127.0.0.1",
            port: "8332",
        }, this.config.rpc);

        this.readyfn = function() {};
        this.blockreq = null;

        this.rpc = new RPCClient(rpcconfig);

        this.peer = new Peer({ host: this.config.peer.host, messages });

        this.peer.on("ready", () => {
            this.onconnect();
        });

        this.peer.on("disconnect", () => {
            this.ondisconnect();
        });

        this.peer.on("block", async (message) => {
            if (!this.blockreq) { return }

            const header = Object.assign({}, message.block.header.toObject(), {
                height: this.blockreq.height,
            });

            const txs = await Promise.all(message.block.transactions.map(async (tx) => {
                return await txo.fromTx(tx);
            }));

            this.blockreq.resolve({ header, txs });

            this.blockreq = null;
        });

        this.peer.on("tx", async (message) => {
            //const tx = await txo.fromTx(String(message.transaction));
            //console.log("TX", tx.tx.h);
        });

        this.peer.on("inv", (message) => {
            //console.log("INV");
            //this.peer.sendMessage(peer.messages.GetData(message.inventory))
        });

        this.peer.on("error", (message) => {
            console.log("ERR", message);
        });
    }

    connect() {
        this.state = STATE.CONNECTING;
        this.peer.connect();
    }

    onconnect() {
        this.readyfn();
        this.crawl();
    }

    ondisconnect(reconnect=false) {
        this.state = STATE.DISCONNECTED;
        if (reconnect) {
            this.connect();
        }
    }

    async onblock() {
        await this.crawl();
    }

    isuptodate() {
        return false;
    }

    listen() {
        this.state = STATE.LISTENING;
    }

    ready(fn) {
        this.readyfn = fn;
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

                //console.log("waiting");
                await sleep(250);
            }

            this.listen();
        }
    }

    disconnect() {
        this.peer.disconnect();
    }

    fetch(height) {
        return new Promise((resolve, reject) => {
            this.rpc.getBlockHash(height, async (err, res) => {
                if (err) { return reject(err) }
                const hash = res.result;
                if (this.blockreq) {
                    throw new Error("block fetch can only be called one at a time");
                } else {
                    this.blockreq = { resolve, reject, height };
                    this.peer.sendMessage(this.peer.messages.GetData.forBlock(hash))
                }
            });
        });

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
