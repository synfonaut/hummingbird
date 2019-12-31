'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var bsv = _interopDefault(require('bsv'));
var RPCClient = _interopDefault(require('bitcoind-rpc'));
var txo = _interopDefault(require('txo'));
var Queue = _interopDefault(require('promise-queue'));
var fs = _interopDefault(require('fs'));
var ReadLastLines = _interopDefault(require('read-last-lines'));

function get(file) {
    return new Promise((resolve, reject) => {
        ReadLastLines.read(file, 10).then(str => {
            const lines = str.split("\n").filter(line => !!line);
            const last = lines.pop();
            const line = last.split(" ");
            if (line.length !== 5) { throw new Error("expected tape to have 4 elements") }
            if (line[0] === "BLOCK") {
                const height = Number(line[1]);
                resolve(height);
            } else {
                resolve(null);
            }
        }).catch(e => {
            resolve(null);
        });
    });
}

function write(line, file) {
    return new Promise((resolve, reject) => {
        try {
            fs.appendFileSync(file, `${line}\n`);
            resolve(true);
        } catch (e) {
            reject(e);
        }
    });
}

const log = require("debug")("hummingbird:helpers");

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const log$1 = require("debug")("hummingbird");

const { Peer, Messages } = require("b2p2p");


const messages = new Messages({ Block: bsv.Block, BlockHeader: bsv.BlockHeader, Transaction: bsv.Transaction, MerkleBlock: bsv.MerkleBlock });

const STATE = {
    DISCONNECTED: "DISCONNECTED",
    CONNECTING: "CONNECTING",
    CRAWLING: "CRAWLING",
    LISTENING: "LISTENING",
};

const MODE = {
    BOTH: "BOTH",
    MEMPOOL: "MEMPOOL",
    BLOCK: "BLOCK",
};

class Hummingbird {

    constructor(config={}) {
        this.config = Object.assign({
            "tapefile": "tape.txt",
            "from": 0,
            "state_machines": [],
            "mode": MODE.BOTH,
        }, config);

        if (!this.config.peer || !this.config.peer.host) { throw new Error(`expected peer.host in config`) }
        if (!this.config.tapefile) { throw new Error(`expected tapefile in config`) }
        if (!Number.isInteger(this.config.from)) { throw new Error(`expected from in config`) }

        this.state_machines = this.config.state_machines.map(state_machine => {
            state_machine.log = log$1.extend(state_machine.constructor.name.toLowerCase());
            return state_machine;
        });

        this.state = STATE.DISCONNECTED;

        this.mode = this.config.mode.toUpperCase();
        if (!MODE[this.mode]) { throw new Error(`unexpected mode ${this.mode}`) }

        this.reconnect = (this.config.reconnect === undefined ? true : false);

        const rpcconfig = Object.assign({}, {
            protocol: "http",
            host: "127.0.0.1",
            port: "8332",
        }, this.config.rpc);

        this.ready = function() {};
        this.blockreq = null;

        this.queue = new Queue(1, Infinity);

        this.rpc = new RPCClient(rpcconfig);

        this.currheight = 0;
        this.blockheight = 0;

        this.peer = new Peer({ host: this.config.peer.host, messages });

        this.peer.on("ready", () => {
            this.onconnect();
        });

        this.peer.on("disconnect", async () => {
            await this.ondisconnect();
        });

        this.peer.on("block", async (message) => {
            if (this.mode == MODE.MEMPOOL) {
                this.rpc.getBlockHeader(message.block.header.hash, async (err, res) => {
                    if (err) { throw new Error(`error while fetching height for new block: ${e}`) }
                    this.blockheight = res.result.height;
                });
            } else {
                if (this.state === STATE.CRAWLING && this.blockreq) {
                    const block = await this.parseBlock(message.block, this.blockreq.height);
                    const diff = (Date.now() - this.blockreq.start) / 1000;
                    log$1(`fetched block ${block.header.height} in ${diff} seconds`);
                    this.blockreq.resolve(block);
                    this.blockreq = null;
                } else if (this.state == STATE.LISTENING) {
                    this.rpc.getBlockHeader(message.block.header.hash, async (err, res) => {
                        if (err) { throw new Error(`error while fetching height for new block: ${e}`) }
                        this.blockheight = res.result.height;
                        const block = await this.parseBlock(message.block, res.result.height);
                        await this.handleblock(block);
                        await this.crawl();
                    });
                }
            }
        });

        this.peer.on("tx", async (message) => {
            if (this.mode == MODE.MEMPOOL || this.mode == MODE.BOTH) {
                if (this.state == STATE.LISTENING) {
                    const tx = await txo.fromTx(message.transaction);
                    this.queue.add(() => {
                        return this.onmempool(tx); // return a promise
                    }).catch(e => {
                        log$1(`error while processing queue`);
                        throw e;
                    });
                }
            }
        });

        this.peer.on("inv", (message) => {
            this.peer.sendMessage(this.peer.messages.GetData(message.inventory));
        });

        this.peer.on("error", (message) => {
            log$1(`error ${message}`);
        });

        if (this.mode == MODE.MEMPOOL) {
            log$1(`setup hummingbird in mempool`);
        } else if (this.mode == MODE.BLOCK) {
            log$1(`setup hummingbird in block`);
        }  else {
            log$1(`setup hummingbird`);
        }
    }

    // ACTIONS

    async start() {
        log$1(`start`);

        for (const state_machine of this.state_machines) {
            if (state_machine.onstart) {
                await state_machine.onstart();
            }
        }

        await this.onstart();

        this.connect();
    }

    connect() {
        log$1(`connect`);
        this.state = STATE.CONNECTING;
        this.peer.connect();
    }

    listen() {
        this.state = STATE.LISTENING;
        log$1(`listening`);
    }

    async crawl() {
        log$1(`crawling`);

        if (await this.isuptodate()) {
            await this.onrealtime();
            this.listen();
        } else {
            this.state = STATE.CRAWLING;

            while (true) {
                if (await this.isuptodate()) {
                    await this.onrealtime();
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
        log$1(`disconnecting`);
        try {
            this.peer.disconnect();
        } catch (e) {}
    }

    fetchmempool() {
        log$1(`fetching mempool`);
        this.peer.sendMessage(this.peer.messages.MemPool());
    }

    async crawlblock(height) {
        return new Promise(async (resolve, reject) => {
            if (this.blockheight > 0) {
                log$1(`handling block ${height} (${this.blockheight - height} behind)`);
            } else {
                log$1(`handling block ${height}`);
            }
            const block = await this.fetch(height).catch(e => {
                log$1(`fetch error ${e}`);
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
        await write(logline, this.config.tapefile);
    }

    async wait() {
        const curr = await this.curr();
        const height = await this.height();
        if (curr === height) {
            await this.onrealtime();
            this.listen();
        } else {
            log$1(`waiting for realtime ${height-curr} behind ${height}`);
            setTimeout(this.wait.bind(this), 10000);
        }
    }

    // EVENTS

    async onconnect() {
        log$1(`on connect`);
        this.ready();

        if (this.mode == MODE.MEMPOOL) {
            this.wait();
        } else {
            this.crawl();
        }
    }

    async ondisconnect() {
        log$1(`on disconnect`);
        this.state = STATE.DISCONNECTED;
        if (this.reconnect) {
            log$1(`reconnecting`);
            this.connect();
        }
    }

    async onmempool(tx) {
        for (const state_machine of this.state_machines) {
            if (state_machine.onmempool) {
                await state_machine.onmempool(tx);
            } else {
                await state_machine.ontransaction(tx);
            }
        }
    }

    async ontransaction(tx) {
        for (const state_machine of this.state_machines) {
            await state_machine.ontransaction(tx);
        }
    }

    async onblock(block) {
        if (block && block.header) {
            log$1(`onblock ${block.header.height}`);
        } else {
            log$1(`onblock unknown`);
        }

        log$1(`processing block ${block.header.height} with ${block.txs.length} txs`);
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
        log$1(`finished processing block ${block.header.height} with ${block.txs.length} txs in ${blockdiff/1000} seconds`);
    }

    async onstart() { }
    async onrealtime() {
        log$1(`realtime`);
        for (const state_machine of this.state_machines) {
            if (state_machine.onrealtime) {
                await state_machine.onrealtime();
            }
        }

        if (this.mode == MODE.MEMPOOL || this.mode == MODE.BOTH) {
            await this.fetchmempool();
        }
    }

    // HELPERS

    async curr() {
        let height = await get(this.config.tapefile);
        if (!height) {
            height = this.config.from - 1;
        }

        this.currheight = height;
        return this.currheight;
    }

    async height() {
        return new Promise((resolve, reject) => {
            this.rpc.getBlockchainInfo(async (err, res) => {
                if (err) { reject(err); }
                else {
                    this.blockheight = res.result.blocks;
                    resolve(this.blockheight);
                }
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
        log$1(`fetching block ${height}`);
        return new Promise((resolve, reject) => {

            this.state = STATE.CRAWLING;

            this.rpc.getBlockHash(height, async (err, res) => {
                if (err) { return reject(err) }
                const hash = res.result;
                if (this.blockreq) {
                    reject("block fetch can only be called one at a time");
                } else {
                    this.blockreq = { resolve, reject, height, start: Date.now() };
                    this.peer.sendMessage(this.peer.messages.GetData.forBlock(hash));
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
Hummingbird.MODE = MODE;

module.exports = Hummingbird;