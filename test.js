const assert = require("assert");

import Hummingbird from "./index"
import * as tape from "./tape"
import fs from "fs"

const config = {
    rpc: { host: "209.50.56.81", user: "root", pass: "bitcoin" },
    peer: { host: "209.50.56.81" },
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
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                h.isuptodate = function() { return true };
                h.disconnect();
                done();
            };
        });

        it("disconnects", function(done) {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
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
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.LISTENING);
                h.disconnect();
                done();
            };
        });

        it("switches from crawling to listening back to crawling", function(done) {
            this.slow(2500);

            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                h.isuptodate = function() { return true };
            };

            h._listen = h.listen;
            let complete = false; // listen will call itself recursively if we don't add a complete check
            h.listen = async function() {
                if (!complete) {
                    h._listen();
                    assert.equal(h.state, Hummingbird.STATE.LISTENING);
                    h.isuptodate = function() { return false }; // new block comes in
                    h.onblock();
                    assert.equal(h.state, Hummingbird.STATE.CRAWLING);

                    h.isuptodate = function() { return true };

                    complete = true;
                    done();
                    h.disconnect();
                }
            };
        });
    });

    describe("crawl", function() {
        this.timeout(15000);
        this.slow(5000);

        it("fetches blocks", function(done) {
            const h = new Hummingbird(config);
            h.ready = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");

                h.isuptodate = function() { return true };
                h.disconnect();
                done();
            };
            h.connect();
        });

        it("listens for blocks", function(done) {
            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            h.ready = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
            };

            h._onblock = h.onblock;
            h.onblock = function(block) {
                h._onblock(block);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
                assert(block.header.height, 608811);
                h.disconnect();
                done();
            }
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
            assert(await tape.write("609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);
        });

        it("writes multiple", async function() {
            assert(await tape.write("609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);

            assert(await tape.write("609694 000000000000000000ed115ae01fea88351e8e9501cd2e957f00720856172b30 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 1574304458", tapefile));
            assert.equal(await tape.get(tapefile), 609694);
        });
    });

    describe("peer", function() {
        this.timeout(7500);

        it("automatically reconnects", function(done) {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            let times = 0;

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                times += 1;

                if (times == 2) {
                    h.isuptodate = function() { return true };
                    done();
                    h.disconnect();
                } else {
                    h.disconnect(true);
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

