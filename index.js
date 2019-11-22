const log = require("debug")("hummingbird");

const { Peer, Messages } = require("b2p2p");
import bsv from "bsv"
import RPCClient from "bitcoind-rpc"
import txo from "txo"

import * as tape from "./tape"
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
        this.config = Object.assign({
            "tapefile": "tape.txt",
            "from": 0,
        }, config);

        if (!this.config.peer || !this.config.peer.host) { throw new Error(`expected peer.host in config`) }
        if (!this.config.tapefile) { throw new Error(`expected tapefile in config`) }
        if (!Number.isInteger(this.config.from)) { throw new Error(`expected from in config`) }

        this.state = STATE.DISCONNECTED;
        this.reconnect = (this.config.reconnect === undefined ? true : false);

        const rpcconfig = Object.assign({}, {
            protocol: "http",
            host: "127.0.0.1",
            port: "8332",
        }, this.config.rpc);

        this.ready = function() {};
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
            if (this.state === STATE.CRAWLING && this.blockreq) {
                const block = await this.parseBlock(message.block, this.blockreq.height);
                this.blockreq.resolve(block);
                this.blockreq = null;
            } else if (this.state == STATE.LISTENING) {
                this.rpc.getBlockHeader(message.block.header.hash, async (err, res) => {
                    if (err) { throw new Error(`error while fetching height for new block: ${e}`) }
                    const block = await this.parseBlock(message.block, res.result.height);
                    await this.onblock(block);
                    await this.crawl();
                });
            }
        });

        this.peer.on("tx", async (message) => {
            if (this.state == STATE.LISTENING) {
                const tx = await txo.fromTx(message.transaction);
                await this.onmempool(tx);
            }
        });

        this.peer.on("inv", (message) => {
            this.peer.sendMessage(this.peer.messages.GetData(message.inventory))
        });

        this.peer.on("error", (message) => {
            log(`error ${message}`);
        });

        log(`setup hummingbird`);
    }

    // ACTIONS

    connect() {
        log(`connect`);
        this.state = STATE.CONNECTING;
        this.peer.connect();
    }

    listen() {
        this.state = STATE.LISTENING;
        log(`listening`);
        this.fetchmempool();
    }

    async crawl() {
        log(`crawling`);

        if (await this.isuptodate()) {
            log(`done crawling`);
            this.listen();
        } else {
            this.state = STATE.CRAWLING;

            while (true) {
                if (await this.isuptodate()) {
                    log(`done crawling`);
                    break;
                }

                await this.handle(await this.curr() + 1);

                //log("waiting");
                await sleep(250);
            }

            this.listen();
        }
    }

    disconnect() {
        log(`disconnecting`);
        this.peer.disconnect();
    }

    fetchmempool() {
        log(`fetching mempool`);
        this.peer.sendMessage(this.peer.messages.MemPool());
    }

    async handle(height) {

        return new Promise(async (resolve, reject) => {
            log(`handling block ${height}`);
            const block = await this.fetch(height).catch(e => {
                console.log("E", e);
            });

            if (block) {
                const timestamp = Math.floor(Date.now() / 1000);
                const logline = `${height} ${block.header.hash} ${block.header.prevHash} ${timestamp}`;
                await tape.write(logline, this.config.tapefile);
                await this.onblock(block);
                resolve();
            } else {
                resolve();
            }
        });
    }

    // EVENTS

    async onconnect() {
        log(`on connect`);
        this.ready();
        await this.crawl();
    }

    ondisconnect() {
        log(`on disconnect`);
        this.state = STATE.DISCONNECTED;
        if (this.reconnect) {
            log(`reconnecting`);
            this.connect();
        }
    }

    async onmempool(tx) {
        //log(`onmempool ${tx.tx.h}`);
    }

    async onblock(block) {
        if (block && block.header) {
            log(`onblock ${block.header.height}`);
        } else {
            log(`onblock unknown`);
        }
    }


    // HELPERS

    async curr() {
        const height = await tape.get(this.config.tapefile);
        if (height) {
            return height;
        } else {
            return this.config.from - 1;
        }
    }

    async height() {
        return new Promise((resolve, reject) => {
            this.rpc.getBlockchainInfo(async (err, res) => {
                if (err) { reject(err) }
                else { resolve(res.result.blocks) }
            });
        });
    }

    async isuptodate() {
        return new Promise(async (resolve, reject) => {
            const curr = await this.curr();
            if (curr === (this.config.from-1)) {
                resolve(false);
            } else {
                const height = await this.height();
                resolve(curr >= height);
            }
        });
    }

    fetch(height) {
        log(`fetching block ${height}`);
        return new Promise((resolve, reject) => {

            this.state = STATE.CRAWLING;

            this.rpc.getBlockHash(height, async (err, res) => {
                if (err) { return reject(err) }
                const hash = res.result;
                if (this.blockreq) {
                    //console.log("BLOCK", this.blockreq);
                    reject("block fetch can only be called one at a time");
                } else {
                    this.blockreq = { resolve, reject, height };
                    this.peer.sendMessage(this.peer.messages.GetData.forBlock(hash))
                }
            });
        });
    }

    async parseBlock(block, height) {
        const header = Object.assign( block.header.toObject(), { height });
        const txs = await Promise.all(block.transactions.map(async (tx) => {
            return Object.assign(await txo.fromTx(tx), {
                blk: {
                    i: header.height,
                    h: header.hash,
                    t: header.time,
                }
            });
        }));

        log(`fetched block ${header.height}`);
        return { header, txs };
    }

}

Hummingbird.STATE = STATE;

