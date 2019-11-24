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
            "state_machines": [],
        }, config);

        if (!this.config.peer || !this.config.peer.host) { throw new Error(`expected peer.host in config`) }
        if (!this.config.tapefile) { throw new Error(`expected tapefile in config`) }
        if (!Number.isInteger(this.config.from)) { throw new Error(`expected from in config`) }

        this.state_machines = this.config.state_machines.map(state_machine => {
            state_machine.log = log.extend(state_machine.constructor.name.toLowerCase());
            return state_machine;
        });
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

        this.peer.on("disconnect", async () => {
            await this.ondisconnect();
        });

        this.peer.on("block", async (message) => {
            if (this.state === STATE.CRAWLING && this.blockreq) {
                const block = await this.parseBlock(message.block, this.blockreq.height);
                const diff = (Date.now() - this.blockreq.start) / 1000;
                log(`fetched block ${block.header.height} in ${diff} seconds`);
                this.blockreq.resolve(block);
                this.blockreq = null;
            } else if (this.state == STATE.LISTENING) {
                this.rpc.getBlockHeader(message.block.header.hash, async (err, res) => {
                    if (err) { throw new Error(`error while fetching height for new block: ${e}`) }
                    const block = await this.parseBlock(message.block, res.result.height);
                    await this.handleblock(block);
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

    async start() {
        log(`start`);

        for (const state_machine of this.state_machines) {
            if (state_machine.onstart) {
                await state_machine.onstart();
            }
        }

        await this.onstart();

        this.connect();
    }

    connect() {
        log(`connect`);
        this.state = STATE.CONNECTING;
        this.peer.connect();
    }

    listen() {
        this.state = STATE.LISTENING;
        log(`listening`);
    }

    async crawl() {
        log(`crawling`);

        if (await this.isuptodate()) {
            this.onrealtime();
            this.listen();
        } else {
            this.state = STATE.CRAWLING;

            while (true) {
                if (await this.isuptodate()) {
                    this.onrealtime();
                    break;
                }

                await this.crawlblock(await this.curr() + 1);

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

    async crawlblock(height) {
        return new Promise(async (resolve, reject) => {
            log(`handling block ${height}`);
            const block = await this.fetch(height).catch(e => {
                log(`fetch error ${e}`);
            });

            if (block) {
                await this.handleblock(block);
                resolve();
            } else {
                resolve();
            }
        });
    }

    async handleblock(block) {
        await this.onblock(block);

        const timestamp = Math.floor(Date.now() / 1000);
        const logline = `BLOCK ${block.header.height} ${block.header.hash} ${block.header.prevHash} ${timestamp}`;
        await tape.write(logline, this.config.tapefile);
    }

    // EVENTS

    async onconnect() {
        log(`on connect`);
        this.ready();
        await this.crawl();
    }

    async ondisconnect() {
        log(`on disconnect`);
        this.state = STATE.DISCONNECTED;
        if (this.reconnect) {
            log(`reconnecting`);
            this.connect();
        }
    }

    async onmempool(tx) {
        for (const state_machine of this.state_machines) {
            await state_machine.ontransaction(tx);
        }
    }

    async onblock(block) {
        if (block && block.header) {
            log(`onblock ${block.header.height}`);
        } else {
            log(`onblock unknown`);
        }

        log(`processing block ${block.header.height} with ${block.txs.length} txs`);
        const blockstart = Date.now();

        for (const state_machine of this.state_machines) {
            state_machine.log(`processing block ${block.header.height} with ${block.txs.length} txs`);
            let start = Date.now();
            if (state_machine.ontransactions) {
                await state_machine.ontransactions(block.txs, block);
            } else {
                for (const tx of block.txs) {
                    await state_machine.ontransaction(tx);
                }
            }
            let diff = Date.now() - start;
            state_machine.log(`finished processing block ${block.header.height} with ${block.txs.length} txs in ${diff/1000} seconds`);
        }

        let blockdiff = Date.now() - blockstart;
        log(`finished processing block ${block.header.height} with ${block.txs.length} txs in ${blockdiff/1000} seconds`);
    }

    async onstart() { }
    async onrealtime() { log(`realtime`) }

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
                    this.blockreq = { resolve, reject, height, start: Date.now() };
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

        return { header, txs };
    }

}

Hummingbird.STATE = STATE;

