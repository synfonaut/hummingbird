const assert = require("assert");

import txo from "txo"

import Hummingbird from "./index"
import * as tape from "./tape"
import fs from "fs"

const config = {
    rpc: { host: "209.50.56.81", user: "root", pass: "bitcoin" },
    peer: { host: "209.50.56.81" },
    reconnect: false,
};

describe("hummingbird", function() {
    this.slow(1500);

    describe("state", function() {
        it("initialize disconnected", function() {
            const h = new Hummingbird(config);
            assert.equal(h.state, Hummingbird.STATE.DISCONNECTED);
        });

        it("switches to connecting on connect", function() {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);
            h.disconnect();
        });

        it("switches to crawling after connect", function(done) {
            this.timeout(10000);

            const h = new Hummingbird(config);
            h.connect();
            h.process = function() {};
            h.isuptodate = function() { return false };

            h._onconnect = h.onconnect;
            h.onconnect = async function() {
                assert.equal(h.state, Hummingbird.STATE.CONNECTING);
                h._onconnect();

                setTimeout(function() {
                    h.isuptodate = function() { return true };
                }, 250);

                let interval = setInterval(function() {
                    if (h.state === Hummingbird.STATE.CRAWLING) {
                        clearInterval(interval);
                        assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                        h.disconnect();
                        done();
                    }
                }, 100);
            };
        });

        it("disconnects", function(done) {
            const h = new Hummingbird(config);
            h.connect();

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                assert.equal(h.state, Hummingbird.STATE.CONNECTING);
                h._onconnect();
                h.disconnect();
            };

            h._ondisconnect = h.ondisconnect;
            h.ondisconnect = function() {
                h._ondisconnect();
                assert.equal(h.state, Hummingbird.STATE.DISCONNECTED);
                h.isuptodate = function() { return true };
                done();
            };
        });

        it("switches to listening after crawl", function(done) {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            // forcing is up to date should skip crawling step
            h.isuptodate = function() { return true };

            h._onconnect = h.onconnect;
            h.onconnect = async function() {
                await h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.LISTENING);
                h.disconnect();
                done();
            };
        });
    });

    describe("crawl", function() {
        this.timeout(15000);
        this.slow(5000);

        it("fetches blocks", function(done) {
            const h = new Hummingbird(config);
            h.onconnect = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");

                assert(block.txs[0].blk);
                assert.equal(block.txs[0].blk.i, 608811);
                assert.equal(block.txs[0].blk.t, 1573765073);
                assert.equal(block.txs[0].blk.h, "0000000000000000034a9d2b738eecce3e9afd8a07bc89ca03023c99f366708f");

                h.disconnect();
                done();
            };
            h.connect();
        });

        it("listens for blocks", function(done) {
            this.timeout(25000);
            this.slow(10000);

            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            h._onblock = h.onblock;
            h.onblock = function(block) {
                h._onblock(block);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
                assert(block.header.height, 608811);

                assert(block.txs[0].blk);
                assert.equal(block.txs[0].blk.i, 608811);
                assert.equal(block.txs[0].blk.t, 1573765073);
                assert.equal(block.txs[0].blk.h, "0000000000000000034a9d2b738eecce3e9afd8a07bc89ca03023c99f366708f");

                h.disconnect();
                done();
            }

            h.ready = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
            };

            h.connect();
        });
    });

    describe("tape", function() {
        const tapefile = "tape_test.txt"
        const cleanup = function() { try { fs.unlinkSync(tapefile) } catch (e) {} }

        beforeEach(cleanup);
        after(cleanup);

        it("starts empty", async function() {
            assert.equal(await tape.get(tapefile), null);
        });

        it("writes", async function() {
            assert(await tape.write("BLOCK 609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);
        });

        it("writes multiple", async function() {
            assert(await tape.write("BLOCK 609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);

            assert(await tape.write("BLOCK 609694 000000000000000000ed115ae01fea88351e8e9501cd2e957f00720856172b30 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 1574304458", tapefile));
            assert.equal(await tape.get(tapefile), 609694);
        });
    });

    describe("peer", function() {
        this.timeout(7500);

        it("automatically reconnect", function(done) {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            let times = 0;
            h.isuptodate = function() { return false };

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                times += 1;

                if (times == 2) {
                    done();
                    h.reconnect = false;
                    h.disconnect();
                } else if (times == 1) {
                    setTimeout(function() {
                        h.isuptodate = function() { return true };
                    }, 1000);
                    h.reconnect = true;
                    h.disconnect();
                }

            };
        });

        it("listens for mempool txs", function(done) {
            this.timeout(20000);
            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            let complete = false;
            h.onmempool = function(tx) {
                if (!complete) {
                    complete = true;
                    assert(tx);
                    assert(tx.tx.h);
                    assert(tx.in);
                    assert(tx.out);
                    h.disconnect();
                    done();
                }
            }
            h.connect();
        });

        it("refreshes mempool", function(done) {
            this.timeout(15000);
            // minimum needs to be low enough that normal mempool txs don't fill it up within timeout
            // but low enough that mempool still has a shot even after a block
            let minimum = 500, num = 0;

            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            let complete = false;
            h.onmempool = function(tx) {
                assert(tx);
                assert(tx.tx.h);
                assert(tx.in);
                assert(tx.out);

                num += 1;
                if (!complete && num >= minimum) {
                    complete = true;
                    h.disconnect();
                    done();
                }
            }

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                h.fetchmempool();
            }

            h.connect();
        });
    });
});

