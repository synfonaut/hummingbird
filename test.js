const assert = require("assert");

import Hummingbird from "./index"

const config = {
    rpc: { host: "209.50.56.81", user: "root", pass: "bitcoin" },
    peer: { host: "209.50.56.81" },
};

describe.only("hummingbird", function() {
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



});

// tape position


//  b2p2p
// disconnect
//  reconnect
// onblock
//  refreshmempool
// onmempool
